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

        try {
          const { prompt, sources = [], aspectRatio = '16:9', resolution } = JSON.parse((await readBody(req)) || '{}');
          if (!prompt) return send(400, { error: 'Missing prompt' });
          if (!credPath) return send(500, { error: 'GOOGLE_APPLICATION_CREDENTIALS not set — add the service-account JSON path to .env.local and restart the dev server.' });

          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ vertexai: true, project, location });

          const parts: any[] = [];
          for (const s of sources as string[]) {
            const m = /^data:(.*?);base64,(.*)$/.exec(s);
            if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          }
          parts.push({ text: prompt });

          const isPro = resolution === '2K' || resolution === '4K';
          const model = isPro ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
          const config: any = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } };
          if (isPro) config.imageConfig.imageSize = resolution;

          const result: any = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }], // Vertex requires the role field
            config,
          });

          const images: string[] = [];
          let text = '';
          for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
            if (p.inlineData?.data) images.push(`data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);
            else if (p.text) text += p.text;
          }
          if (!images.length && !text) return send(502, { error: 'No image generated.' });
          return send(200, { images, text });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
      });

      // ── Text generation (titles / chapters) ──────────────────────────────
      server.middlewares.use('/api/text', async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        try {
          const { prompt } = JSON.parse((await readBody(req)) || '{}');
          if (!prompt) return send(400, { error: 'Missing prompt' });
          if (!credPath) return send(500, { error: 'GOOGLE_APPLICATION_CREDENTIALS not set — add the service-account JSON path to .env.local and restart the dev server.' });

          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ vertexai: true, project, location });
          const result: any = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          });
          let text = '';
          for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
            if (p.text) text += p.text;
          }
          if (!text.trim()) return send(502, { error: 'No text generated.' });
          return send(200, { text });
        } catch (e: any) {
          return send(500, { error: e?.message || String(e) });
        }
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
      plugins: [react(), vertexProxyPlugin(env)],
      define: {
        // In a DEPLOYED build, image generation goes through the secure Supabase
        // Edge Function (services/geminiService.ts) — the image-gen key lives as a
        // Supabase secret and is NEVER bundled into the browser.
        // Only SUPADATA (transcript) key is defined here for the prod fallback.
        'process.env.SUPADATA_API_KEY': JSON.stringify(env.SUPADATA_API_KEY),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
