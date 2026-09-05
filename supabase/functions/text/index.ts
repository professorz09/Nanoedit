// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "text"
// Secure text generation for the Title Generator, Chapter Maker and the
// YouTube-link thumbnail concept step.
//
// Why an Edge Function: the LLM key must NEVER ship to the browser, and an open
// text endpoint would be a free proxy to our LLM key. So this requires a valid
// logged-in user (JWT) and caps the prompt size.
//
// The client sends WHICH operation it's doing (`op`), never how much it costs —
// the cost for each op is a fixed, server-side value (COSTS below). A raw
// client-supplied cost would let anyone call this endpoint directly with
// cost:0 and get the exact same generations for free, bypassing the credit
// gate entirely.
//
// Providers, in order:  Vertex (Gemini)  →  OpenRouter (fallback)
//
// Model: gemini-3.5-flash-lite for normal-sized prompts (title/concept and
// most chapter runs); a real long transcript (chapters can run up to
// MAX_PROMPT_CHARS) steps up to gemini-3.8-flash instead — Flash-Lite is
// tuned for short, cheap, high-volume calls, not sustained reasoning over
// tens of thousands of characters of transcript.
//
// Deploy:  supabase functions deploy text --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses VERTEX_API_KEY / OPENROUTER_API_KEY (+ optional
//   VERTEX_TEXT_MODEL / VERTEX_TEXT_MODEL_LARGE / OPENROUTER_TEXT_MODEL /
//   OPENROUTER_TEXT_MODEL_LARGE overrides).
// ═══════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from 'npm:@google/genai@2.21.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// supabase-js's .rpc()/.from() builders are PromiseLike, not real Promises —
// they implement .then() but NOT .catch(), so `await admin.rpc(...).catch(fn)`
// throws a synchronous "catch is not a function" TypeError instead of ever
// reaching `fn`. try/catch is the only safe way to swallow a failed RPC.
const refundOnce = async (admin: any, uid: string) => {
  try { await admin.rpc('refund_credit', { p_user: uid }); } catch (_) { /* best-effort */ }
};

const MAX_PROMPT_CHARS = 32000; // chapters can include a long transcript

// Above this, the prompt is a real transcript (Chapter Maker), not a short
// title/concept prompt — step up to the bigger model rather than run a long
// transcript through the lite tier it isn't tuned for.
const LARGE_PROMPT_THRESHOLD = 6000;
const MODEL_DEFAULT = Deno.env.get('VERTEX_TEXT_MODEL') || 'gemini-3.5-flash-lite';
const MODEL_LARGE = Deno.env.get('VERTEX_TEXT_MODEL_LARGE') || 'gemini-3.8-flash';
const OR_MODEL_DEFAULT = Deno.env.get('OPENROUTER_TEXT_MODEL') || 'google/gemini-3.5-flash-lite';
const OR_MODEL_LARGE = Deno.env.get('OPENROUTER_TEXT_MODEL_LARGE') || 'google/gemini-3.8-flash';

// `concept` costs 0 credits (see COSTS below) — without SOME bound, a caller
// could skip the YouTube UI flow entirely and hammer this + match-style
// directly to farm free style-matched prompts, then hand them to "generate"
// without sourceMode: 'youtube' to pay the normal 1-credit price instead of
// the 3 credits that pipeline is supposed to cost. This doesn't close that
// gap outright (a determined caller can still pace themselves under the
// limit) but it bounds the abuse to a rate a genuine multi-video session
// would never hit. Same rolling-window pattern "transcript" already uses.
// Raised from 20: a single YouTube Generate click now costs up to 1 (initial
// concept) + wantCount (per-style refine pass, deduped by concept+style
// pair) free calls instead of just 1, so the old ceiling capped a genuine
// user doing several 4-variation generations in an hour.
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
  // supabase-js's .from() builder is PromiseLike, not a real Promise — it has
  // no .catch(), so chaining one here throws a synchronous TypeError instead
  // of swallowing a failed insert (this is a fire-and-forget usage log).
  try { await admin.from('tool_usage').insert({ user_id: uid, tool }); } catch (_) { /* best-effort */ }
  return true;
}

