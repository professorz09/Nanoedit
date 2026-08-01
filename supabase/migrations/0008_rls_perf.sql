-- ═══════════════════════════════════════════════════════════════════════════
-- Perf: RLS policies were calling auth.uid() directly, which Postgres
-- re-evaluates per ROW scanned instead of once per query (flagged by
-- Supabase's linter as auth_rls_initplan on every policy below). Wrapping it
-- as (select auth.uid()) lets the planner treat it as a constant for the
-- query, cutting DB CPU on every RLS-protected read/write as tables grow.
-- No behavior change — same access rules, just evaluated once.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using ((select auth.uid()) = id);

drop policy if exists "read own ledger" on public.credit_ledger;
create policy "read own ledger" on public.credit_ledger
  for select using ((select auth.uid()) = user_id);

drop policy if exists "read own generations" on public.generations;
create policy "read own generations" on public.generations
  for select using ((select auth.uid()) = user_id);

drop policy if exists "read styles" on public.style_images;
create policy "read styles" on public.style_images
  for select using (active = true and (user_id is null or user_id = (select auth.uid())));

drop policy if exists "insert own styles" on public.style_images;
create policy "insert own styles" on public.style_images
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "update own styles" on public.style_images;
create policy "update own styles" on public.style_images
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "delete own styles" on public.style_images;
create policy "delete own styles" on public.style_images
  for delete using (user_id = (select auth.uid()));

drop policy if exists "owner manages personas" on public.user_personas;
create policy "owner manages personas" on public.user_personas
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
