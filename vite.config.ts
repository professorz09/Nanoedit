import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// ── Local Vertex proxy (DEV ONLY) ────────────────────────────────────────────
// Runs server-side inside the Vite dev process (Node), so the service-account
// JSON NEVER reaches the browser bundle. The client posts { prompt, sources,
// aspectRatio, resolution } to /api/generate; we authenticate to Vertex with the
// service account (via GOOGLE_APPLICATION_CREDENTIALS) and return the images.
function vertexProxyPlugin(env: Record<string, string>): Plugin {
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const project = env.VERTEX_PROJECT || 'vertixai-499009';
  const location = env.VERTEX_LOCATION || 'global';

  // Exact pixel target per aspect ratio — OpenRouter image models take no
  // aspectRatio field, so we pin the shape in-prompt (mirrors the edge function).
  const PIXELS: Record<string, { width: number; height: number }> = {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1024, height: 768 },
    '3:4': { width: 768, height: 1024 },
    '21:9': { width: 1280, height: 548 },
    '4:5': { width: 864, height: 1080 },
    '5:4': { width: 1080, height: 864 },
  };

  // Inline a non-data source URL into a base64 data URL (Node fetch has no CORS
  // limits, so this handles layers the browser couldn't inline). Leaves data:
  // URLs untouched; returns null if it can't be loaded.
  const inlineNodeSource = async (s: string): Promise<string | null> => {
    if (typeof s !== 'string') return null;
    if (s.startsWith('data:')) return s;
    try {
      const r = await fetch(s);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const mime = (r.headers.get('content-type') || 'image/png').split(';')[0];
      return `data:${mime};base64,${Buffer.from(ab).toString('base64')}`;
    } catch { return null; }
  };

  // OpenRouter image fallback (Seedream / GPT) — returns data-URL images.
  const viaOpenRouter = async (orKey: string, model: string, prompt: string, sources: string[], aspectRatio = '16:9'): Promise<string[]> => {
    const dims = PIXELS[aspectRatio] || PIXELS['16:9'];
    const sizePrompt = `${prompt}\n\nIMPORTANT: The output image MUST be exactly a ${aspectRatio} aspect ratio (${dims.width}x${dims.height} pixels). Do NOT return a square or any other shape.`;
    const content: any[] = [{ type: 'text', text: sizePrompt }];
    for (const s of sources) content.push({ type: 'image_url', image_url: { url: s } });
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json', 'X-Title': 'PodcastFlux' },
      body: JSON.stringify({ model, modalities: ['image'], messages: [{ role: 'user', content }] }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error?.message || `openrouter_${resp.status}`);
    const msg = data?.choices?.[0]?.message;
    const images: string[] = [];
    for (const im of msg?.images ?? []) {
      const url: string = im?.image_url?.url || '';
      if (/^data:.*?;base64,/.test(url)) images.push(url);
    }
    if (!images.length) throw new Error('openrouter_no_image');
    return images;
  };

  const readBody = (req: any): Promise<string> =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c: Buffer) => { data += c; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

  return {
    name: 'vertex-proxy',
    configureServer(server) {
      // Make sure the Google auth library can find the credentials file.
      if (credPath) process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;

      server.middlewares.use('/api/generate', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });

        const orKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
        const orSeedream = env.OPENROUTER_FALLBACK_MODEL || process.env.OPENROUTER_FALLBACK_MODEL || 'bytedance-seed/seedream-4.5';
        const orGpt = env.OPENROUTER_IMAGE_MODEL || process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-5.4-image-2';

        try {
          const { prompt, sources: rawSources = [], aspectRatio = '16:9', resolution } = JSON.parse((await readBody(req)) || '{}');
          if (!prompt) return send(400, { error: 'Missing prompt' });
          if (!credPath && !orKey) return send(500, { error: 'No image model configured — add GOOGLE_APPLICATION_CREDENTIALS or OPENROUTER_API_KEY to .env.local and restart the dev server.' });

          // Inline any remote/asset source URLs the browser couldn't convert.
          const sources = (await Promise.all((rawSources as string[]).map(inlineNodeSource))).filter(Boolean) as string[];

          const errs: string[] = [];
          let text = '';

          // 1) Vertex (primary). On any failure (incl. safety refusals with an
          //    attached image → no image part) we fall through to OpenRouter,
          //    mirroring the production edge function's fallback chain.
          if (credPath) {
            try {
              const { GoogleGenAI } = await import('@google/genai');
              const ai = new GoogleGenAI({ vertexai: true, project, location });

              const parts: any[] = [];
              for (const s of sources as string[]) {
                const m = /^data:(.*?);base64,(.*)$/.exec(s);
                if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
              }
              parts.push({ text: prompt });

              const isPro = resolution === '2K' || resolution === '4K';
              // 2K/4K → Gemini 3 Pro Image ("Nano Banana Pro"); Fast/1K → Gemini 3.1
              // Flash Image ("Nano Banana 2"). Current image model IDs (mirrors the
              // production edge function). Pro honors imageSize 2K/4K below.
              const model = isPro ? 'gemini-3-pro-image-preview' : 'gemini-3.1-flash-image-preview';
              const config: any = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } };
              if (isPro) config.imageConfig.imageSize = resolution;

              const result: any = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }], // Vertex requires the role field
                config,
              });

              const images: string[] = [];
              for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
                if (p.inlineData?.data) images.push(`data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);
                else if (p.text) text += p.text;
              }
              if (images.length) return send(200, { images, text });
              errs.push('vertex: no_image');
            } catch (e: any) { errs.push('vertex: ' + (e?.message || String(e))); }
          }

          // 2) Imagen 4 (Vertex, text-to-image only) — skipped when editing
          //    (sources present), since it can't use source images.
          if (credPath && sources.length === 0) {
            try {
              const { GoogleGenAI } = await import('@google/genai');
              const ai = new GoogleGenAI({ vertexai: true, project, location });
              const imagenAspects = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
              const config: any = { numberOfImages: 1 };
              if (imagenAspects.has(aspectRatio)) config.aspectRatio = aspectRatio;
              const result: any = await ai.models.generateImages({ model: 'imagen-4.0-generate-001', prompt, config });
              const images: string[] = [];
              for (const gi of result?.generatedImages ?? []) {
                const b64 = gi?.image?.imageBytes;
                if (b64) images.push(`data:${gi?.image?.mimeType || 'image/png'};base64,${b64}`);
              }
              if (images.length) return send(200, { images, text: '' });
              errs.push('imagen: no_image');
            } catch (e: any) { errs.push('imagen: ' + (e?.message || String(e))); }
          }

          // 3 & 4) OpenRouter fallback — Seedream, then GPT image.
          if (orKey) {
            for (const model of [orSeedream, orGpt]) {
              try {
                const images = await viaOpenRouter(orKey, model, prompt, sources as string[], aspectRatio);
                if (images.length) return send(200, { images, text: '' });
              } catch (e: any) { errs.push(`openrouter:${model}: ` + (e?.message || String(e))); }
            }
          }

          console.error('dev_generate_failed', errs.join(' | '));
          return send(502, { error: 'Could not generate an image right now. Please try again.' });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
      });

      // ── Text generation (titles / chapters / transcript analysis) ─────────
      // Vertex ONLY (Gemini 3 Flash → gemini-2.5-flash degrade), via either:
      //   1. Google service-account (GOOGLE_APPLICATION_CREDENTIALS) → Vertex
      //   2. VERTEX_API_KEY (Vertex Express key) → Vertex, no service account
      // The transcript itself comes from /api/transcript (Supadata) separately.
      server.middlewares.use('/api/text', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });

        const { prompt } = JSON.parse((await readBody(req)) || '{}');
        if (!prompt) return send(400, { error: 'Missing prompt' });

        const vertexKey = env.VERTEX_API_KEY || process.env.VERTEX_API_KEY;
        const errs: string[] = [];

        if (!credPath && !vertexKey) {
          return send(500, { error: 'No text model configured. Add GOOGLE_APPLICATION_CREDENTIALS or VERTEX_API_KEY to .env.local and restart the dev server.' });
        }

        // Vertex ONLY (mirrors the `text` Edge Function): Gemini 3 Flash first,
        // then degrade to GA gemini-2.5-flash — no OpenRouter.
        const { GoogleGenAI } = await import('@google/genai');
        const ai = credPath
          ? new GoogleGenAI({ vertexai: true, project, location })
          : new GoogleGenAI({ vertexai: true, apiKey: vertexKey });
        const textModel = env.VERTEX_TEXT_MODEL || process.env.VERTEX_TEXT_MODEL || 'gemini-3-flash';
        const models = textModel === 'gemini-2.5-flash' ? [textModel] : [textModel, 'gemini-2.5-flash'];
        for (const model of models) {
          try {
            const result: any = await ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            let text = '';
            for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
            if (text.trim()) return send(200, { text });
            errs.push(`vertex:${model} empty`);
          } catch (e: any) { errs.push(`vertex:${model} ` + (e?.message || String(e))); }
        }

        return send(502, { error: 'Text generation failed. ' + errs.join(' | ') });
      });

      // ── YouTube transcript fetch via Supadata (key stays server-side) ─────
      server.middlewares.use('/api/transcript', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        try {
          const { videoId } = JSON.parse((await readBody(req)) || '{}');
          if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return send(400, { error: 'Invalid videoId' });
          const apiKey = env.SUPADATA_API_KEY || process.env.SUPADATA_API_KEY;
          if (!apiKey) return send(500, { error: 'SUPADATA_API_KEY not set — add it to .env.local and restart the dev server.' });

          const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=false`;
          const r = await fetch(url, { headers: { 'x-api-key': apiKey } });
          const data: any = await r.json().catch(() => ({}));
          if (!r.ok) return send(200, { segments: [], reason: data?.message || `supadata ${r.status}` });

          // content is an array of { text, offset (ms), duration, lang } (or a string when text=true)
          const content = data?.content;
          const segments: { start: number; text: string }[] = [];
          if (Array.isArray(content)) {
            for (const c of content) {
              const text = String(c?.text || '').replace(/\s+/g, ' ').trim();
              if (text) segments.push({ start: Math.floor((c?.offset ?? 0) / 1000), text });
            }
          } else if (typeof content === 'string' && content.trim()) {
            segments.push({ start: 0, text: content.trim() });
          }
          return send(200, { segments });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
      });

      // ── Razorpay (DEV ONLY) ───────────────────────────────────────────────
      // Mirrors the create-order / verify-payment Edge Functions so the checkout
      // flow works against `vite dev`. NOTE: dev can VERIFY the signature but
      // CANNOT grant credits (no service-role key locally) — crediting only
      // happens in production via the Supabase functions. Keep the catalog in
      // sync with supabase/functions/_shared/pricing.ts.
      const USD_TO_INR = 84;
      const CATALOG: Record<string, { usd: number; label: string }> = {
        'plan:pro:monthly':    { usd: 39,  label: 'Pro plan (monthly)' },
        'plan:pro:yearly':     { usd: 390, label: 'Pro plan (yearly)' },
        'plan:studio:monthly': { usd: 79,  label: 'Studio plan (monthly)' },
        'plan:studio:yearly':  { usd: 790, label: 'Studio plan (yearly)' },
        'addon:addon_small':   { usd: 8,   label: '100 credit pack' },
        'addon:addon_large':   { usd: 30,  label: '500 credit pack' },
      };
      const rzpKeyId = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
      const rzpKeySecret = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

      server.middlewares.use('/api/create-order', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        if (!rzpKeyId || !rzpKeySecret) return send(500, { error: 'Add RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to .env.local and restart the dev server.' });
        try {
          const { item } = JSON.parse((await readBody(req)) || '{}');
          const cat = CATALOG[item];
          if (!cat) return send(400, { error: 'Unknown item.' });
          const amount = Math.round(cat.usd * USD_TO_INR) * 100; // paise
          const auth = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');
          const r = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, currency: 'INR', receipt: `r_dev_${Date.now().toString(36)}`, notes: { item } }),
          });
          const data: any = await r.json().catch(() => ({}));
          if (!r.ok || !data?.id) return send(502, { error: data?.error?.description || 'Razorpay order failed.' });
          return send(200, { order_id: data.id, amount: data.amount, currency: data.currency, key_id: rzpKeyId, label: cat.label });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
      });

      server.middlewares.use('/api/verify-payment', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        if (!rzpKeySecret) return send(500, { error: 'RAZORPAY_KEY_SECRET not set.' });
        try {
          const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse((await readBody(req)) || '{}');
          if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return send(400, { error: 'Missing payment details.' });
          const { createHmac } = await import('crypto');
          const expected = createHmac('sha256', rzpKeySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
          if (expected !== razorpay_signature) return send(400, { error: 'Payment verification failed.' });
          // Dev: signature valid. Credits are granted only in production.
          return send(200, { ok: true, dev: true });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 5000,
        host: '0.0.0.0',
        allowedHosts: true,
      },
      // Production serving on Replit: `vite build` then `vite preview` serves the
      // static bundle. In a build, import.meta.env.DEV is false, so the services
      // route to the secure Supabase Edge Functions (credits + fallback + auth),
      // NOT the DEV-only /api/* proxies above (those exist only in configureServer).
      preview: {
        port: 5000,
        host: '0.0.0.0',
        allowedHosts: true,
      },
      plugins: [react(), vertexProxyPlugin(env)],
      build: {
        // Split rarely-changing vendor code into its own long-cached, hashed
        // chunks so repeat visits and re-deploys only re-download changed app
        // code (less bandwidth = cheaper) and the browser fetches them in
        // parallel. jszip is loaded on demand, so it lands in its own chunk too.
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;
              if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('jszip')) return 'vendor-jszip';
            },
          },
        },
      },
      define: {
        // In a DEPLOYED build, BOTH image generation and transcript fetching go
        // through secure Supabase Edge Functions (services/geminiService.ts,
        // services/textService.ts) — their keys live as Supabase secrets and are
        // NEVER bundled into the browser. No server keys are defined here.
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
