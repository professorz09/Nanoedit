-- ═══════════════════════════════════════════════════════════════════
-- The site signs people in with Google only (user-confirmed). The 2 free credits go only to accounts made through
-- Google, so an account made straight against Supabase's email signup (if it were ever left on) gets nothing free.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  gift int := case when coalesce(new.raw_app_meta_data->>'provider', '') = 'google' then 2 else 0 end;
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', gift)
  on conflict (id) do nothing;

  if found and gift > 0 then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, gift, 'signup');
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
