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
        // Image generation in a DEPLOYED build falls back to Vertex Express mode.
        // VERTEX_API_KEY is a single-string Express key (NOT a service-account JSON).
        // The service-account JSON is used ONLY by the local dev proxy above and is
        // never bundled. Microsoft Foundry / Anthropic keys are intentionally NOT
        // exposed here — they are for Claude Code configuration only.
        'process.env.VERTEX_API_KEY': JSON.stringify(env.VERTEX_API_KEY),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
