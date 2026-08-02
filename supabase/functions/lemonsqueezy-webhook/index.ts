// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "lemonsqueezy-webhook"
// Verifies a Lemon Squeezy webhook and grants credits — the ONLY place
// credits are added for a purchase, running entirely server-side (service
// role) so the browser can never grant itself credits. Lemon Squeezy's
// checkout is a redirect flow with no client-side confirm step, so crediting
// happens purely from this webhook.
//
// Steps:
//   1. Verify the X-Signature header: HMAC-SHA256 (hex) of the raw request
//      body using LEMONSQUEEZY_WEBHOOK_SECRET, timing-safe compared.
//   2. On an `order_created` event with status "paid", read {uid, item} back
//      from meta.custom_data (set by create-checkout's checkout_data.custom).
//   3. Idempotently grant: skip if this order already appears in the ledger,
//      else update profiles (plan → set plan+credits+renews_at; addon → bump
//      addon_credits) and append a credit_ledger row.
//
// Auth: NOT a user-authenticated call — Lemon Squeezy's servers call this
// directly, so verify_jwt is disabled and the signature IS the authentication.
//
// Deploy:  supabase functions deploy lemonsqueezy-webhook --project-ref vowgdlbvundorxwjdntu --use-api --no-verify-jwt
// Secrets: LEMONSQUEEZY_WEBHOOK_SECRET (set when creating the webhook endpoint
//          in the dashboard — Settings → Webhooks)
// Dashboard: add a webhook pointing at
//   https://vowgdlbvundorxwjdntu.supabase.co/functions/v1/lemonsqueezy-webhook
//   subscribed to at least: order_created
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CATALOG } from '../_shared/pricing.ts';

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function renewsAt(cycle?: string): string {
  const d = new Date();
  if (cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // default: monthly
  return d.toISOString();
}

// HMAC-SHA256 hex digest via Web Crypto (no node:crypto needed) — Lemon
// Squeezy signs with the raw request body and expects a lowercase hex
// digest in X-Signature, not base64.
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Timing-safe string compare — a plain `===` leaks timing info about how
// many leading characters matched, which is exactly what signature
// verification needs to not leak.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const secret = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET');
    if (!secret) { console.error('lemonsqueezy_webhook_not_configured'); return json(500, { error: 'Webhook not configured.' }); }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const rawBody = await req.text();
    const signature = req.headers.get('x-signature') ?? '';
    if (!signature) return json(400, { error: 'Missing signature.' });

    const expectedSig = await hmacHex(secret, rawBody);
    if (!timingSafeEqual(expectedSig, signature)) {
      console.error('lemonsqueezy_signature_invalid', 'sig_len_received:', signature.length);
      return json(400, { error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    const eventName = event?.meta?.event_name;
    if (eventName !== 'order_created') {
      // Every other event (order_refunded, subscription_*, etc.) — nothing
      // for us to do; failed generations already refund on our side, and
      // there's no separate "reserve then confirm" step to reconcile.
      return json(200, { ok: true, skipped: eventName });
    }

    const attrs = event?.data?.attributes || {};
    const orderId = event?.data?.id;
    const meta = event?.meta?.custom_data || {};
    const uid = meta.uid;
    const itemId = meta.item;
    if (!orderId || !uid || !itemId) {
      console.error('lemonsqueezy_webhook_missing_fields', orderId, uid, itemId);
      return json(200, { ok: true }); // ack — nothing actionable, don't make Lemon Squeezy retry forever
    }
    if (attrs.status !== 'paid') {
      // order_created fires for pending states too (e.g. bank transfers) —
      // only "paid" means money actually moved.
      return json(200, { ok: true, skipped: `status:${attrs.status}` });
    }
    const item = CATALOG[itemId];
    if (!item) {
      console.error('lemonsqueezy_webhook_unknown_item', itemId);
      return json(200, { ok: true });
    }

    // Defense in depth — never grant credits purely on the strength of the
    // itemId in metadata without SOME confirmation money actually moved.
    // Lemon Squeezy normalizes `subtotal_usd` to USD regardless of what
    // currency the customer actually paid in (unlike the charge total,
    // which follows their local currency) — comparing against that instead
    // of the raw `subtotal`/`currency` sidesteps the exact class of bug that
    // broke the old Dodo integration (a localized-currency charge failing an
    // exact-match check and silently eating a successful payment). Kept as a
    // floor against a $0/negative amount (a real bypass signal) rather than
    // a strict equality check — metadata.uid/item is set server-side at
    // checkout creation and can't be forged without LEMONSQUEEZY_API_KEY, so
    // it remains the trustworthy source for WHAT to grant.
    const expectedCents = Math.round(item.usd * 100);
    const paidUsdCents = attrs.subtotal_usd;
    if (typeof paidUsdCents !== 'number' || paidUsdCents <= 0) {
      console.error('lemonsqueezy_zero_amount', orderId, itemId, paidUsdCents);
      return json(400, { error: 'Payment amount looks invalid.' });
    }
    if (paidUsdCents !== expectedCents) {
      // Not a hard failure — log for visibility but still grant the credits
      // the metadata says were paid for.
      console.error('lemonsqueezy_amount_mismatch_nonblocking', orderId, itemId, paidUsdCents, expectedCents);
    }

    // Idempotency — claim the ledger row FIRST (atomically, via the unique
    // index on (user_id, reason) for purchase:* reasons — see migration
    // 0015). A retried/duplicate webhook delivery for the same order can no
    // longer double-credit: only the first insert wins, the rest report
    // alreadyGranted.
    const ledgerReason = `purchase:${item.kind === 'plan' ? item.plan : 'addon'}:${orderId}`;
    const { error: claimErr } = await admin
      .from('credit_ledger').insert({ user_id: uid, delta: item.credits, reason: ledgerReason });
    if (claimErr) {
      if (claimErr.code === '23505') return json(200, { ok: true, alreadyGranted: true });
      console.error('lemonsqueezy_claim_failed', orderId, claimErr.message);
      return json(500, { error: 'Payment succeeded but crediting failed.' });
    }

    // Grant credits. If this fails AFTER the claim above, delete the claim so
    // a retried webhook delivery can re-attempt instead of being told
    // "already granted" forever.
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
      console.error('lemonsqueezy_grant_failed', orderId, e?.message || String(e));
      try { await admin.from('credit_ledger').delete().eq('user_id', uid).eq('reason', ledgerReason); } catch (_) { /* best-effort */ }
      return json(500, { error: 'Payment succeeded but crediting failed.' });
    }

    return json(200, { ok: true, credits: item.credits, item: itemId });
  } catch (e: any) {
    console.error('lemonsqueezy_webhook_unhandled', e?.message || String(e));
    return json(500, { error: 'Unhandled webhook error.' });
  }
});
