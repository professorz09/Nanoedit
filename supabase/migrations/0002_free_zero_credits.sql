-- ═══════════════════════════════════════════════════════════════════
-- Free users get ZERO credits — they must buy a plan to generate.
-- Replaces the old "5 free thumbnails" trial.
-- ═══════════════════════════════════════════════════════════════════

-- 1) New signups default to 0 monthly credits (was 5)
alter table public.profiles alter column credits set default 0;

-- 2) Signup trigger: create the profile with 0 credits and NO signup grant.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', 0)
  on conflict (id) do nothing;
  return new;
end;
$$;
