// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "generate"
// Secure image generation + credit enforcement + Storage persistence.
//
// Flow per request:
//   1. Verify the caller (user JWT).
//   2. Reserve a credit via spend_credit() — rejects with 402 at 0 credits.
//   3. Call the image model with the API key held SERVER-SIDE (never in the browser).
//   4. Upload each image to the public "thumbnails" bucket + log a generations row.
//   5. Return public URLs. On model failure, refund the reserved credit.
//
// Deploy:  supabase functions deploy generate --project-ref vowgdlbvundorxwjdntu --use-api
// Secret:  supabase secrets set VERTEX_API_KEY=<your-vertex-express-or-gemini-key> --project-ref vowgdlbvundorxwjdntu
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1) Authenticate the caller
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please log in to generate.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please log in to generate.' });
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const { prompt, sources = [], aspectRatio = '16:9', resolution } = body;
  if (!prompt) return json(400, { error: 'Missing prompt' });

  // 2) Reserve one credit (atomic; monthly first, then add-on)
  const { data: spent, error: spendErr } = await admin.rpc('spend_credit', { p_user: user.id });
  if (spendErr) return json(500, { error: 'Credit check failed. Please try again.' });
  if (!spent) return json(402, { error: 'No credits left. Please upgrade your plan to generate.' });

  try {
    // 3) Generate — API key stays on the server
    const apiKey = Deno.env.get('VERTEX_API_KEY');
    if (!apiKey) throw new Error('Image service is not configured (missing VERTEX_API_KEY).');

    const ai = new GoogleGenAI({ vertexai: true, apiKey });
    const isPro = resolution === '2K' || resolution === '4K';
    const model = isPro ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';

    const parts: any[] = [];
    for (const s of sources as string[]) {
      const m = /^data:(.*?);base64,(.*)$/.exec(s);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    parts.push({ text: prompt });

    const config: any = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } };
    if (isPro) config.imageConfig.imageSize = resolution;

    const result: any = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config,
    });

    // 4) Upload results to Storage + log them
    const urls: string[] = [];
    let text = '';
    for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
      if (p.inlineData?.data) {
        const bytes = Uint8Array.from(atob(p.inlineData.data), (c) => c.charCodeAt(0));
        const path = `${user.id}/${crypto.randomUUID()}.png`;
        const up = await admin.storage.from('thumbnails').upload(path, bytes, {
          contentType: p.inlineData.mimeType || 'image/png',
          upsert: false,
        });
        if (up.error) throw up.error;
        const { data: pub } = admin.storage.from('thumbnails').getPublicUrl(path);
        urls.push(pub.publicUrl);
        await admin.from('generations').insert({ user_id: user.id, prompt, path });
      } else if (p.text) {
        text += p.text;
      }
    }

    if (!urls.length && !text) throw new Error('No image was generated. Try tweaking your prompt.');
    return json(200, { images: urls, text });
  } catch (genErr: any) {
    // 5) Refund the reserved credit — the user got nothing
    await admin.rpc('refund_credit', { p_user: user.id }).catch(() => {});
    return json(502, { error: genErr?.message || 'Generation failed. Please try again.' });
  }
});
