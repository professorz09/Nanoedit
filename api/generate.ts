// ═══════════════════════════════════════════════════════════════════════════
// Vercel Serverless Function: /api/generate
//
// Same job as supabase/functions/generate (auth → credits → Vertex/OpenRouter
// generation → Storage upload → rolling cap), ported to run on Vercel instead
// of a Supabase Edge Function. The reason it exists: Supabase Edge Functions
// on the Free plan have a hard 150s wall-clock limit (real elapsed time,
// including the wait on the Gemini API — no way to raise it without
// upgrading the Supabase plan), which was cutting off slower 2K/4K
// generations. Vercel Functions get up to 300s on Hobby / 800s on Pro, so
// this is where 4K generation actually has room to finish.
//
// This function is OPTIONAL to configure: until the secrets below are added
// in the Vercel project, it immediately returns 501 {error:"not_configured"}
// without touching credits, and the client (services/geminiService.ts) falls
// back to calling the Supabase edge function exactly as before. Add the
// secrets any time to make this the primary path — no other code changes
// needed.
//
// Vercel Project → Settings → Environment Variables (same values as the
// matching Supabase secrets — `supabase secrets set ... --project-ref
// vowgdlbvundorxwjdntu` lists them):
//   SUPABASE_URL              = <project URL>                 (required)
//   SUPABASE_SERVICE_ROLE_KEY = <service role key>             (required)
//   GOOGLE_SERVICE_ACCOUNT_JSON = <service-account JSON>        (Vertex, OR)
//   VERTEX_API_KEY             = <vertex / gemini key>          (Vertex, OR)
//   VERTEX_LOCATION             = global                        (optional)
//   VERTEX_PRO_MODEL            = gemini-3-pro-image             (optional override; 2K/4K)
//   VERTEX_FLASH_MODEL          = gemini-3.1-flash-image         (optional override; 1K/Fast + Pro degrade)
//   OPENROUTER_API_KEY          = <openrouter key>               (fallback)
//   OPENROUTER_IMAGE_MODEL      = openai/gpt-5.4-image-2         (optional override)
//   MAX_THUMBNAILS_PER_USER     = 200                            (optional override)
//   APP_PUBLIC_URL               = https://podcastflux.com        (optional; OpenRouter referer)
// ═══════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export const config = { maxDuration: 300 };

const MAX_PROMPT_CHARS = 6000;
const MAX_SOURCES = 6;
const MAX_SOURCE_B64_CHARS = 12_000_000;
const ALLOWED_ASPECTS = new Set(['16:9', '1:1', '9:16', '4:3', '3:4', '21:9', '4:5', '5:4']);
const ALLOWED_RES = new Set(['1K', '2K', '4K']);
const IMAGE_COST: Record<string, number> = { default: 1, youtube: 3 };
// 4K runs the Pro model at ~4x the pixel/token cost of 2K (same model) — surcharge
// it on top of the base per-mode price rather than raising 2K, which stays free
// to keep using as the default "hi-res" tier.
const RES_SURCHARGE: Record<string, number> = { '4K': 2 };

type GenImage = { mime: string; data: string };
type GenResult = { images: GenImage[]; text: string };

async function inlineStorageUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 9_000_000) return null; // ~9 MB decoded ceiling
    const mime = (r.headers.get('content-type') || 'image/png').split(';')[0];
    return `data:${mime};base64,${Buffer.from(ab).toString('base64')}`;
  } catch {
    return null;
  }
}

function makeVertex(): any {
  const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saRaw) {
    const sa = JSON.parse(saRaw);
    return new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: process.env.VERTEX_LOCATION || 'global',
      googleAuthOptions: { credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
    });
  }
  const key = process.env.VERTEX_API_KEY;
  if (key) {
    return new GoogleGenAI({ vertexai: true, apiKey: key, location: process.env.VERTEX_LOCATION || 'global' });
  }
  return null;
}

// Same reasoning as the Supabase edge function's SAFETY_SETTINGS — loosen the
// 4 adjustable harm categories so benign prompts stop getting false-positive
// blocked. Core protections (child safety etc.) stay non-adjustable regardless.
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