// The ONLY source of truth for what each operation costs — matches
// TITLE_COST (TitleGenerator.tsx) and CHAPTERS_COST (ChapterMaker.tsx). The
// client picks the op; the server picks the price.
// `concept` (the YouTube-mode thumbnail/transcript analysis step in
// ThumbnailStudio.tsx) is free — its cost is folded into the higher
// per-image price ("generate"'s IMAGE_COST.youtube) that pipeline's actual
// generated images already charge, so it isn't billed twice.
const COSTS: Record<string, number> = {
  title: 1,
  chapters: 1,
  concept: 0,
};

// Vertex client from EITHER a service-account JSON or a Vertex Express key.
function makeVertex(): any {
  const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (saRaw) {
    const sa = JSON.parse(saRaw);
    return new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: Deno.env.get('VERTEX_LOCATION') || 'global',
      googleAuthOptions: { credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
    });
  }
  const key = Deno.env.get('VERTEX_API_KEY');
  if (key) return new GoogleGenAI({ vertexai: true, apiKey: key });
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Require a logged-in user — this is the anti-abuse gate.
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in to use this tool.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in to use this tool.' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return json(400, { error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return json(400, { error: 'Input is too long.' });

  const op = typeof body?.op === 'string' ? body.op : '';
  const cost = COSTS[op];
  if (cost === undefined) return json(400, { error: 'Unknown operation.' });

  const uid = userData.user.id;

  if (cost === 0) {
    const ok = await checkFreeRateLimit(admin, uid, `text:${op}`);
    if (!ok) return json(429, { error: 'Too many requests. Please wait a bit and try again.' });
  }

  const refundAll = async () => { for (let i = 0; i < cost; i++) await refundOnce(admin, uid); };

  let done = 0;
  for (let i = 0; i < cost; i++) {
    const { data, error } = await admin.rpc('spend_credit', { p_user: uid });
    if (error || !data) {
      for (let j = 0; j < done; j++) await refundOnce(admin, uid);
      return json(402, { error: `Not enough credits — this tool costs ${cost} credits per run.` });
    }
    done++;
  }

  const errs: string[] = [];
  const isLargePrompt = prompt.length > LARGE_PROMPT_THRESHOLD;

  // 1) Vertex (Gemini) — service-account JSON or Vertex Express key
  const ai = makeVertex();
  if (ai) {
    try {
      const result: any = await ai.models.generateContent({
        model: isLargePrompt ? MODEL_LARGE : MODEL_DEFAULT,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      let text = '';
      for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
      if (text.trim()) return json(200, { text });
      errs.push('vertex: empty');
    } catch (e: any) { errs.push('vertex: ' + (e?.message || String(e))); }
  }

  // 2) OpenRouter fallback
  const orKey = Deno.env.get('OPENROUTER_API_KEY');
  if (orKey) {
    try {
      const model = isLargePrompt ? OR_MODEL_LARGE : OR_MODEL_DEFAULT;
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json', 'X-Title': 'PodcastFlux' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      });
      const data: any = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = data?.choices?.[0]?.message?.content || '';
        if (typeof text === 'string' && text.trim()) return json(200, { text });
        errs.push('openrouter: empty');
      } else {
        errs.push('openrouter: ' + (data?.error?.message || r.status));
      }
    } catch (e: any) { errs.push('openrouter: ' + (e?.message || String(e))); }
  }

  if (!ai && !orKey) { await refundAll(); return json(500, { error: 'Text service is not configured.' }); }
  await refundAll(); // every provider failed — a failed run is free
  console.error('text_failed', errs.join(' | '));
  return json(502, { error: 'Could not generate text right now. Please try again.' });
});
