// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "admin-styles"
// Manage the GLOBAL style pool (user_id IS NULL — visible to every user) from
// inside the app, instead of running scripts/tag-styles.mjs locally with a
// service-role key.
//
// Auth: requires a signed-in user (JWT) AND profiles.is_admin = true for that
// user, checked server-side on EVERY request. is_admin is never trusted from
// the client — it's a plain column with no client write path (see migration
// 0013), only ever set directly by the project owner.
//
// Actions (POST { action, ... }):
//   list    — recent global styles (id, name, active, meta, url, created_at)
//   add     — { imageBase64 (data: URL), name?, title? } → vision-tag + embed
//             (same pipeline as index-style / scripts/tag-styles.mjs) + upload
//             + insert as a global style (user_id null)
//   toggle  — { id, active } → show/hide a global style without deleting it
//   delete  — { id } → remove a global style's row + Storage object
//
// Deploy:  supabase functions deploy admin-styles --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: reuses GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_API_KEY (same as "text" / "index-style").
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
const MAX_IMAGE_B64_CHARS = 12_000_000; // ~9 MB decoded, matches the "generate" function's cap

// Same schema index-style / scripts/tag-styles.mjs use — kept in sync so every
// style (global or per-user) carries identical metadata.
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

// Title leads (direct topic signal); vision-derived fields fill in the rest.
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

  // 1) Must be signed in.
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in.' });
  const uid = userData.user.id;

  // 2) Must be an admin — checked fresh on every request, server-side only.
  const { data: prof, error: profErr } = await admin
    .from('profiles').select('is_admin').eq('id', uid).single();
  if (profErr) return json(500, { error: 'Could not verify admin status.' });
  if (!prof?.is_admin) return json(403, { error: 'Admin access required.' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'list') {
    const { data, error } = await admin
      .from('style_images')
      .select('id, path, name, active, meta, sort, created_at')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return json(500, { error: 'Could not list styles.' });
    const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
    const styles = (data || []).map((r: any) => ({ ...r, url: `${publicPrefix}${r.path}` }));
    return json(200, { styles });
  }

  if (action === 'toggle') {
    const id = typeof body?.id === 'string' ? body.id : '';
    const active = !!body?.active;
    if (!id) return json(400, { error: 'Missing id' });
    const { error } = await admin.from('style_images').update({ active }).eq('id', id).is('user_id', null);
    if (error) return json(500, { error: 'Could not update the style.' });
    return json(200, { ok: true });
  }

  if (action === 'delete') {
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return json(400, { error: 'Missing id' });
    const { data: row, error: readErr } = await admin
      .from('style_images').select('path').eq('id', id).is('user_id', null).single();
    if (readErr || !row) return json(404, { error: 'Style not found.' });
    await admin.storage.from(BUCKET).remove([row.path]).catch(() => {});
    const { error: delErr } = await admin.from('style_images').delete().eq('id', id).is('user_id', null);
    if (delErr) return json(500, { error: 'Could not delete the style.' });
    return json(200, { ok: true });
  }

  if (action === 'add') {
    const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : null;
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) || null : null;
    if (imageBase64.length > MAX_IMAGE_B64_CHARS) return json(400, { error: 'Image is too large.' });
    const m = /^data:([^;]+);base64,(.*)$/.exec(imageBase64);
    if (!m) return json(400, { error: 'Missing or invalid image.' });
    const mimeType = m[1];
    const data = m[2];

    const ai = makeVertex();
    if (!ai) return json(500, { error: 'Tagging service is not configured.' });

    // 1) Vision-tag.
    let meta: any = null;
    try {
      const result: any = await ai.models.generateContent({
        model: TAG_MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }, { text: PROMPT }] }],
      });
      let text = '';
      for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
      meta = parseJson(text);
    } catch (e: any) {
      console.error('tag_failed', e?.message || String(e));
    }
    if (!meta) return json(502, { error: 'Could not analyse the image. Please try a clearer thumbnail.' });
    if (title) meta.title = title;

    // 2) Embed.
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

    // 3) Upload + insert as a GLOBAL style (user_id null).
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = `admin/${crypto.randomUUID()}.${ext}`;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      return json(400, { error: 'Missing or invalid image.' });
    }
    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
    if (up.error) { console.error('upload_failed', up.error.message); return json(500, { error: 'Could not upload the image.' }); }

    const { data: row, error: insErr } = await admin
      .from('style_images')
      .insert({
        path,
        name: name || title,
        meta,
        embedding: JSON.stringify(embedding),
        tagged_at: new Date().toISOString(),
        active: true,
        sort: 0,
        user_id: null,
      })
      .select('id, path, name, meta, active, created_at')
      .single();
    if (insErr) { console.error('insert_failed', insErr.message); return json(500, { error: 'Could not save the style.' }); }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return json(200, { style: { ...row, url: publicUrl } });
  }

  return json(400, { error: 'Unknown action.' });
});
