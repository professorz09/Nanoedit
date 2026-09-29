// ═══════════════════════════════════════════════════════════════════════════
// The thumbnail + text API on our own server (Oracle), instead of Vercel Functions.
//
// Runs the very same handlers as Vercel did — api/generate.ts (thumbnails) and api/text.ts
// (titles, chapters) — so login, credits (Supabase spend/refund) and the image/text models
// work exactly as before. No time limit here: a slow 2K/4K thumbnail gets as long as it needs
// (Supabase's own function stops at 150 s, Vercel's at 300 s).
//
// Run:   node server/api-server.ts          (Node 22.18+ runs the TypeScript directly)
// Env:   the api/*.ts secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON
//        or VERTEX_API_KEY, OPENROUTER_API_KEY …), plus
//        API_PORT (default 8095) and API_ALLOWED_ORIGINS — the site's addresses, comma-separated.
// The site calls it at VITE_API_URL (e.g. https://api.podcastflux.com); if it's down or not
// configured, the site falls back to the Supabase functions on its own.
//
// It also serves some Supabase functions themselves at /fn/<name> — transcript, match-style,
// index-style, admin-styles (server/deno-functions.ts runs their supabase/functions code as is), so
// the Supadata / Google / OpenRouter keys they need can live here instead of in Supabase. Env:
// SUPADATA_API_KEY for transcript; GOOGLE_SERVICE_ACCOUNT_JSON or VERTEX_API_KEY for the styles
// (match-style also runs on OPENROUTER_API_KEY alone). One without its key answers 501 and the site
// uses the Supabase function.
// ═══════════════════════════════════════════════════════════════════════════
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import generate from '../api/generate.ts';
import text from '../api/text.ts';
import { FUNCTIONS, loadFunction } from './deno-functions.ts';

const PORT = Number(process.env.API_PORT || 8095);
const ORIGINS = new Set((process.env.API_ALLOWED_ORIGINS || '').split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean));
const MAX_BODY = 40 * 1024 * 1024; // reference photos come as base64 in the body
const ROUTES: Record<string, (req: any, res: any) => unknown> = { '/api/generate': generate, '/api/text': text };

const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
  const parts: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
    parts.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const raw = (await readBody(req)).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('bad_json'); }
};

// /fn/<name>: hands the request to that Supabase function's own handler, as a standard Request
const serveFunction = async (name: string, req: IncomingMessage, res: ServerResponse) => {
  const out = vercelRes(res);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !FUNCTIONS[name]()) {
    out.status(501).json({ error: 'not_configured' });
    return;
  }
  let body: Buffer;
  try { body = await readBody(req); } catch (e: any) {
    out.status(e?.message === 'too_large' ? 413 : 400).json({ error: e?.message === 'too_large' ? 'The upload is too large.' : 'Bad request.' });
    return;
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const handler = await loadFunction(name);
  const response = await handler(new Request(`http://localhost/functions/v1/${name}`, {
    method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  }));
  res.statusCode = response.status;
  // CORS stays this server's own (the allowed origins above), not the function's "*"
  response.headers.forEach((v, k) => { if (!k.startsWith('access-control-')) res.setHeader(k, v); });
  res.end(Buffer.from(await response.arrayBuffer()));
};

// the bits of Vercel's response object the handlers use: res.status(n).json(obj)
const vercelRes = (res: ServerResponse) => {
  const r = {
    status(code: number) { res.statusCode = code; return r; },
    json(obj: unknown) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
      return r;
    },
  };
  return r;
};

createServer(async (req, res) => {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (path === '/' || path === '/health') { vercelRes(res).json({ ok: true, service: 'api' }); return; }
  const fn = path.match(/^\/fn\/([a-z-]+)$/)?.[1];
  if (fn && Object.hasOwn(FUNCTIONS, fn)) {
    try { await serveFunction(fn, req, res); } catch (e) {
      console.error(`${path} failed`, e);
      if (!res.headersSent) vercelRes(res).status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    if (!res.writableEnded) res.end();
    return;
  }
  const handler = ROUTES[path];
  if (!handler) { vercelRes(res).status(404).json({ error: 'Not found' }); return; }
  let body: unknown = {};
  if (req.method === 'POST') {
    try { body = await readJson(req); } catch (e: any) {
      vercelRes(res).status(e?.message === 'too_large' ? 413 : 400).json({ error: e?.message === 'too_large' ? 'The upload is too large.' : 'Bad request.' });
      return;
    }
  }
  try {
    await handler({ method: req.method, headers: req.headers, body }, vercelRes(res));
  } catch (e) {
    console.error(`${path} failed`, e);
    if (!res.headersSent) vercelRes(res).status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  if (!res.writableEnded) res.end();
}).listen(PORT, () => console.log(`api listening on :${PORT}`));
