-- ═══════════════════════════════════════════════════════════════════
-- The billing details of a user's last payment (name + address), saved by dodo-webhook and used by
-- create-checkout to fill Dodo's checkout in advance (user-requested: details already saved).
-- The user can read it with their own profile (existing "read own profile" policy); only the server
-- (service role) writes it — profiles still has no client INSERT/UPDATE policy.
-- ═══════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists billing jsonb;
