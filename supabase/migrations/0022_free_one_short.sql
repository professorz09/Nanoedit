-- ═══════════════════════════════════════════════════════════════════
-- Free users get enough credits for ONE Short (user-decided) — was 0.
-- Keep in sync with TRIAL_CREDITS in services/plans.ts.
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles alter column credits set default 1;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', 1)
  on conflict (id) do nothing;

  if found then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, 1, 'signup');
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
