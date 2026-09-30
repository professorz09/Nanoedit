// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "ls-webhook"
// Lemon Squeezy's webhook — grants the credits of a paid order, and takes them back on a full refund.
// Same rules as dodo-webhook: the server alone adds credits; each order is granted once (a ledger row
// claimed first, unique on (user_id, reason)); a refund claws back what that order granted.
//
// Auth: Lemon Squeezy calls this directly (verify_jwt off) — the X-Signature header (HMAC-SHA256 of the
// raw body with LEMONSQUEEZY_WEBHOOK_SECRET) is the authentication.
// Test-mode orders grant credits only to admins, so a test card can never top up a customer.
//
// Lemon Squeezy → Settings → Webhooks: https://<project>.supabase.co/functions/v1/ls-webhook,
// events order_created + order_refunded, signing secret = LEMONSQUEEZY_WEBHOOK_SECRET.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CATALOG } from '../_shared/pricing.ts';

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// user-reported: a plan buy set renews_at to "now + cycle" even when the plan already ran longer (a yearly Starter
// buying monthly Creator lost 11 months — and, at that early expiry, all its plan credits). Now the time already
// paid for is never cut: the same plan again adds its cycle on top of the current end; another plan ends at
// whichever is later, the current end or now + its cycle.
function renewsAt(cycle: string | undefined, current?: string | null, samePlan = false): string {
  const now = Date.now();
  const end = current ? Date.parse(current) : NaN;
  const active = Number.isFinite(end) && end > now;
  const d = new Date(samePlan && active ? end : now);
  if (cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // default: monthly
  return new Date(active ? Math.max(d.getTime(), end) : d.getTime()).toISOString();
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sameText = (a: string, b: string) => {  // constant-time compare
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const validSignature = async (secret: string, raw: string, signature: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  return !!signature && sameText(mac, signature.trim().toLowerCase());
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const secret = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET');
    if (!secret) { console.error('ls_webhook_not_configured'); return json(500, { error: 'Webhook not configured.' }); }

    const raw = await req.text();
    if (!(await validSignature(secret, raw, req.headers.get('x-signature') ?? ''))) {
      console.error('ls_signature_invalid');
      return json(400, { error: 'Invalid webhook signature' });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const event = JSON.parse(raw);
    const name = event?.meta?.event_name || req.headers.get('x-event-name');
    const custom = event?.meta?.custom_data || {};
    const orderId = event?.data?.id;
    const attrs = event?.data?.attributes || {};
    if (!orderId) return json(200, { ok: true });  // nothing to act on

    if (name === 'order_refunded') {
      // only a full refund takes the credits back (a partial one is logged for a person to look at)
      if (!attrs.refunded) { console.error('ls_partial_refund_ignored', orderId, attrs.refunded_amount); return json(200, { ok: true }); }
      const { data: original, error: findErr } = await admin.from('credit_ledger')
        .select('user_id, delta, reason').like('reason', `purchase:%:ls_${orderId}`).maybeSingle();
      if (findErr) { console.error('ls_clawback_lookup_failed', orderId, findErr.message); return json(500, { error: 'Lookup failed.' }); }
      if (!original) return json(200, { ok: true, skipped: 'no_matching_purchase' });
      const uid = original.user_id;
      const granted = original.delta as number;
      const kindOrPlan = String(original.reason).split(':')[1];
      const refundReason = `refund:ls_${orderId}`;
      const { error: claimErr } = await admin.from('credit_ledger').insert({ user_id: uid, delta: -granted, reason: refundReason });
      if (claimErr) {
        if (claimErr.code === '23505') return json(200, { ok: true, alreadyReversed: true });
        console.error('ls_clawback_claim_failed', orderId, claimErr.message);
        return json(500, { error: 'Could not record the refund.' });
      }
      try {
        if (kindOrPlan === 'addon') {
          const { data: prof, error: readErr } = await admin.from('profiles').select('addon_credits').eq('id', uid).single();
          if (readErr) throw readErr;
          const { error } = await admin.from('profiles').update({ addon_credits: Math.max(0, (prof?.addon_credits ?? 0) - granted), updated_at: new Date().toISOString() }).eq('id', uid);
          if (error) throw error;
        } else {
          const { data: prof, error: readErr } = await admin.from('profiles').select('credits, plan').eq('id', uid).single();
          if (readErr) throw readErr;
          const update: Record<string, unknown> = { credits: Math.max(0, (prof?.credits ?? 0) - granted), updated_at: new Date().toISOString() };
          if (prof?.plan === kindOrPlan) { update.plan = 'free'; update.renews_at = null; }
          const { error } = await admin.from('profiles').update(update).eq('id', uid);
          if (error) throw error;
        }
      } catch (e: any) {
        console.error('ls_clawback_apply_failed', orderId, e?.message || String(e));
        try { await admin.from('credit_ledger').delete().eq('user_id', uid).eq('reason', refundReason); } catch (_) { /* best-effort */ }
        return json(500, { error: 'Refund recorded but reversal failed.' });
      }
      return json(200, { ok: true, reversed: granted });
    }

    if (name !== 'order_created') return json(200, { ok: true, skipped: name });
    if (attrs.status !== 'paid') return json(200, { ok: true, skipped: `status ${attrs.status}` });

    const uid = custom.uid;
    const itemId = custom.item;
    const item = itemId ? CATALOG[itemId] : undefined;
    if (!uid || !item) { console.error('ls_webhook_missing_fields', orderId, uid, itemId); return json(200, { ok: true }); }

    // a test-mode order (test card) grants credits only to an admin
    if (event?.meta?.test_mode || attrs.test_mode) {
      const { data: who } = await admin.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
      if (!who?.is_admin) { console.error('ls_test_order_not_admin', orderId, uid); return json(200, { ok: true, skipped: 'test order' }); }
    }

    // a floor against a $0 order; custom_data (set by create-checkout) says what to grant
    if (typeof attrs.total !== 'number' || attrs.total <= 0) {
      console.error('ls_zero_amount', orderId, attrs.total);
      return json(400, { error: 'Order amount looks invalid.' });
    }
    if (attrs.subtotal_usd !== Math.round(item.usd * 100)) {
      console.error('ls_amount_mismatch_nonblocking', orderId, itemId, attrs.subtotal_usd, attrs.total, attrs.currency);
    }

    const ledgerReason = `purchase:${item.kind === 'plan' ? item.plan : 'addon'}:ls_${orderId}`;
    const { error: claimErr } = await admin.from('credit_ledger').insert({ user_id: uid, delta: item.credits, reason: ledgerReason });
    if (claimErr) {
      if (claimErr.code === '23505') return json(200, { ok: true, alreadyGranted: true });
      console.error('ls_claim_failed', orderId, claimErr.message);
      return json(500, { error: 'Payment succeeded but crediting failed.' });
    }
    try {
      if (item.kind === 'plan') {
        const { data: prof, error: readErr } = await admin.from('profiles').select('credits, plan, renews_at').eq('id', uid).single();
        if (readErr) throw readErr;
        const { error } = await admin.from('profiles').update({
          plan: item.plan, credits: (prof?.credits ?? 0) + item.credits,
          renews_at: renewsAt(item.cycle, prof?.renews_at, prof?.plan === item.plan), updated_at: new Date().toISOString(),
        }).eq('id', uid);
        if (error) throw error;
      } else {
        const { data: prof, error: readErr } = await admin.from('profiles').select('addon_credits').eq('id', uid).single();
        if (readErr) throw readErr;
        const { error } = await admin.from('profiles').update({
          addon_credits: (prof?.addon_credits ?? 0) + item.credits, updated_at: new Date().toISOString(),
        }).eq('id', uid);
        if (error) throw error;
      }
    } catch (e: any) {
      console.error('ls_grant_failed', orderId, e?.message || String(e));
      try { await admin.from('credit_ledger').delete().eq('user_id', uid).eq('reason', ledgerReason); } catch (_) { /* best-effort */ }
      return json(500, { error: 'Payment succeeded but crediting failed.' });
    }
    return json(200, { ok: true, credits: item.credits, item: itemId });
  } catch (e: any) {
    console.error('ls_webhook_unhandled', e?.message || String(e));
    return json(500, { error: 'Unhandled webhook error.' });
  }
});
