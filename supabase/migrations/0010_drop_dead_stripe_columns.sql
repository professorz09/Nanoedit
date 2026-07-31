-- ═══════════════════════════════════════════════════════════════════════════
-- Cleanup: profiles.stripe_customer_id / stripe_sub_id are leftovers from an
-- abandoned Stripe integration — payments run on Razorpay now (create-order /
-- verify-payment), which never reads or writes these columns. Nothing else in
-- the codebase references them either. Dropping dead columns so the schema
-- doesn't keep implying a Stripe integration that no longer exists.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles drop column if exists stripe_customer_id;
alter table public.profiles drop column if exists stripe_sub_id;
