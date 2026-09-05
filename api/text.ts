// ═══════════════════════════════════════════════════════════════════════════
// Vercel Serverless Function: /api/text
//
// Same job as supabase/functions/text (auth → credits → Vertex/OpenRouter text
// generation), ported to Vercel. The reason it exists is the one that already
// forced /api/generate to be written: Supabase Edge Functions on the Free plan
// have a hard 150s wall-clock limit, and the Chapter Maker can legitimately run
// long — MAX_PROMPT_CHARS here is 32k of transcript, handed to the bigger model.
// Vercel Functions get up to 300s, so this is where a long transcript actually
// has room to finish; the edge function stays as the fallback.
//
// This function is OPTIONAL to configure: until the secrets below are added in
// the Vercel project, it immediately returns 501 {error:"not_configured"}
// without touching credits, and the client (services/textService.ts) falls back
// to the Supabase edge function exactly as before.
//
// Vercel Project → Settings → Environment Variables (same values as the
// matching Supabase secrets):
//   SUPABASE_URL                = <project URL>                  (required)
//   SUPABASE_SERVICE_ROLE_KEY   = <service role key>             (required)
//   GOOGLE_SERVICE_ACCOUNT_JSON = <service-account JSON>         (Vertex, OR)
//   VERTEX_API_KEY              = <vertex / gemini key>          (Vertex, OR)
//   VERTEX_LOCATION             = global                         (optional)
//   VERTEX_TEXT_MODEL           = gemini-3.5-flash-lite          (optional)
//   VERTEX_TEXT_MODEL_LARGE     = gemini-3.8-flash               (optional)
//   OPENROUTER_API_KEY          = <openrouter key>               (fallback)
//   OPENROUTER_TEXT_MODEL       = google/gemini-3.5-flash-lite   (optional)
//   OPENROUTER_TEXT_MODEL_LARGE = google/gemini-3.8-flash        (optional)
// ═══════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 300 };

const MAX_PROMPT_CHARS = 32000; // chapters can include a long transcript

// Above this the prompt is a real transcript (Chapter Maker), not a short
// title/concept prompt — step up to the bigger model rather than run a long
// transcript through the lite tier it isn't tuned for. Mirrors the edge function.
const LARGE_PROMPT_THRESHOLD = 6000;
const MODEL_DEFAULT = process.env.VERTEX_TEXT_MODEL || 'gemini-3.5-flash-lite';
const MODEL_LARGE = process.env.VERTEX_TEXT_MODEL_LARGE || 'gemini-3.8-flash';
const OR_MODEL_DEFAULT = process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3.5-flash-lite';
const OR_MODEL_LARGE = process.env.OPENROUTER_TEXT_MODEL_LARGE || 'google/gemini-3.8-flash';

// Kept identical to the edge function's table — the client picks the op, the
// server picks the price, and the two servers must not disagree about it.
const COSTS: Record<string, number> = {
  title: 1,
  chapters: 1,
  concept: 0,
};

// Free ops still need a bound, or a caller could skip the UI entirely and farm
// free concept generations. Same rolling window and limit as the edge function,
// counted against the same tool_usage rows so the two paths share one budget
// rather than handing out double.
const FREE_LIMIT = 40;
const FREE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkFreeRateLimit(admin: any, uid: string, tool: string): Promise<boolean> {
  const since = new Date(Date.now() - FREE_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from('tool_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('tool', tool)
    .gte('created_at', since);
  if (error) return true; // fail open — don't block the tool over a logging hiccup
  if ((count ?? 0) >= FREE_LIMIT) return false;
  try { await admin.from('tool_usage').insert({ user_id: uid, tool }); } catch (_) { /* best-effort */ }
  return true;
}

const refundOnce = async (admin: any, uid: string) => {
  try { await admin.rpc('refund_credit', { p_user: uid }); } catch (_) { /* best-effort */ }
};

// Vertex client from EITHER a service-account JSON or a Vertex Express key.
function makeVertex(): any {
  const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saRaw) {
    const sa = JSON.parse(saRaw);
    return new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: process.env.VERTEX_LOCATION || 'global',
      googleAuthOptions: { credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
    });
  }
  const key = process.env.VERTEX_API_KEY;
  if (key) return new GoogleGenAI({ vertexai: true, apiKey: key });
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasVertex = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.VERTEX_API_KEY);
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  // Nothing configured on this deployment yet — tell the client to fall back to
  // the Supabase edge function instead of erroring. No credit touched.
  if (!SUPABASE_URL || !SERVICE_ROLE || (!hasVertex && !hasOpenRouter)) {
    return res.status(501).json({ error: 'not_configured' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const jwt = (req.headers.authorization ?? '').toString().replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'Please sign in to use this tool.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Please sign in to use this tool.' });
  const uid = userData.user.id;

  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: 'Input is too long.' });

  const op = typeof body.op === 'string' ? body.op : '';
  const cost = COSTS[op];
  if (cost === undefined) return res.status(400).json({ error: 'Unknown operation.' });

  if (cost === 0) {
    const ok = await checkFreeRateLimit(admin, uid, `text:${op}`);
    if (!ok) return res.status(429).json({ error: 'Too many requests. Please wait a bit and try again.' });
  }

  const refundAll = async () => { for (let i = 0; i < cost; i++) await refundOnce(admin, uid); };

  let done = 0;
  for (let i = 0; i < cost; i++) {
    const { data, error } = await admin.rpc('spend_credit', { p_user: uid });
    if (error || !data) {
      for (let j = 0; j < done; j++) await refundOnce(admin, uid);
      return res.status(402).json({ error: `Not enough credits — this tool costs ${cost} credits per run.` });
    }
    done++;
  }

  const errs: string[] = [];
  const isLargePrompt = prompt.length > LARGE_PROMPT_THRESHOLD;

  // 1) Vertex (Gemini)
  const ai = makeVertex();
  if (ai) {
    try {
      const result: any = await ai.models.generateContent({
        model: isLargePrompt ? MODEL_LARGE : MODEL_DEFAULT,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      let text = '';
      for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
      if (text.trim()) return res.status(200).json({ text });
      errs.push('vertex: empty');
    } catch (e: any) { errs.push('vertex: ' + (e?.message || String(e))); }
  }

  // 2) OpenRouter fallback
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey) {
    try {
      const model = isLargePrompt ? OR_MODEL_LARGE : OR_MODEL_DEFAULT;
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${orKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_PUBLIC_URL || 'https://podcastflux.com',
          'X-Title': 'PodcastFlux',
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      });
      const data: any = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = data?.choices?.[0]?.message?.content || '';
        if (typeof text === 'string' && text.trim()) return res.status(200).json({ text });
        errs.push('openrouter: empty');
      } else {
        errs.push('openrouter: ' + (data?.error?.message || r.status));
      }
    } catch (e: any) { errs.push('openrouter: ' + (e?.message || String(e))); }
  }

  await refundAll(); // every provider failed — a failed run is free
  console.error('text_failed', errs.join(' | '));
  return res.status(502).json({ error: 'Could not generate text right now. Please try again.' });
}
