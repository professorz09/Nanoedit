// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "create-order"
// Creates a Razorpay order for a signed-in user (Razorpay Standard Web Checkout).
//
// Flow: browser POSTs { item } (an id from _shared/pricing.ts, e.g.
// "plan:pro:monthly"). We look the item up SERVER-SIDE — the client never sends
// an amount, so it can't be tampered with — create the order via the Razorpay
// Orders API (Basic auth: KEY_ID:KEY_SECRET), and return { order_id, amount,
// currency, key_id } for checkout.js to open the modal. The KEY_SECRET NEVER
// leaves this function.
//
// Add-on packs require an active paid plan (pro/studio) — enforced here, not
// just in the UI, so a direct API call can't buy add-on credits from 'free'.
//
// Deploy:  supabase functions deploy create-order --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET  (set with `supabase secrets set`)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CATALOG, CURRENCY, inrPaise } from '../_shared/pricing.ts';

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

  // Top-level guard: anything below that throws WITHOUT this (a transient
  // network blip in admin.auth.getUser(), an unexpected supabase-js error,
  // etc.) escapes as a raw, bodyless 502 from the platform gateway — the
  // client's json().catch(() => null) then has nothing to read an `error`
  // out of, and falls back to a generic, undiagnosable "Something went
  // wrong." Catching it here guarantees a real JSON error body every time.
  try {
    const keyId = Deno.env.get('RAZORPAY_KEY_ID');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) return json(500, { error: 'Payments are not configured.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    // Require a logged-in user — orders are tagged with their id (verified later).
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!jwt) return json(401, { error: 'Please sign in to continue.' });
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json(401, { error: 'Please sign in to continue.' });
    const uid = userData.user.id;

    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const itemId = typeof body?.item === 'string' ? body.item : '';
    const item = CATALOG[itemId];
    if (!item) return json(400, { error: 'Unknown item.' });

    // Add-on credit packs are top-ups for existing subscribers only — a 'free'
    // account can't buy credits without first holding Pro/Studio. Checked here
    // (not just hidden in the UI) so a direct API call can't bypass it.
    if (item.kind === 'addon') {
      const { data: prof, error: profErr } = await admin
        .from('profiles').select('plan').eq('id', uid).single();
      if (profErr) return json(500, { error: 'Could not verify your plan.' });
      if (prof?.plan !== 'pro' && prof?.plan !== 'studio') {
        return json(403, { error: 'Add-on credits require an active Pro or Studio plan.' });
      }
    }

    const amount = inrPaise(item.usd);
    if (amount < 100) return json(400, { error: 'Amount too small.' }); // Razorpay floor: ₹1

    // receipt must be ≤ 40 chars; notes let verify-payment recover item + owner.
    const receipt = `r_${uid.slice(0, 8)}_${Date.now().toString(36)}`.slice(0, 40);
    const resp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: CURRENCY,
        receipt,
        notes: { uid, item: itemId },
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.id) {
      console.error('razorpay_order_failed', resp.status, JSON.stringify(data?.error ?? data));
      return json(502, { error: data?.error?.description || 'Could not start checkout. Please try again.' });
    }
    return json(200, {
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      key_id: keyId, // public key id — safe to send to the browser
      label: item.label,
    });
  } catch (e: any) {
    console.error('create_order_unhandled', e?.message || String(e));
    return json(500, { error: 'Could not start checkout. Please try again.' });
  }
});
