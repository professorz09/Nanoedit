// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "match-style"
// Vector search over the style pool for the YouTube auto-style flow.
//
// The browser can't embed text (the Vertex key is server-side only), so it POSTs
// the video's topic here. We embed it with the SAME model used to index the
// styles (gemini-embedding-2 → 768 dims) and run the match_styles() RPC to find
// the closest styles by cosine similarity. Returns their public URLs + tags so
// the client can recreate the best-fitting styles.
//
// Auth: requires a logged-in user (JWT), same as "text"/"transcript" — but
// like those, this is free. Its cost is folded into the higher per-image
// price the YouTube pipeline's actual generated images already charge
// ("generate"'s IMAGE_COST.youtube), so it isn't billed twice.
//
// Deploy:  supabase functions deploy match-style --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_API_KEY (same as "text").
//   EMBED_MODEL = gemini-embedding-2     (optional override; falls back to
//                 the same model via OPENROUTER_API_KEY if Vertex is down)
// ═══════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from 'npm:@google/genai@2.21.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { embedWithFallback } from '../_shared/embedding.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMBED_DIMS = 768; // must match the style_images.embedding vector(768) column
const BUCKET = 'styles';
const MAX_TEXT = 8000;

// This is free (see the file header) — without SOME bound, a caller could
// skip the YouTube UI flow entirely and hammer this + "text" op:concept
// directly to farm free style-matched prompts, then hand them to "generate"
// without sourceMode: 'youtube' to pay 1 credit instead of the 3 that
// pipeline is supposed to cost. This doesn't close that gap outright (a
// determined caller can still pace themselves under the limit) but it
// bounds the abuse to a rate a genuine multi-video session would never hit.
// Same rolling-window pattern "transcript" already uses.
const FREE_LIMIT = 20;
const FREE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkFreeRateLimit(admin: any, uid: string): Promise<boolean> {
  const since = new Date(Date.now() - FREE_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from('tool_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('tool', 'match-style')
    .gte('created_at', since);
  if (error) return true; // fail open — don't block the tool over a logging hiccup
  if ((count ?? 0) >= FREE_LIMIT) return false;
  // supabase-js's .from() builder is PromiseLike, not a real Promise — it has
  // no .catch(), so chaining one here throws a synchronous TypeError instead
  // of swallowing a failed insert (this is a fire-and-forget usage log).
  try { await admin.from('tool_usage').insert({ user_id: uid, tool: 'match-style' }); } catch (_) { /* best-effort */ }
  return true;
}

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

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in.' });
  const uid = userData.user.id;

  const rateOk = await checkFreeRateLimit(admin, uid);
  if (!rateOk) return json(429, { error: 'Too many requests. Please wait a bit and try again.' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return json(400, { error: 'Missing text' });
  const count = Number.isFinite(body?.count) ? Math.max(1, Math.min(12, Math.floor(body.count))) : 8;
  const ownOnly = body?.ownOnly === true;

  const ai = makeVertex();
  if (!ai && !Deno.env.get('OPENROUTER_API_KEY')) {
    return json(500, { error: 'Match service is not configured.' });
  }

  // 1) Embed the query topic (same model + dims as the offline index).
  // Styles were indexed as RETRIEVAL_DOCUMENT; the query is RETRIEVAL_QUERY.
  // Falls back to the same google/gemini-embedding-2 model served through
  // OpenRouter if Vertex is unavailable — see _shared/embedding.ts for why
  // that stays safe to mix with Vertex-produced vectors (same model, same dims).
  const embedding = await embedWithFallback(ai, text, EMBED_DIMS, 'RETRIEVAL_QUERY');
  if (!embedding?.length) {
    return json(502, { error: 'Could not analyse the topic. Please try again.' });
  }

  // 2) Cosine-similarity search over the indexed styles — global defaults PLUS
  // the caller's own custom styles (p_user_id filters to user_id IS NULL OR own),
  // unless ownOnly restricts it to just the caller's own uploaded styles
  // (migration 0019's 4-arg overload).
  const { data, error } = await admin.rpc('match_styles', {
    query_embedding: JSON.stringify(embedding),
    match_count: count,
    p_user_id: uid,
    p_own_only: ownOnly,
  });
  if (error) {
    console.error('match_styles_failed', error.message);
    return json(502, { error: 'Style search failed.' });
  }

  // Per-user custom styles (path starts with "user/<uid>/") are RLS-scoped
  // to their owner at the Storage level — a plain public URL 403s even for
  // the owner, so sign those specifically. match_styles already filtered to
  // only global rows or this caller's own, so every "user/" row here is
  // guaranteed to belong to uid. Global styles (admin/, seed/) keep plain
  // public URLs — no round trip, nothing owner-scoped to leak.
  const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  const SIGNED_URL_TTL = 60 * 60 * 24; // 1 day
  const styles = await Promise.all((data || []).map(async (row: any) => {
    let url: string;
    if (/^https?:\/\//.test(row.path)) {
      url = row.path;
    } else if (row.path.startsWith('user/')) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.path, SIGNED_URL_TTL);
      url = signed?.signedUrl || '';
    } else {
      url = `${publicPrefix}${row.path}`;
    }
    return { url, name: row.name ?? null, meta: row.meta ?? {}, similarity: row.similarity ?? null };
  }));

  return json(200, { styles: styles.filter(s => s.url) });
});
