// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "transcript"
// Secure YouTube transcript fetch via Supadata.
//
// Why an Edge Function: the SUPADATA_API_KEY must NEVER ship to the browser.
// Previously the production build called Supadata directly from the client,
// which baked the key into the public JS bundle. This moves the call
// server-side and gates it behind a logged-in user (JWT) so the key can't be
// abused as a free transcript proxy. It does NOT spend credits.
//
// Deploy:  supabase functions deploy transcript --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: SUPADATA_API_KEY
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Free (uncredited) tool — bound it with a rolling window so it can't be
// hammered into a free, unlimited Supadata proxy.
const FREE_LIMIT = 30;
const FREE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkFreeRateLimit(admin: any, uid: string): Promise<boolean> {
  const since = new Date(Date.now() - FREE_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from('tool_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('tool', 'transcript')
    .gte('created_at', since);
  if (error) return true; // fail open — don't block the tool over a logging hiccup
  if ((count ?? 0) >= FREE_LIMIT) return false;
  await admin.from('tool_usage').insert({ user_id: uid, tool: 'transcript' }).catch(() => {});
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Require a logged-in user — this is the anti-abuse gate for the Supadata key.
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in to use this tool.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in to use this tool.' });

  const ok = await checkFreeRateLimit(admin, userData.user.id);
  // Soft-fail like the Supadata-down case — the client falls back to manual paste.
  if (!ok) return json(200, { segments: [], reason: 'rate_limited' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const videoId = typeof body?.videoId === 'string' ? body.videoId : '';
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return json(400, { error: 'Invalid videoId' });

  const apiKey = Deno.env.get('SUPADATA_API_KEY');
  if (!apiKey) return json(500, { error: 'Transcript service is not configured.' });

  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=false`;
  const r = await fetch(url, { headers: { 'x-api-key': apiKey } });
  const data: any = await r.json().catch(() => ({}));
  // Soft-fail: return an empty list (200) so the client can fall back to manual paste.
  if (!r.ok) return json(200, { segments: [], reason: data?.message || `supadata ${r.status}` });

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
  return json(200, { segments });
});
