// One-time asset optimizer: converts every JPG/PNG under attached_assets/ to
// WebP (quality 82) and removes the original. The app loads these via
// import.meta.glob('...webp' included) with the extension stripped from the
// key, so filenames-minus-extension stay identical and nothing in the UI needs
// to change. Run with: node scripts/convert-assets-webp.mjs
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';

const ROOT = 'attached_assets';
const EXTS = new Set(['.jpg', '.jpeg', '.png']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let before = 0, after = 0;

for (const src of files) {
  const dest = src.replace(/\.[^.]+$/, '.webp');
  const inBytes = statSync(src).size;
  await sharp(src).webp({ quality: 82, effort: 5 }).toFile(dest);
  const outBytes = statSync(dest).size;
  unlinkSync(src);
  before += inBytes;
  after += outBytes;
  console.log(`${src} → ${dest}  ${(inBytes / 1024).toFixed(0)}KB → ${(outBytes / 1024).toFixed(0)}KB`);
}

console.log(`\n${files.length} images. ${(before / 1e6).toFixed(2)}MB → ${(after / 1e6).toFixed(2)}MB  (saved ${(100 * (1 - after / before)).toFixed(0)}%)`);
