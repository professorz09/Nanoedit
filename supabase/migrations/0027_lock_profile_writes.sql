-- ═══════════════════════════════════════════════════════════════════
-- Defense in depth (user asked: "koi credits bypass to nahi kar skta"): RLS already has no write policy on these
-- tables, so a signed-in user can't change their credits, plan or admin flag — this also takes the table-level
-- write grants away from the browser roles. Only the server (service role) and the credit functions write them.
-- ═══════════════════════════════════════════════════════════════════
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke insert, update, delete, truncate on public.credit_ledger from anon, authenticated;
