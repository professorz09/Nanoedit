// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "match-style"
// Vector search over the style pool for the YouTube auto-style flow.
//
// The browser can't embed text (the Vertex key is server-side only), so it POSTs
// the video's topic here. We embed it with the SAME model used to index the
// styles (gemini-embedding-001 → 768 dims) and run the match_styles() RPC to find
// the closest styles by cosine similarity. Returns their public URLs + tags so
// the client can recreate the best-fitting styles.
//
// Auth: requires a logged-in user (JWT). Unlike "text"/"transcript" (free,
// rate-limited helpers), this spends MATCH_COST credits via the same
// spend_credit()/refund_credit() RPCs "generate" uses — so it's only usable
// within whatever credit balance the caller actually has, the same as any
// other metered action, not a free-standing unlimited helper.
//
// Deploy:  supabase functions deploy match-style --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_API_KEY (same as "text").
//   EMBED_MODEL = gemini-embedding-001   (optional override)
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

const EMBED_MODEL = Deno.env.get('EMBED_MODEL') || 'gemini-embedding-001';
const EMBED_DIMS = 768; // must match the style_images.embedding vector(768) column
const BUCKET = 'styles';
const MAX_TEXT = 8000;
const MATCH_COST = 1; // credits spent per match call, refunded if it fails

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

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return json(400, { error: 'Missing text' });
  const count = Number.isFinite(body?.count) ? Math.max(1, Math.min(12, Math.floor(body.count))) : 8;

  const ai = makeVertex();
  if (!ai) return json(500, { error: 'Match service is not configured.' });

  // Reserve credits up front — bounded strictly by whatever balance the
  // caller actually has, same atomic RPC "generate" uses. 402 at zero.
  const { data: spent, error: spendErr } = await admin.rpc('spend_credit', { p_user: uid });
  if (spendErr) return json(500, { error: 'Credit check failed. Please try again.' });
  if (!spent) return json(402, { error: 'No credits left. Please upgrade your plan to use style matching.' });

  // 1) Embed the query topic (same model + dims as the offline index).
  // Bounded with a timeout — a credit is already reserved, so a hung upstream
  // call shouldn't be able to hold it indefinitely before the refund below.
  let embedding: number[] | null = null;
  try {
    const r: any = await Promise.race([
      ai.models.embedContent({
        model: EMBED_MODEL,
        contents: text,
        // Styles were indexed as RETRIEVAL_DOCUMENT; the query is RETRIEVAL_QUERY.
        config: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_QUERY' },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('embed_timeout')), 15000)),
    ]);
    embedding = r?.embeddings?.[0]?.values ?? null;
  } catch (e: any) {
    console.error('embed_failed', e?.message || String(e));
  }
  if (!embedding?.length) {
    await admin.rpc('refund_credit', { p_user: uid }).catch(() => {});
    return json(502, { error: 'Could not analyse the topic. Please try again.' });
  }

  // 2) Cosine-similarity search over the indexed styles — global defaults PLUS
  // the caller's own custom styles (p_user_id filters to user_id IS NULL OR own).
  const { data, error } = await admin.rpc('match_styles', {
    query_embedding: JSON.stringify(embedding),
    match_count: count,
    p_user_id: uid,
  });
  if (error) {
    console.error('match_styles_failed', error.message);
    await admin.rpc('refund_credit', { p_user: uid }).catch(() => {});
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
