-- ═══════════════════════════════════════════════════════════════════════════
-- Re-assert the credit-function lockdown from 0004.
--
-- Audit (2026-07-31) found spend_credit()/refund_credit() grantable to
-- anon/authenticated in production despite 0004 — some later manual change
-- (dashboard SQL, `grant ... on all functions in schema public to authenticated`,
-- etc.) had re-opened them. Any signed-in user could call
-- supabase.rpc('refund_credit', { p_user: <uid> }) directly from the browser
-- and mint unlimited free credits. Re-run the lockdown so it's idempotent and
-- re-appliable if this ever drifts again.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.spend_credit(uuid)  from public, anon, authenticated;
revoke all on function public.refund_credit(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user()   from public, anon, authenticated;

grant execute on function public.spend_credit(uuid)  to service_role;
grant execute on function public.refund_credit(uuid) to service_role;

alter default privileges in schema public revoke execute on functions from anon, authenticated;
