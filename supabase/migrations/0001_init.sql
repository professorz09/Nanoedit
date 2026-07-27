-- ═══════════════════════════════════════════════════════════════════
-- Thumbmagic — auth + per-user credits schema
-- Run this in Supabase → SQL editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

-- 1) One profile row PER USER (keyed to Supabase auth.users)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  plan               text not null default 'free' check (plan in ('free','pro','studio')),
  credits            int  not null default 5,   -- monthly credits (reset on renews_at)
  addon_credits      int  not null default 0,   -- one-time top-ups, do NOT reset
  stripe_customer_id text,
  stripe_sub_id      text,
  renews_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2) Audit trail of every credit change (per user)
create table if not exists public.credit_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      int  not null,               -- negative = spent, positive = granted
  reason     text not null,               -- 'generation' | 'subscription' | 'addon' | 'signup'
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);

-- 3) Auto-create a profile when a new user signs up (Google OAuth)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', 5)
  on conflict (id) do nothing;

  insert into public.credit_ledger (user_id, delta, reason)
  values (new.id, 5, 'signup');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Row Level Security — a user can only read their OWN profile/ledger.
--    Credits are only ever mutated server-side (service-role key), never by the client.
alter table public.profiles      enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "read own ledger" on public.credit_ledger;
create policy "read own ledger" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- 5) Atomic "spend 1 credit" helper (monthly first, then add-on).
--    Called from the server with the service role. Returns true if a credit was spent.
create or replace function public.spend_credit(p_user uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  ok boolean := false;
begin
  update public.profiles
     set credits = credits - 1, updated_at = now()
   where id = p_user and credits > 0;
  if found then
    insert into public.credit_ledger(user_id, delta, reason) values (p_user, -1, 'generation');
    return true;
  end if;

  update public.profiles
     set addon_credits = addon_credits - 1, updated_at = now()
   where id = p_user and addon_credits > 0;
  if found then
    insert into public.credit_ledger(user_id, delta, reason) values (p_user, -1, 'generation');
    return true;
  end if;

  return ok;
end;
$$;
