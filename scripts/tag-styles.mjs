// ─────────────────────────────────────────────────────────────────────────────
// AI-index the "styles" pool so the YouTube flow can auto-pick a style by topic.
//
// For every row in public.style_images this looks at the actual thumbnail with a
// Gemini vision model and writes a small, model-derived tag object into
// style_images.meta (niche / keywords / emotion / colors / composition /
// has_face / text_density / summary), PLUS a 768-dim embedding of that tag text
// into style_images.embedding for vector search. NOTHING is hardcoded — the
// model decides the words. The YouTube flow embeds a video's topic and finds the
// closest styles via the match_styles() RPC (cosine similarity).
//
// Idempotent: skips rows already tagged (have a tagged_at) unless you pass
// --force. Run it again after adding new styles and only the new ones get tagged.
//
// Prereqs: apply migration 0006 first (adds the meta + tagged_at columns), and
// seed the pool (scripts/seed-styles.mjs) so there are rows to tag.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   GOOGLE_SERVICE_ACCOUNT_JSON='{...}'   # OR  VERTEX_API_KEY=...  OR  GEMINI_API_KEY=...
//   node scripts/tag-styles.mjs [--force]
//
// Model override (optional):  TAG_MODEL=gemini-3-flash
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
  process.exit(1);
}

const FORCE = process.argv.includes('--force');
// Recompute ONLY the embedding from the existing meta (no vision call) — used to
// re-index after tweaking the embedding model/params without re-paying for vision.
const EMBED_ONLY = process.argv.includes('--embed-only');
const BUCKET = 'styles';
const MODEL = process.env.TAG_MODEL || 'gemini-2.5-flash';
const EMBED_MODEL = process.env.EMBED_MODEL || 'gemini-embedding-001'; // reduced to 768 dims (matches the vector column)
const EMBED_DIMS = 768;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vertex (service account OR express key) mirrors the edge functions; a plain
// Google AI Studio key (GEMINI_API_KEY) also works for local runs.
function makeAI() {
  // Inline service-account JSON (edge-function style) OR a file path
  // (GOOGLE_APPLICATION_CREDENTIALS, the local .env.local convention).
  const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let sa = null;
  if (saRaw) { try { sa = JSON.parse(saRaw); } catch { /* not JSON */ } }
  else if (saPath) { try { sa = JSON.parse(readFileSync(saPath, 'utf8')); } catch { /* unreadable */ } }
  if (sa) {
    return new GoogleGenAI({
      vertexai: true,
      project: sa.project_id || process.env.VERTEX_PROJECT,
      location: process.env.VERTEX_LOCATION || 'global',
      googleAuthOptions: { credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
    });
  }
  const vkey = process.env.VERTEX_API_KEY;
  if (vkey) return new GoogleGenAI({ vertexai: true, apiKey: vkey });
  const gkey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (gkey) return new GoogleGenAI({ apiKey: gkey });
  return null;
}

const ai = makeAI();
if (!ai) {
  console.error('Set GOOGLE_SERVICE_ACCOUNT_JSON, VERTEX_API_KEY, or GEMINI_API_KEY.');
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

const publicUrl = (path) =>
  /^https?:\/\//.test(path) ? path : admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

async function fetchAsInline(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { mimeType: type.split(';')[0], data: buf.toString('base64') };
}

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
  `    "faces": [ { "position": "left | center | right | top-left | ..." } ],  // one entry per prominent human face/person; empty [] if none\n` +
  `    "texts": [ { "current": "the EXACT visible words", "position": "top | center | bottom | ...", "style": "short look, e.g. bold yellow uppercase with black outline" } ],  // one entry per distinct text block; empty [] if no text\n` +
  `    "background": { "description": "short phrase for the background/scene, e.g. neon city street, plain red studio" },\n` +
  `    "other": [ { "label": "short name of any other key visual element, e.g. red arrow, product box, glowing logo" } ]  // empty [] if none\n` +
  `  }\n` +
  `}`;

function parseJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

// The text we embed for vector search — a compact topic fingerprint of the style.
function embedText(meta) {
  return [
    meta.niche,
    meta.emotion,
    (meta.keywords || []).join(', '),
    (meta.colors || []).join(', '),
    meta.composition,
    meta.summary,
  ].filter(Boolean).join('. ');
}

// Embed with retry/backoff — the per-minute quota is small, so on a 429 we wait
// and retry rather than failing the whole row.
// Styles are indexed as RETRIEVAL_DOCUMENT; the runtime query embeds the video
// topic as RETRIEVAL_QUERY (see the match-style edge function). This asymmetric
// pairing is what makes cosine similarity rank the right styles first.
async function embed(text) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await ai.models.embedContent({
        model: EMBED_MODEL,
        contents: text,
        config: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_DOCUMENT' },
      });
      const values = r?.embeddings?.[0]?.values;
      if (!values?.length) throw new Error('empty embedding');
      return values;
    } catch (e) {
      const msg = e?.message || String(e);
      if (attempt < 6 && /429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        const wait = Math.min(60000, 5000 * (attempt + 1));
        console.log(`    …rate-limited, retrying in ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function tagOne(imageUrl) {
  const inline = await fetchAsInline(imageUrl);
  const result = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ inlineData: inline }, { text: PROMPT }] }],
  });
  let text = '';
  for (const p of result?.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
  const meta = parseJson(text);
  if (!meta) throw new Error('model did not return valid JSON');
  const embedding = await embed(embedText(meta));
  return { meta, embedding };
}

const query = admin.from('style_images').select('id, path, meta, tagged_at').order('sort', { ascending: true });
const { data: rows, error } = await query;
if (error) { console.error('Could not read style_images:', error.message); process.exit(1); }
if (!rows?.length) { console.error('No style_images rows. Run scripts/seed-styles.mjs first.'); process.exit(1); }

const todo = EMBED_ONLY
  ? rows.filter((r) => r.tagged_at) // re-embed everything already tagged
  : rows.filter((r) => FORCE || !r.tagged_at);
const label = EMBED_ONLY ? 're-embedding' : 'tagging';
console.log(`${rows.length} style(s) total · ${label} ${todo.length}${FORCE ? ' (--force)' : EMBED_ONLY ? '' : ' (untagged only)'}…`);

let ok = 0, failed = 0;
for (const row of todo) {
  const url = publicUrl(row.path);
  try {
    if (EMBED_ONLY) {
      const embedding = await embed(embedText(row.meta || {}));
      const { error: upErr } = await admin.from('style_images').update({ embedding: JSON.stringify(embedding) }).eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
      ok++;
      console.log(`  ✓ ${row.path} → re-embedded (${row.meta?.niche || '?'})`);
    } else {
      const { meta, embedding } = await tagOne(url);
      const { error: upErr } = await admin
        .from('style_images')
        .update({ meta, embedding: JSON.stringify(embedding), tagged_at: new Date().toISOString() })
        .eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
      ok++;
      console.log(`  ✓ ${row.path} → ${meta.niche || '?'} · ${(meta.keywords || []).slice(0, 4).join(', ')}`);
    }
  } catch (e) {
    failed++;
    console.error(`  ✗ ${row.path}: ${e.message || e}`);
  }
  await sleep(1500); // gentle throttle to stay under the per-minute embedding quota
}

console.log(`Done. ${EMBED_ONLY ? 'Re-embedded' : 'Tagged'} ${ok}, failed ${failed}, skipped ${rows.length - todo.length}.`);