async function viaVertex(model: string, prompt: string, sources: string[], aspectRatio: string, resolution?: string): Promise<GenResult> {
  const ai = makeVertex();
  if (!ai) throw new Error('vertex_not_configured');

  const supportsImageSize = model.startsWith('gemini-3') && !model.includes('lite');

  const parts: any[] = [];
  for (const s of sources) {
    const m = /^data:(.*?);base64,(.*)$/.exec(s);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  const genConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio },
    safetySettings: SAFETY_SETTINGS,
  };
  if (supportsImageSize && resolution) genConfig.imageConfig.imageSize = resolution;

  const result: any = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config: genConfig });

  const images: GenImage[] = [];
  let text = '';
  for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) images.push({ mime: p.inlineData.mimeType || 'image/png', data: p.inlineData.data });
    else if (p.text) text += p.text;
  }
  if (!images.length) {
    const blockReason = result?.promptFeedback?.blockReason;
    const finishReason = result?.candidates?.[0]?.finishReason;
    if (blockReason) throw new Error(`vertex_blocked:${blockReason}`);
    if (finishReason && finishReason !== 'STOP') throw new Error(`vertex_no_image:${finishReason}`);
    throw new Error('vertex_no_image');
  }
  return { images, text };
}

const PIXELS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '21:9': { width: 1280, height: 548 },
  '4:5': { width: 864, height: 1080 },
  '5:4': { width: 1080, height: 864 },
};

async function viaOpenRouter(model: string, prompt: string, sources: string[], aspectRatio = '16:9'): Promise<GenResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('openrouter_not_configured');

  const dims = PIXELS[aspectRatio] || PIXELS['16:9'];
  const sizePrompt = `${prompt}\n\nIMPORTANT: The output image MUST be exactly a ${aspectRatio} aspect ratio (${dims.width}x${dims.height} pixels). Do NOT return a square or any other shape.`;

  const content: any[] = [{ type: 'text', text: sizePrompt }];
  for (const s of sources) content.push({ type: 'image_url', image_url: { url: s } });

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_PUBLIC_URL || 'https://podcastflux.com',
      'X-Title': 'PodcastFlux',
    },
    body: JSON.stringify({ model, modalities: ['image'], messages: [{ role: 'user', content }] }),
  });

  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || `openrouter_${resp.status}`);

  const msg = data?.choices?.[0]?.message;
  const images: GenImage[] = [];
  for (const im of msg?.images ?? []) {
    const url: string = im?.image_url?.url || '';
    const m = /^data:(.*?);base64,(.*)$/.exec(url);
    if (m) images.push({ mime: m[1], data: m[2] });
  }
  const text = typeof msg?.content === 'string' ? msg.content : '';
  if (!images.length) throw new Error('openrouter_no_image');
  return { images, text };
}

