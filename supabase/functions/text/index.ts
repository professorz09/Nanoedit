// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "text"
// Secure text generation for the Title Generator & Chapter Maker tools.
//
// Why an Edge Function: the LLM key must NEVER ship to the browser, and an open
// text endpoint would be a free proxy to our LLM key. So this requires a valid
// logged-in user (JWT) and caps the prompt size. It does NOT spend credits —
// these are free helper tools, just gated behind sign-in to stop abuse.
//
// Model: Vertex Gemini 3 Flash (gemini-3-flash) — Pro-grade reasoning at Flash
// speed/cost, used for transcript analysis (chapters, titles, thumbnail concepts).
// Vertex ONLY — no OpenRouter fallback (OpenRouter is intentionally disabled).
// If the primary ID isn't accessible on the project, it degrades to the GA
// gemini-2.5-flash — still on Vertex, so the LLM never routes through OpenRouter.
//
// Deploy:  supabase functions deploy text --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_API_KEY.
//   VERTEX_TEXT_MODEL = gemini-3-flash   (optional override, e.g. gemini-3.6-flash)
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

  // Vertex (Gemini) ONLY — no OpenRouter. Try Gemini 3 Flash first, then degrade
  // to the GA gemini-2.5-flash if the project can't reach the primary ID. Both
  // run on Vertex, so text analysis never leaves Vertex.
  const ai = makeVertex();
  if (!ai) { await refundAll(); return json(500, { error: 'Text service is not configured.' }); }

  const textModel = Deno.env.get('VERTEX_TEXT_MODEL') || 'gemini-3-flash';
  const models = textModel === 'gemini-2.5-flash' ? [textModel] : [textModel, 'gemini-2.5-flash'];
  for (const model of models) {
    try {
      const result: any = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      let text = '';
      for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
      if (text.trim()) return json(200, { text });
      errs.push(`vertex:${model} empty`);
    } catch (e: any) { errs.push(`vertex:${model} ` + (e?.message || String(e))); }
  }

  await refundAll(); // every Vertex model failed — a failed run is free
  console.error('text_failed', errs.join(' | '));
  return json(502, { error: 'Could not generate text right now. Please try again.' });
});
