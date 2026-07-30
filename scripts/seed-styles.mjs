// ─────────────────────────────────────────────────────────────────────────────
// Seed the "styles" pool into Supabase (one-time / repeatable).
//
// Uploads every top-level image in attached_assets/ to the public "styles"
// Storage bucket and inserts a matching row into public.style_images. Idempotent:
// re-running upserts files and skips rows whose path already exists.
//
// Prereqs: apply migration 0005 first (creates the table + bucket).
//
// Run (service-role key required — it bypasses RLS to write; NEVER ship it to
// the browser):
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node scripts/seed-styles.mjs
//
// To add MORE styles later: drop files into attached_assets/ and re-run, OR
// upload straight to the "styles" bucket in the dashboard and add a style_images
// row pointing at the object path.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
  process.exit(1);
}

const BUCKET = 'styles';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'attached_assets');

const files = readdirSync(assetsDir, { withFileTypes: true })
  .filter((d) => d.isFile() && MIME[extname(d.name).toLowerCase()])
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('No images found in attached_assets/.');
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

// Existing rows → skip re-inserting the same path.
const { data: existing, error: exErr } = await admin.from('style_images').select('path');
if (exErr) { console.error('Could not read style_images:', exErr.message); process.exit(1); }
const known = new Set((existing || []).map((r) => r.path));

let uploaded = 0, inserted = 0, skipped = 0;
for (let i = 0; i < files.length; i++) {
  const name = files[i];
  const objectPath = `seed/${name}`;
  const bytes = readFileSync(join(assetsDir, name));
  const contentType = MIME[extname(name).toLowerCase()] || 'image/jpeg';

  const up = await admin.storage.from(BUCKET).upload(objectPath, bytes, { contentType, upsert: true });
  if (up.error) { console.error(`  upload failed ${name}:`, up.error.message); continue; }
  uploaded++;

  if (known.has(objectPath)) { skipped++; continue; }
  const ins = await admin.from('style_images').insert({ path: objectPath, name, sort: i });
  if (ins.error) { console.error(`  insert failed ${name}:`, ins.error.message); continue; }
  inserted++;
}

console.log(`Done. Uploaded ${uploaded} file(s), inserted ${inserted} new row(s), skipped ${skipped} existing.`);