const refundOnce = async (admin: any, uid: string) => {
  try { await admin.rpc('refund_credit', { p_user: uid }); } catch (_) { /* best-effort */ }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasVertex = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.VERTEX_API_KEY);
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  // Nothing configured yet on this deployment — tell the client to fall back
  // to the Supabase edge function instead of erroring out. No credit touched.
  if (!SUPABASE_URL || !SERVICE_ROLE || (!hasVertex && !hasOpenRouter)) {
    return res.status(501).json({ error: 'not_configured' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const jwt = (req.headers.authorization ?? '').toString().replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'Please log in to generate.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Please log in to generate.' });
  const user = userData.user;

  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: 'Prompt is too long.' });

  const rawSources = Array.isArray(body.sources) ? body.sources : [];
  if (rawSources.length > MAX_SOURCES) return res.status(400).json({ error: `Too many source images (max ${MAX_SOURCES}).` });

  const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/`;
  const sources: string[] = [];
  for (const s of rawSources) {
    if (typeof s !== 'string') return res.status(400).json({ error: 'Invalid source image.' });
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(s)) {
      if (s.length > MAX_SOURCE_B64_CHARS) return res.status(400).json({ error: 'A source image is too large.' });
      sources.push(s);
      continue;
    }
    if (s.startsWith(publicPrefix)) {
      const inlined = await inlineStorageUrl(s);
      if (!inlined) return res.status(400).json({ error: 'Could not load a source image. Remove it and try again.' });
      sources.push(inlined);
      continue;
    }
    return res.status(400).json({ error: 'Source images must be inline uploads.' });
  }

  const aspectRatio = ALLOWED_ASPECTS.has(body.aspectRatio) ? body.aspectRatio : '16:9';
  const resolution = ALLOWED_RES.has(body.resolution) ? body.resolution : undefined;
  const sourceMode = body.sourceMode === 'youtube' ? 'youtube' : 'default';
  const cost = IMAGE_COST[sourceMode] + (resolution ? (RES_SURCHARGE[resolution] ?? 0) : 0);

  let reserved = 0;
  for (let i = 0; i < cost; i++) {
    const { data: spent, error: spendErr } = await admin.rpc('spend_credit', { p_user: user.id });
    if (spendErr) {
      for (let j = 0; j < reserved; j++) await refundOnce(admin, user.id);
      return res.status(500).json({ error: 'Credit check failed. Please try again.' });
    }
    if (!spent) {
      for (let j = 0; j < reserved; j++) await refundOnce(admin, user.id);
      return res.status(402).json({ error: `No credits left. This costs ${cost} credit${cost === 1 ? '' : 's'} — please upgrade your plan to generate.` });
    }
    reserved++;
  }

  const orGptModel = process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-5.4-image-2';
  const proModel = process.env.VERTEX_PRO_MODEL || 'gemini-3-pro-image';
  const flashModel = process.env.VERTEX_FLASH_MODEL || 'gemini-3.1-flash-image';
  const isHiRes = resolution === '2K' || resolution === '4K';
  const vertexModels = isHiRes ? [proModel, flashModel] : [flashModel];
  const attempts: Array<{ name: string; run: () => Promise<GenResult> }> = [
    ...vertexModels.map((m) => ({ name: `vertex:${m}`, run: () => viaVertex(m, prompt, sources, aspectRatio, resolution) })),
    { name: `openrouter:${orGptModel}`, run: () => viaOpenRouter(orGptModel, prompt, sources, aspectRatio) },
  ];

  let gen: GenResult | null = null;
  let usedProvider = '';
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const r = await a.run();
      if (r.images.length) {
        // `cost` was reserved for exactly ONE image — keep only the first
        // part a model returns so an extra part never becomes a free image.
        gen = { ...r, images: r.images.slice(0, 1) };
        usedProvider = a.name;
        break;
      }
      errors.push(`${a.name}: no_image`);
    } catch (e: any) {
      errors.push(`${a.name}: ${e?.message || 'error'}`);
    }
  }

  if (!gen || !gen.images.length) {
    for (let j = 0; j < cost; j++) await refundOnce(admin, user.id);
    console.error('all_providers_failed', errors.join(' | '));
    const allBlocked = errors.length > 0 && errors.every((e) => e.includes('vertex_blocked') || e.includes('vertex_no_image:'));
    return res.status(502).json({
      error: allBlocked
        ? 'Your prompt was blocked by the safety filter. Try rephrasing it (avoid sensitive/explicit language) and generate again.'
        : 'Could not generate an image right now. Please try again.',
    });
  }

  const urls: string[] = [];
  try {
    for (const im of gen.images) {
      const bytes = Buffer.from(im.data, 'base64');
      const path = `${user.id}/${randomUUID()}.png`;
      const up = await admin.storage.from('thumbnails').upload(path, bytes, { contentType: im.mime || 'image/png', upsert: false });
      if (up.error) throw up.error;
      const { data: pub } = admin.storage.from('thumbnails').getPublicUrl(path);
      urls.push(pub.publicUrl);
      await admin.from('generations').insert({ user_id: user.id, prompt, path });
    }
  } catch (storeErr: any) {
    for (let j = 0; j < cost; j++) await refundOnce(admin, user.id);
    console.error('storage_failed', storeErr?.message || storeErr);
    return res.status(502).json({ error: 'Generated, but saving failed. Please try again.' });
  }

  try {
    const cap = parseInt(process.env.MAX_THUMBNAILS_PER_USER || '200', 10) || 200;
    const evictBatch = 20;
    const { count } = await admin.from('generations').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if ((count ?? 0) >= cap) {
      const { data: stale } = await admin
        .from('generations')
        .select('id, path')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(evictBatch);
      if (stale && stale.length) {
        await admin.storage.from('thumbnails').remove(stale.map((r: any) => r.path));
        await admin.from('generations').delete().in('id', stale.map((r: any) => r.id));
      }
    }
  } catch (capErr: any) {
    console.error('cap_cleanup_failed', capErr?.message || capErr);
  }

  console.log('generated_via', usedProvider);
  return res.status(200).json({ images: urls, text: gen.text, provider: usedProvider });
}
