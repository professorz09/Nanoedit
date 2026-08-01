// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "generate"
// Secure image generation with a provider fallback chain, credit enforcement,
// Storage persistence, and a rolling per-user cap.
//
// Flow per request:
//   1. Verify the caller (user JWT).
//   2. Validate + sanitize the request (prompt / sources / aspect / resolution).
//   3. Reserve credits via spend_credit() — 1 normally, 3 for sourceMode:
//      'youtube' (that pipeline does real extra work per image). Rejects
//      with 402, refunding any partial reservation, if the full cost isn't
//      available.
//   4. Generate, trying providers in order until one returns an image:
//        Vertex Gemini 3 (Pro 2K/4K → Flash)  →  OpenRouter (GPT)
//      Whoever succeeds, the credit stays spent (edits included). If ALL fail
//      to produce an image, the reserved credit is REFUNDED — a failure is free.
//   5. Upload each image to the public "thumbnails" bucket + log a generations row.
//   6. Enforce a rolling cap: keep only the newest N per user (oldest file + row
//      are deleted), so Storage never grows unbounded.
//
// Deploy:
//   supabase functions deploy generate --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets (supabase secrets set … --project-ref vowgdlbvundorxwjdntu):
//   VERTEX_API_KEY           = <vertex / gemini key>          (primary)
//   VERTEX_PRO_MODEL         = gemini-3-pro-image             (optional override; 2K/4K)
//   VERTEX_FLASH_MODEL       = gemini-3.1-flash-image         (optional override; 1K/Fast + Pro degrade)
//   OPENROUTER_API_KEY       = <openrouter key>               (fallback)
//   OPENROUTER_IMAGE_MODEL   = openai/gpt-5.4-image-2         (optional override; GPT fallback)
//   MAX_THUMBNAILS_PER_USER  = 50                             (optional override)
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
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

// supabase-js's .rpc() builder is PromiseLike, not a real Promise — it
// implements .then() but NOT .catch(), so `await admin.rpc(...).catch(fn)`
// throws a synchronous "catch is not a function" TypeError instead of ever
// reaching `fn` — which would crash the handler AND skip the refund. try/catch
// is the only safe way to swallow a failed RPC.
const refundOnce = async (admin: any, uid: string) => {
  try { await admin.rpc('refund_credit', { p_user: uid }); } catch (_) { /* best-effort */ }
};

// ── Limits (defense against payload abuse / runaway cost) ────────────────────
const MAX_PROMPT_CHARS = 6000; // premium/analysed prompts (concept + base direction) run long
const MAX_SOURCES = 6;
const MAX_SOURCE_B64_CHARS = 12_000_000; // ~9 MB decoded, per source image
const ALLOWED_ASPECTS = new Set(['16:9', '1:1', '9:16', '4:3', '3:4', '21:9', '4:5', '5:4']);
const ALLOWED_RES = new Set(['1K', '2K', '4K']);

// The ONLY source of truth for what an image costs — the client's
// `sourceMode` just picks which price applies, same pattern as "text"'s
// op → COSTS table. A YouTube-mode image costs more because that pipeline
// does real extra work per image (transcript fetch, concept LLM call,
// style-match embedding call) on top of the generation itself.
const IMAGE_COST: Record<string, number> = { default: 1, youtube: 3 };

type GenImage = { mime: string; data: string }; // data = raw base64 (no data: prefix)
type GenResult = { images: GenImage[]; text: string };

// Base64-encode bytes in chunks (btoa(String.fromCharCode(...huge)) overflows the
// call stack on large images).
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

