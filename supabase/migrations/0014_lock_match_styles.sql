-- ═══════════════════════════════════════════════════════════════════════════
-- match_styles() was grantable to anon/authenticated by default, and the
-- 2-arg overload has no ownership filter — any signed-in (or anonymous) user
-- could call it directly via PostgREST RPC and read every user's private
-- custom style rows (path, name, meta), not just active global ones. Both
-- overloads are only ever called from match-style/index.ts using the service
-- role, so neither needs client access — lock both down like
-- spend_credit/refund_credit/expire_subscriptions.
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on function public.match_styles(vector, integer) from public, anon, authenticated;
revoke all on function public.match_styles(vector, integer, uuid) from public, anon, authenticated;
grant execute on function public.match_styles(vector, integer) to service_role;
grant execute on function public.match_styles(vector, integer, uuid) to service_role;
