// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "dodo-webhook"
// Verifies a Dodo Payments webhook and grants credits — the ONLY place
// credits are added for a purchase, running entirely server-side (service
// role) so the browser can never grant itself credits. This replaces
// Razorpay's "verify-payment" — Dodo's checkout is a redirect flow with no
// client-side confirm step, so crediting happens purely from this webhook.
//
// Steps:
//   1. Verify the webhook signature via the Standard Webhooks scheme
//      (webhook-id / webhook-signature / webhook-timestamp headers, HMAC
//      against DODO_WEBHOOK_SECRET) using the `standardwebhooks` library.
//   2. On a `payment.succeeded` event, read {uid, item} back from the
//      metadata this payment's checkout session was created with.
//   3. Idempotently grant: skip if this payment already appears in the
//      ledger, else update profiles (plan → set plan+credits+renews_at;
//      addon → bump addon_credits) and append a credit_ledger row.
//
// Auth: NOT a user-authenticated call — Dodo's servers call this directly, so
// verify_jwt is disabled and the webhook signature IS the authentication.
//
// Deploy:  supabase functions deploy dodo-webhook --project-ref vowgdlbvundorxwjdntu --use-api --no-verify-jwt
// Secrets: DODO_WEBHOOK_SECRET (from the webhook endpoint created in the Dodo dashboard)
// Dodo dashboard: add a webhook endpoint pointing at
//   https://vowgdlbvundorxwjdntu.supabase.co/functions/v1/dodo-webhook
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { CATALOG } from '../_shared/pricing.ts';

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function renewsAt(cycle?: string): string {
  const d = new Date();
  if (cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // default: monthly
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const secret = Deno.env.get('DODO_WEBHOOK_SECRET');
    if (!secret) { console.error('dodo_webhook_not_configured'); return json(500, { error: 'Webhook not configured.' }); }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const rawBody = await req.text();
    const webhookHeaders = {
      'webhook-id': req.headers.get('webhook-id') ?? '',
      'webhook-signature': req.headers.get('webhook-signature') ?? '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
    };

    const webhook = new Webhook(secret);
    try {
      await webhook.verify(rawBody, webhookHeaders);
    } catch (e: any) {
      console.error('dodo_signature_invalid', e?.message || String(e));
      return json(400, { error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    if (event?.type !== 'payment.succeeded') {
      // Every other event (payment.failed/processing, subscriptions, etc.) —
      // nothing for us to do; failed generations already refund on our side,
      // and there's no separate "reserve then confirm" step to reconcile.
      return json(200, { ok: true, skipped: event?.type });
    }

    const paymentId = event.data?.payment_id;
    const meta = event.data?.metadata || {};
    const uid = meta.uid;
    const itemId = meta.item;
    if (!paymentId || !uid || !itemId) {
      console.error('dodo_webhook_missing_fields', paymentId, uid, itemId);
      return json(200, { ok: true }); // ack — nothing actionable, don't make Dodo retry forever
    }
    const item = CATALOG[itemId];
    if (!item) {
      console.error('dodo_webhook_unknown_item', itemId);
      return json(200, { ok: true });
    }

    // Defense in depth — never grant credits purely on the strength of the
    // itemId in metadata. Re-confirm the amount Dodo actually says was paid
    // matches what that item should cost (metadata is set by us at checkout
    // creation and can't be forged without DODO_PAYMENTS_API_KEY, but this
    // still guards against a future bug in create-checkout, or Dodo's
    // checkout unexpectedly allowing the amount to be edited).
    const expectedCents = Math.round(item.usd * 100);
    const paidCents = event.data?.total_amount;
    const paidCurrency = String(event.data?.currency ?? '').toUpperCase();
    if (paidCents !== expectedCents || paidCurrency !== 'USD') {
      console.error('dodo_amount_mismatch', paymentId, itemId, paidCents, paidCurrency, expectedCents);
      return json(400, { error: 'Payment amount does not match the item.' });
    }

    // Idempotency — claim the ledger row FIRST (atomically, via the unique
    // index on (user_id, reason) for purchase:* reasons — see migration
    // 0015). A retried/duplicate webhook delivery for the same payment can no
    // longer double-credit: only the first insert wins, the rest report
    // alreadyGranted.
    const ledgerReason = `purchase:${item.kind === 'plan' ? item.plan : 'addon'}:${paymentId}`;
    const { error: claimErr } = await admin
      .from('credit_ledger').insert({ user_id: uid, delta: item.credits, reason: ledgerReason });
    if (claimErr) {
      if (claimErr.code === '23505') return json(200, { ok: true, alreadyGranted: true });
      console.error('dodo_claim_failed', paymentId, claimErr.message);
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
      console.error('dodo_grant_failed', paymentId, e?.message || String(e));
      try { await admin.from('credit_ledger').delete().eq('user_id', uid).eq('reason', ledgerReason); } catch (_) { /* best-effort */ }
      return json(500, { error: 'Payment succeeded but crediting failed.' });
    }

    return json(200, { ok: true, credits: item.credits, item: itemId });
  } catch (e: any) {
    console.error('dodo_webhook_unhandled', e?.message || String(e));
    return json(500, { error: 'Unhandled webhook error.' });
  }
});
