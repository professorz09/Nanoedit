-- ═══════════════════════════════════════════════════════════════════════════
-- Mirrors 0015's purchase:* uniqueness, but for refund reversals. A retried/
-- duplicate refund.succeeded (or dispute.lost) webhook delivery for the same
-- payment must not double-claw-back credits — the ledger insert itself is
-- the atomic idempotency lock, same pattern as the original grant.
-- ═══════════════════════════════════════════════════════════════════════════
create unique index if not exists credit_ledger_user_refund_reason_key
  on public.credit_ledger (user_id, reason)
  where reason like 'refund:%';
