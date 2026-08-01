// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "verify-payment"
// Verifies a Razorpay payment and grants credits — the ONLY place credits are
// added, and it runs entirely server-side (service role) so the browser can
// never grant itself credits.
//
// Steps:
//   1. Verify the checkout signature: HMAC-SHA256(order_id + "|" + payment_id,
//      KEY_SECRET) must equal razorpay_signature (constant-time compare).
//   2. Re-fetch the order from Razorpay and confirm status:'paid' AND that its
//      notes.uid matches the caller — a valid signature for someone else's order
//      must not credit this user.
//   3. Idempotently grant: skip if this payment already appears in the ledger,
//      else update profiles (plan → set plan+credits+renews_at; addon → bump
//      addon_credits) and append a credit_ledger row.
//
// Deploy:  supabase functions deploy verify-payment --project-ref vowgdlbvundorxwjdntu --use-api
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
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

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

// HMAC-SHA256(message, secret) → lowercase hex.
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// Length-safe constant-time string compare (avoids timing side-channels).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function renewsAt(cycle?: string): string {
  const d = new Date();
  if (cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // default: monthly
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // Top-level guard, same reasoning as create-order: without it, anything
  // that throws outside the existing inner try/catches (admin.auth.getUser(),
  // the ledger claim insert, hmacHex/timingSafeEqual) escapes as a bodyless
  // platform 502 — the client can't read an `error` out of that and falls
  // back to a generic "Something went wrong" with nothing to diagnose.
  try {
  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json(500, { error: 'Payments are not configured.' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!jwt) return json(401, { error: 'Please sign in to continue.' });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: 'Please sign in to continue.' });
  const uid = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const orderId = String(body?.razorpay_order_id ?? '');
  const paymentId = String(body?.razorpay_payment_id ?? '');
  const signature = String(body?.razorpay_signature ?? '');
  if (!orderId || !paymentId || !signature) return json(400, { error: 'Missing payment details.' });

  // 1) Signature check.
  const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`);
  if (!timingSafeEqual(expected, signature)) return json(400, { error: 'Payment verification failed.' });

  // 2) Confirm the order is actually paid AND owned by this user (re-fetch from
  //    Razorpay — never trust the client for amount/status/ownership).
  let order: any;
  try {
    const r = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
      headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
    });
    order = await r.json().catch(() => ({}));
    if (!r.ok || !order?.id) return json(502, { error: 'Could not confirm the payment. Please contact support.' });
  } catch {
    return json(502, { error: 'Could not confirm the payment. Please contact support.' });
  }
  if (order.status !== 'paid') return json(400, { error: 'Payment not completed.' });
  // Fail CLOSED: require notes.uid to be present AND match. The order id,
  // payment id and signature are all visible to the paying browser, so a
  // missing notes.uid (a dashboard-created order, a future code path) must
  // never be treated as "unowned, so allow it" — that would let a different
  // signed-in account replay someone else's payment details for credit.
  if (order?.notes?.uid !== uid) return json(403, { error: 'This order belongs to another account.' });

  const item = CATALOG[order?.notes?.item];
  if (!item) return json(400, { error: 'Unknown item.' });

  // Confirm the amount actually paid matches what this item should cost —
  // defense in depth against a stale/tampered order somehow reaching here
  // with the right notes.item but a wrong amount.
  if (order.currency !== CURRENCY || order.amount !== inrPaise(item.usd)) {
    console.error('amount_mismatch', paymentId, order.amount, order.currency);
    return json(400, { error: 'Payment amount does not match the item.' });
  }

  // 3) Idempotency — claim the ledger row FIRST (atomically, via a unique
  //    index on (user_id, reason) for purchase:* reasons — see migration
  //    0015). Two concurrent verify calls for the same payment can no longer
  //    both pass a SELECT-then-grant race and double-credit: only one insert
  //    wins, the other gets 23505 and reports alreadyGranted.
  const ledgerReason = `purchase:${item.kind === 'plan' ? item.plan : 'addon'}:${paymentId}`;
  const { error: claimErr } = await admin
    .from('credit_ledger').insert({ user_id: uid, delta: item.credits, reason: ledgerReason });
  if (claimErr) {
    if (claimErr.code === '23505') return json(200, { ok: true, alreadyGranted: true });
    console.error('claim_failed', paymentId, claimErr.message);
    return json(500, { error: 'Payment succeeded but crediting failed. Please contact support.' });
  }

  // Grant credits. If this fails AFTER the claim above, delete the claim so
  // a retry can re-attempt instead of being told "already granted" forever.
  try {
    if (item.kind === 'plan') {
      const { error } = await admin.from('profiles').update({
        plan: item.plan,
        credits: item.credits,          // plan credits reset to the plan's allotment
        renews_at: renewsAt(item.cycle),
        updated_at: new Date().toISOString(),
      }).eq('id', uid);
      if (error) throw error;
    } else {
      // addon credits stack on top — read-modify-write.
      const { data: prof, error: readErr } = await admin
        .from('profiles').select('addon_credits').eq('id', uid).single();
      if (readErr) throw readErr;
      const { error } = await admin.from('profiles').update({
        addon_credits: (prof?.addon_credits ?? 0) + item.credits,
        updated_at: new Date().toISOString(),
      }).eq('id', uid);
      if (error) throw error;
    }
  } catch (e: any) {
    console.error('grant_failed', paymentId, e?.message || String(e));
    // supabase-js's .from() builder is PromiseLike, not a real Promise — it
    // implements .then() but NOT .catch(), so chaining .catch() here throws a
    // synchronous TypeError instead of ever swallowing a failed delete.
    try { await admin.from('credit_ledger').delete().eq('user_id', uid).eq('reason', ledgerReason); } catch (_) { /* best-effort */ }
    return json(500, { error: 'Payment succeeded but crediting failed. Please contact support.' });
  }

  return json(200, { ok: true, credits: item.credits, item: order.notes.item });
  } catch (e: any) {
    console.error('verify_payment_unhandled', e?.message || String(e));
    return json(500, { error: 'Payment succeeded but verification failed. Please contact support with your payment reference.' });
  }
});
