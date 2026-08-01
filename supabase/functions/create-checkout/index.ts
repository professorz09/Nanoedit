// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "create-checkout"
// Creates a Dodo Payments checkout session for a signed-in user and returns
// the hosted checkout URL to redirect the browser to.
//
// Flow: browser POSTs { item } (an id from _shared/pricing.ts, e.g.
// "plan:pro:monthly"). We look the item up SERVER-SIDE — the client never
// sends an amount, so it can't be tampered with — create a checkout session
// against the single "Pay What You Want" product (DODO_PRODUCT_ID), passing
// the exact price for this item, and return { checkout_url } for the browser
// to navigate to. Dodo's hosted checkout page collects payment; on success it
// redirects back to `return_url`, and the "dodo-webhook" function grants
// credits server-side once Dodo confirms the payment.
//
// Add-on packs require an active paid plan (pro/studio) — enforced here, not
// just in the UI, so a direct API call can't buy add-on credits from 'free'.
//
// Deploy:  supabase functions deploy create-checkout --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: DODO_PAYMENTS_API_KEY (required)
//          DODO_PAYMENTS_ENVIRONMENT = test_mode | live_mode (optional, defaults to test_mode)
//          APP_URL = https://podcastflux.com (optional, used for the post-checkout return_url)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CATALOG, DODO_PRODUCT_ID } from '../_shared/pricing.ts';

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

  // Top-level guard: anything below that throws (a transient network blip in
  // admin.auth.getUser(), an unexpected supabase-js error, etc.) returns a
  // real JSON error instead of an opaque, bodyless platform 502.
  try {
    const apiKey = Deno.env.get('DODO_PAYMENTS_API_KEY');
    if (!apiKey) return json(500, { error: 'Payments are not configured.' });
    const mode = Deno.env.get('DODO_PAYMENTS_ENVIRONMENT') === 'live_mode' ? 'live_mode' : 'test_mode';
    const base = mode === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
    const appUrl = Deno.env.get('APP_URL') || 'https://podcastflux.com';

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    // Require a logged-in user — the checkout is tagged with their id (read
    // back from metadata by the webhook to know who to credit).
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!jwt) return json(401, { error: 'Please sign in to continue.' });
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json(401, { error: 'Please sign in to continue.' });
    const uid = userData.user.id;
    const email = userData.user.email;

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

    // Dodo Payments amounts are in the smallest currency unit (cents for USD).
    const amountCents = Math.round(item.usd * 100);

    const resp = await fetch(`${base}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: [{ product_id: DODO_PRODUCT_ID, quantity: 1, amount: amountCents }],
        customer: email ? { email } : null,
        return_url: `${appUrl}/?dodo_checkout=return&item=${encodeURIComponent(itemId)}`,
        // Read back by dodo-webhook to know who to credit and for what.
        metadata: { uid, item: itemId },
        confirm: true,
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.checkout_url) {
      console.error('dodo_checkout_failed', resp.status, JSON.stringify(data));
      return json(502, { error: data?.message || data?.error || 'Could not start checkout. Please try again.' });
    }
    return json(200, { checkout_url: data.checkout_url, label: item.label });
  } catch (e: any) {
    console.error('create_checkout_unhandled', e?.message || String(e));
    return json(500, { error: 'Could not start checkout. Please try again.' });
  }
});
