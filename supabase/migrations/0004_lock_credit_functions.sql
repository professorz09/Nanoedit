-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY: lock down the credit functions.
--
-- In Supabase, functions in the `public` schema are, by default, EXECUTE-able
-- by the `anon` and `authenticated` roles via PostgREST RPC. Because
-- spend_credit()/refund_credit() are SECURITY DEFINER, any logged-in user could
-- otherwise call:
--     supabase.rpc('refund_credit', { p_user: <their own id> })
-- straight from the browser and mint unlimited credits. These functions must be
-- callable ONLY by the server (service role) — never by clients.
--
-- Revoke from PUBLIC/anon/authenticated, then grant to service_role only.
-- (The Edge Function uses the service role, so it keeps working.)
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.spend_credit(uuid)  from public, anon, authenticated;
revoke all on function public.refund_credit(uuid) from public, anon, authenticated;

grant execute on function public.spend_credit(uuid)  to service_role;
grant execute on function public.refund_credit(uuid) to service_role;

-- handle_new_user() is a trigger function and never meant to be called directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Belt-and-braces: make sure future functions in `public` are NOT auto-granted
-- to client roles. (Existing intentional grants — e.g. none client-side — remain.)
alter default privileges in schema public revoke execute on functions from anon, authenticated;
