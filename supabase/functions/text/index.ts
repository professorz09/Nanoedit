// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "text"
// Secure text generation for the Title Generator & Chapter Maker tools.
//
// Why an Edge Function: the LLM key must NEVER ship to the browser, and an open
// text endpoint would be a free proxy to our LLM key. So this requires a valid
// logged-in user (JWT) and caps the prompt size. It does NOT spend credits —
// these are free helper tools, just gated behind sign-in to stop abuse.
//
// Providers, in order:  Vertex (Gemini)  →  OpenRouter (fallback)
//
// Deploy:  supabase functions deploy text --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses VERTEX_API_KEY / OPENROUTER_API_KEY (+ optional OPENROUTER_TEXT_MODEL).
// ═══════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from 'npm:@google/genai@1.9.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_PROMPT_CHARS = 32000; // chapters can include a long transcript

// Free-tier (cost:0) calls aren't credit-gated, so bound them with a rolling
// window instead — otherwise a signed-in user can hammer "Generate" and burn
// an LLM completion (up to a 32k-char prompt) on every click, for free.
const FREE_LIMIT = 20;
const FREE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkFreeRateLimit(admin: any, uid: string): Promise<boolean> {
  const since = new Date(Date.now() - FREE_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from('tool_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('tool', 'text_free')
    .gte('created_at', since);
  if (error) return true; // fail open — don't block the tool over a logging hiccup
  if ((count ?? 0) >= FREE_LIMIT) return false;
  await admin.from('tool_usage').insert({ user_id: uid, tool: 'text_free' }).catch(() => {});
  return true;
}

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

  // Optional metered cost. Paid tools (e.g. the Title Generator) send `cost`;
  // free helpers (Chapter Maker, thumbnail concept) omit it. Spend up-front and
  // refund if generation ultimately fails, so a failed run is never charged.
  const cost = Number.isFinite(body?.cost) ? Math.max(0, Math.min(10, Math.floor(body.cost))) : 0;
  const uid = userData.user.id;
  const refundAll = async () => { for (let i = 0; i < cost; i++) await admin.rpc('refund_credit', { p_user: uid }).catch(() => {}); };

  if (cost === 0) {
    const ok = await checkFreeRateLimit(admin, uid);
    if (!ok) return json(429, { error: 'You’ve hit the free-tool limit for now — try again in a bit.' });
  }

  if (cost > 0) {
    let done = 0;
    for (let i = 0; i < cost; i++) {
      const { data, error } = await admin.rpc('spend_credit', { p_user: uid });
      if (error || !data) {
        for (let j = 0; j < done; j++) await admin.rpc('refund_credit', { p_user: uid }).catch(() => {});
        return json(402, { error: `Not enough credits — this tool costs ${cost} credits per run.` });
      }
      done++;
    }
  }

  const errs: string[] = [];

  // 1) Vertex (Gemini) — service-account JSON or Vertex Express key
  const ai = makeVertex();
  if (ai) {
    try {
      const result: any = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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
      const model = Deno.env.get('OPENROUTER_TEXT_MODEL') || 'google/gemini-2.5-flash';
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
