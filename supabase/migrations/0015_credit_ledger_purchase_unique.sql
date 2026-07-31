-- ═══════════════════════════════════════════════════════════════════════════
-- verify-payment's idempotency check was SELECT-then-grant: two concurrent
-- retries for the same payment (e.g. a double-click, or a client retry after
-- a network blip) could each see no existing ledger row and both grant
-- credits. Make the ledger insert itself the atomic lock: a partial unique
-- index on (user_id, reason) scoped to purchase:* reasons (each of which
-- embeds the Razorpay payment id, so it's already unique per real payment) —
-- other reasons (generation, refund, signup, admin_grant, ...) are NOT
-- unique per user and must stay untouched.
-- ═══════════════════════════════════════════════════════════════════════════
create unique index if not exists credit_ledger_user_purchase_reason_key
  on public.credit_ledger (user_id, reason)
  where reason like 'purchase:%';
