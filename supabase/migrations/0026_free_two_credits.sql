-- ═══════════════════════════════════════════════════════════════════
-- Free users get 2 credits (user-decided): reading a video costs 1 and a Short costs 1, so a new user can
-- actually make their first Short. Keep in sync with TRIAL_CREDITS in services/plans.ts.
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles alter column credits set default 2;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', 2)
  on conflict (id) do nothing;

  if found then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, 2, 'signup');
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