// Fetch a public object from THIS project's Storage and return it as a data URL.
// Returns null if it can't be loaded or is too large. Caller restricts the input
// to our own public-bucket prefix, so this never fetches an arbitrary host.
async function inlineStorageUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 9_000_000) return null; // ~9 MB decoded ceiling
    const mime = (r.headers.get('content-type') || 'image/png').split(';')[0];
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(ab))}`;
  } catch {
    return null;
  }
}

// Build a Vertex client from EITHER a service-account JSON (GOOGLE_SERVICE_ACCOUNT_JSON)
// or a Vertex Express API key (VERTEX_API_KEY). Returns null if neither is set.
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
  if (key) {
    // Gemini 3.x image models (gemini-3-pro-image / gemini-3.1-flash-image) are
    // ONLY served from the `global` location on Vertex — an API-key client that
    // defaults to a regional endpoint gets a 404 "Publisher model not found".
    // Pin it explicitly.
    return new GoogleGenAI({ vertexai: true, apiKey: key, location: Deno.env.get('VERTEX_LOCATION') || 'global' });
  }
  return null;
}

// ── Provider 1: Vertex / Gemini (primary) ────────────────────────────────────
// `model` is passed in so the caller can build a resilient chain: try the
// hi-res Pro model first, then degrade to the Flash model. BOTH Gemini-3 image
// models (gemini-3-pro-image / gemini-3.1-flash-image) honour imageConfig's
// `aspectRatio` AND `imageSize` (1K/2K/4K), so the requested shape + resolution
// are respected on either tier. The legacy 2.5-flash-image is fixed at 1024px
// and would reject imageSize, so imageSize is applied only to the Gemini-3 line.
async function viaVertex(model: string, prompt: string, sources: string[], aspectRatio: string, resolution?: string): Promise<GenResult> {
  const ai = makeVertex();
  if (!ai) throw new Error('vertex_not_configured');

  // Gemini-3 image models support the imageSize control (excludes the Lite tier).
  const supportsImageSize = model.startsWith('gemini-3') && !model.includes('lite');

  const parts: any[] = [];
  for (const s of sources) {
    const m = /^data:(.*?);base64,(.*)$/.exec(s);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  // aspectRatio is honoured on EVERY tier so the output never defaults to square.
  const config: any = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } };
  if (supportsImageSize && resolution) config.imageConfig.imageSize = resolution;

  const result: any = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config });

  const images: GenImage[] = [];
  let text = '';
  for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) images.push({ mime: p.inlineData.mimeType || 'image/png', data: p.inlineData.data });
    else if (p.text) text += p.text;
  }
  if (!images.length) throw new Error('vertex_no_image');
  return { images, text };
}

// Exact pixel target for each aspect ratio. Unlike Vertex, the OpenRouter image
// models take no aspectRatio field, so without an explicit size they emit a
// random (often square) image. We pin both an `image_size` param AND a strong
// in-prompt instruction so the fallback output matches the requested shape.
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

// ── Provider 2: OpenRouter (GPT image, final fallback) ───────────────────────
async function viaOpenRouter(model: string, prompt: string, sources: string[], aspectRatio = '16:9'): Promise<GenResult> {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) throw new Error('openrouter_not_configured');

  const dims = PIXELS[aspectRatio] || PIXELS['16:9'];
  // Force the shape in the prompt too — some image models honour text over params.
  const sizePrompt = `${prompt}\n\nIMPORTANT: The output image MUST be exactly a ${aspectRatio} aspect ratio (${dims.width}x${dims.height} pixels). Do NOT return a square or any other shape.`;

  const content: any[] = [{ type: 'text', text: sizePrompt }];
  for (const s of sources) content.push({ type: 'image_url', image_url: { url: s } });

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': Deno.env.get('APP_PUBLIC_URL') || 'https://podcastflux.com',
      'X-Title': 'PodcastFlux',
    },
    // Dedicated image models (Seedream, gpt-image) only support image-only
    // output; sending ['image','text'] returns "No endpoints found …".
    // These models take no aspectRatio field, so the fixed size is enforced via
    // the in-prompt directive above (adding unknown body params risks a 400).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1) Authenticate the caller (JWT is the real gate — CORS does not protect non-browser callers)
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please log in to generate.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please log in to generate.' });
  const user = userData.user;

  // 2) Parse + STRICTLY validate the request before spending anything
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json(400, { error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) return json(400, { error: 'Prompt is too long.' });

  const rawSources = Array.isArray(body?.sources) ? body.sources : [];
  if (rawSources.length > MAX_SOURCES) return json(400, { error: `Too many source images (max ${MAX_SOURCES}).` });
  // Accept EITHER inline data: URLs OR public URLs from THIS project's own
  // Storage (thumbnails/styles buckets). The latter covers layers the browser
  // couldn't inline itself (cross-origin fetch blocked → "Load failed"); we
  // fetch + inline them here, where no CORS restriction applies. Any other URL
  // is rejected — that's the SSRF guard (we never fetch arbitrary remote hosts).
  const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/`;
  const sources: string[] = [];
  for (const s of rawSources) {
    if (typeof s !== 'string') return json(400, { error: 'Invalid source image.' });
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(s)) {
      if (s.length > MAX_SOURCE_B64_CHARS) return json(400, { error: 'A source image is too large.' });
      sources.push(s);
      continue;
    }
    if (s.startsWith(publicPrefix)) {
      const inlined = await inlineStorageUrl(s);
      if (!inlined) return json(400, { error: 'Could not load a source image. Remove it and try again.' });
      sources.push(inlined);
      continue;
    }
    return json(400, { error: 'Source images must be inline uploads.' });
  }

  const aspectRatio = ALLOWED_ASPECTS.has(body?.aspectRatio) ? body.aspectRatio : '16:9';
  const resolution = ALLOWED_RES.has(body?.resolution) ? body.resolution : undefined;
  const sourceMode = body?.sourceMode === 'youtube' ? 'youtube' : 'default';
  const cost = IMAGE_COST[sourceMode];

  // 3) Reserve `cost` credits, one at a time (atomic per call; monthly first,
  //    then add-on). 402 at zero, refunding whatever was already reserved if
  //    the full amount isn't available.
  let reserved = 0;
  for (let i = 0; i < cost; i++) {
    const { data: spent, error: spendErr } = await admin.rpc('spend_credit', { p_user: user.id });
    if (spendErr) {
      for (let j = 0; j < reserved; j++) await refundOnce(admin, user.id);
      return json(500, { error: 'Credit check failed. Please try again.' });
    }
    if (!spent) {
      for (let j = 0; j < reserved; j++) await refundOnce(admin, user.id);
      return json(402, { error: `No credits left. This costs ${cost} credit${cost === 1 ? '' : 's'} — please upgrade your plan to generate.` });
    }
    reserved++;
  }

  // 4) Generate — try each provider until one returns an image. Credit stays
  //    spent on the first success; refunded only if EVERY provider fails.
  const orGptModel = Deno.env.get('OPENROUTER_IMAGE_MODEL') || 'openai/gpt-5.4-image-2';
  // Vertex model chain — GA (no `-preview`) IDs now that the preview phase ended.
  // 2K/4K → Gemini 3 Pro Image (only model honouring imageSize 2K/4K); then
  // degrade to Gemini 3.1 Flash Image so a Pro miss still generates at 1K.
  // Fast/1K → Gemini 3.1 Flash Image directly. BOTH Gemini-3 image models honour
  // `imageConfig.aspectRatio` (the older 2.5-flash-image ignored it → square
  // output), so the requested aspect ratio is respected on every tier.
  const proModel = Deno.env.get('VERTEX_PRO_MODEL') || 'gemini-3-pro-image';
  const flashModel = Deno.env.get('VERTEX_FLASH_MODEL') || 'gemini-3.1-flash-image';
  const isHiRes = resolution === '2K' || resolution === '4K';
  const vertexModels = isHiRes ? [proModel, flashModel] : [flashModel];
  const attempts: Array<{ name: string; run: () => Promise<GenResult> }> = [
    ...vertexModels.map((m) => ({
      name: `vertex:${m}`,
      run: () => viaVertex(m, prompt, sources, aspectRatio, resolution),
    })),
    // (Imagen 4 removed — deprecated, shuts down 2026-08-17; the Gemini-3 Flash
    //  model already covers text-to-image and honours aspect ratio. Seedream
    //  fallback removed too — Gemini-3's Pro→Flash chain covers hi-res, so the
    //  only remaining fallback needed is a non-Google provider: OpenRouter GPT.)
    { name: `openrouter:${orGptModel}`, run: () => viaOpenRouter(orGptModel, prompt, sources, aspectRatio) },
  ];

  let gen: GenResult | null = null;
  let usedProvider = '';
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const res = await a.run();
      if (res.images.length) {
        // `cost` was reserved for exactly ONE image (the client makes a
        // separate call — and pays separately — per variation; see wantCount
        // in ThumbnailStudio.tsx). A model that returns more than one image
        // part in a single response must not turn into extra free images —
        // keep only the first and ignore the rest.
        gen = { ...res, images: res.images.slice(0, 1) };
        usedProvider = a.name;
        break;
      }
      errors.push(`${a.name}: no_image`);
    } catch (e: any) {
      errors.push(`${a.name}: ${e?.message || 'error'}`);
    }
  }

  if (!gen || !gen.images.length) {
    // Total failure across all providers → refund. A failed generation is free.
    for (let j = 0; j < cost; j++) await refundOnce(admin, user.id);
    console.error('all_providers_failed', errors.join(' | '));
    return json(502, { error: 'Could not generate an image right now. Please try again.' });
  }

  // 5) Upload results to Storage + log them
  const urls: string[] = [];
  try {
    for (const im of gen.images) {
      const bytes = Uint8Array.from(atob(im.data), (c) => c.charCodeAt(0));
      const path = `${user.id}/${crypto.randomUUID()}.png`;
      const up = await admin.storage.from('thumbnails').upload(path, bytes, {
        contentType: im.mime || 'image/png',
        upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = admin.storage.from('thumbnails').getPublicUrl(path);
      urls.push(pub.publicUrl);
      await admin.from('generations').insert({ user_id: user.id, prompt, path });
    }
  } catch (storeErr: any) {
    // The user DID get an image from the model; a storage hiccup shouldn't
    // silently eat the credit AND the result. Refund and report.
    for (let j = 0; j < cost; j++) await refundOnce(admin, user.id);
    console.error('storage_failed', storeErr?.message || storeErr);
    return json(502, { error: 'Generated, but saving failed. Please try again.' });
  }

  // 6) Rolling cap — keep only the newest N per user; delete older file(s) + row(s).
  //    Best-effort: never fail the response over cleanup.
  try {
    const cap = parseInt(Deno.env.get('MAX_THUMBNAILS_PER_USER') || '50', 10) || 50;
    const { data: stale } = await admin
      .from('generations')
      .select('id, path')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(cap, cap + 199); // rows beyond the cap
    if (stale && stale.length) {
      await admin.storage.from('thumbnails').remove(stale.map((r: any) => r.path));
      await admin.from('generations').delete().in('id', stale.map((r: any) => r.id));
    }
  } catch (capErr: any) {
    console.error('cap_cleanup_failed', capErr?.message || capErr);
  }

  console.log('generated_via', usedProvider);
  return json(200, { images: urls, text: gen.text, provider: usedProvider });
});
