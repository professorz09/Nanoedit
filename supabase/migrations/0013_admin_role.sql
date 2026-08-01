-- ═══════════════════════════════════════════════════════════════════════════
-- Minimal admin role, scoped to managing the GLOBAL style pool from inside the
-- app (replaces needing to run scripts/tag-styles.mjs locally with a
-- service-role key). is_admin is a plain column, NOT exposed to any client
-- write path — profiles already has zero client-side INSERT/UPDATE policies
-- (server/service-role only), so adding this column introduces no new write
-- vector. It's set here directly, and only ever checked server-side (in the
-- "admin-styles" Edge Function) — never trusted from the client.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists is_admin boolean not null default false;

update public.profiles set is_admin = true, updated_at = now() where email = 'rahulzcode@gmail.com';
