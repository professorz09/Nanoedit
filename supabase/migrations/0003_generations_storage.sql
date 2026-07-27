-- ═══════════════════════════════════════════════════════════════════
-- Persisted generations + Storage bucket + credit refund helper.
-- Powers the secure "generate" Edge Function (image saved on creation).
-- ═══════════════════════════════════════════════════════════════════

-- 1) History of every saved thumbnail (image bytes live in Storage; we keep
--    the path + prompt here). Rows are inserted server-side (service role).
create table if not exists public.generations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  prompt     text,
  path       text not null,             -- storage object path in the 'thumbnails' bucket
  created_at timestamptz not null default now()
);
create index if not exists generations_user_idx on public.generations(user_id, created_at desc);

alter table public.generations enable row level security;
drop policy if exists "read own generations" on public.generations;
create policy "read own generations" on public.generations
  for select using (auth.uid() = user_id);

-- 2) Public Storage bucket for finished thumbnails (safe to serve via CDN URL).
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

-- 3) Refund one credit if generation fails AFTER a credit was reserved.
--    Called server-side (service role) by the Edge Function.
create or replace function public.refund_credit(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set credits = credits + 1, updated_at = now() where id = p_user;
  insert into public.credit_ledger(user_id, delta, reason) values (p_user, 1, 'refund');
end;
$$;
