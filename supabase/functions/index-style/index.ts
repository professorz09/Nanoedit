// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "index-style"
// Indexes a USER-uploaded style thumbnail so it joins their personal style pool.
//
// Flow: the client uploads the image to  styles/user/<uid>/<file>  (allowed by
// the storage RLS in migration 0006), then POSTs { path } here. This function —
// the ONLY place the Vertex key lives — reads that file with the service role,
// runs the SAME vision tagger + 768-dim embedder as scripts/tag-styles.mjs
// (niche / keywords / … / elements), and inserts a style_images row owned by the
// caller. The style then works in the Recreate tab AND the YouTube auto-style
// flow immediately.
//
// Auth: requires a signed-in user (JWT). The submitted path MUST be under the
// caller's own user/<uid>/ folder — no indexing someone else's upload.
// Abuse guard: a per-user cap (MAX_PER_USER) on custom styles.
//
// Deploy:  supabase functions deploy index-style --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_API_KEY (same as "text").
//   TAG_MODEL   = gemini-2.5-flash        (optional override)
//   EMBED_MODEL = gemini-embedding-001    (optional override)
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

const TAG_MODEL = Deno.env.get('TAG_MODEL') || 'gemini-2.5-flash';
const EMBED_MODEL = Deno.env.get('EMBED_MODEL') || 'gemini-embedding-001';
const EMBED_DIMS = 768; // must match style_images.embedding vector(768)
const BUCKET = 'styles';
const MAX_PER_USER = 20; // per-user cap on custom styles (quota / abuse guard)
const MAX_IMAGE_BYTES = 9_000_000; // matches admin-styles' ~9MB decoded cap

// Same schema tag-styles.mjs asks for — kept in sync so custom + global styles
// carry identical metadata (incl. the editable `elements` breakdown).
const PROMPT =
  `You are indexing a YouTube thumbnail so a matching engine can later pick it for a video on the same topic. ` +
  `Look at the image and describe ONLY what you actually see. Reply with STRICT JSON, no markdown, exactly these keys:\n` +
  `{\n` +
  `  "niche": "one lowercase word/short phrase for the video category this thumbnail suits (e.g. gaming, finance, podcast, tech, fitness, food, travel, horror, education, vlog, news, motivation)",\n` +
  `  "keywords": ["5-10 lowercase topic/visual keywords a matcher can score against"],\n` +
  `  "emotion": "the dominant emotion/vibe (e.g. shock, hype, curiosity, calm, tension, joy, serious)",\n` +
  `  "colors": ["2-4 dominant color/mood words, e.g. neon, dark, bright, gold, pastel"],\n` +
  `  "composition": "short phrase for the layout/framing (e.g. big face left + object right, centered subject, split-screen before/after)",\n` +
  `  "has_face": true or false (is there a prominent human face?),\n` +
  `  "text_density": "none" | "low" | "high",\n` +
  `  "summary": "one plain sentence: what this thumbnail looks like and what kind of video it fits",\n` +
  `  "elements": {\n` +
  `    "faces": [ { "position": "left | center | right | top-left | ..." } ],\n` +
  `    "texts": [ { "current": "the EXACT visible words", "position": "top | center | bottom | ...", "style": "short look, e.g. bold yellow uppercase with black outline" } ],\n` +
  `    "background": { "description": "short phrase for the background/scene" },\n` +
  `    "other": [ { "label": "short name of any other key visual element" } ]\n` +
  `  }\n` +
  `}`;

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

function parseJson(text: string): any {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

// The compact topic fingerprint we embed for vector search (mirrors
// scripts/tag-styles.mjs). The title — when the caller has one — leads, since
// it carries the actual topic/niche signal directly; vision tagging alone
// can't tell two visually-similar thumbnails (e.g. "shocked face") apart by
// topic the way the original video's title can.
function embedText(meta: any, title?: string | null): string {
  return [
    title,
    meta?.niche,
    meta?.emotion,
    (meta?.keywords || []).join(', '),
    (meta?.colors || []).join(', '),
    meta?.composition,
    meta?.summary,
  ].filter(Boolean).join('. ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Must be signed in.
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in.' });
  const uid = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const path = typeof body?.path === 'string' ? body.path.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : null;
  // Optional: the source video's title, if the caller knows it — folded into
  // both the stored metadata and the embedded text (see embedText below).
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) || null : null;
  if (!path) return json(400, { error: 'Missing path' });

  // The path MUST be inside the caller's own folder — no indexing others' files.
  const prefix = `user/${uid}/`;
  if (!path.startsWith(prefix)) return json(403, { error: 'You can only index your own uploads.' });

  // Per-user cap.
  const { count, error: countErr } = await admin
    .from('style_images')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid);
  if (countErr) { console.error('count_failed', countErr.message); return json(500, { error: 'Could not check your library.' }); }
  if ((count ?? 0) >= MAX_PER_USER) {
    return json(429, { error: `You've reached the limit of ${MAX_PER_USER} custom styles. Delete one to add another.` });
  }

  const ai = makeVertex();
  if (!ai) return json(500, { error: 'Indexing service is not configured.' });

  // 1) Read the uploaded image from Storage (service role).
  let inline: { mimeType: string; data: string };
  try {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
    if (dlErr || !blob) throw new Error(dlErr?.message || 'download failed');
    if (blob.size > MAX_IMAGE_BYTES) return json(400, { error: 'Image is too large.' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    inline = { mimeType: blob.type || 'image/jpeg', data: btoa(binary) };
  } catch (e: any) {
    console.error('read_failed', e?.message || String(e));
    return json(502, { error: 'Could not read the uploaded image.' });
  }

  // 2) Vision-tag the thumbnail.
  let meta: any = null;
  try {
    const result: any = await ai.models.generateContent({
      model: TAG_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: inline }, { text: PROMPT }] }],
    });
    let text = '';
    for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
    meta = parseJson(text);
  } catch (e: any) {
    console.error('tag_failed', e?.message || String(e));
  }
  if (!meta) return json(502, { error: 'Could not analyse the image. Please try a clearer thumbnail.' });
  if (title) meta.title = title;

  // 3) Embed the topic fingerprint (same model + dims + taskType as the index).
  let embedding: number[] | null = null;
  try {
    const r: any = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: embedText(meta, title),
      config: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_DOCUMENT' },
    });
    embedding = r?.embeddings?.[0]?.values ?? null;
  } catch (e: any) {
    console.error('embed_failed', e?.message || String(e));
  }
  if (!embedding?.length) return json(502, { error: 'Indexing is busy right now. Please try again in a moment.' });

  // 4) Insert the owned style row.
  const { data: row, error: insErr } = await admin
    .from('style_images')
    .insert({
      user_id: uid,
      path,
      name: name || title,
      meta,
      embedding: JSON.stringify(embedding),
      tagged_at: new Date().toISOString(),
      active: true,
      sort: 0,
    })
    .select('id, path, name, meta')
    .single();
  if (insErr) {
    if (insErr.code === '23505') {
      // A retry (e.g. after a client timeout) hit the same path the original
      // request already indexed — that earlier call succeeded, so this is a
      // success too. Return the existing row instead of surfacing an error.
      const { data: existing, error: fetchErr } = await admin
        .from('style_images')
        .select('id, path, name, meta')
        .eq('path', path)
        .single();
      if (!fetchErr && existing) {
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
        return json(200, { style: { ...existing, url: publicUrl } });
      }
      return json(409, { error: 'This image is already in your style library.' });
    }
    console.error('insert_failed', insErr.message);
    return json(500, { error: 'Could not save the style.' });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return json(200, { style: { ...row, url: publicUrl } });
});
