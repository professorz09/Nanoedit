-- ═══════════════════════════════════════════════════════════════════
-- Catch-up migration: brings the repo back in sync with schema changes
-- that were applied directly to production (custom styles + personas)
-- without ever being committed. Written idempotently so it's safe to
-- run against the already-migrated production database.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- 1) style_images: per-user custom styles + embeddings for the auto-style
--    matcher (indexed by the "index-style" Edge Function).
alter table public.style_images add column if not exists meta       jsonb not null default '{}'::jsonb;
alter table public.style_images add column if not exists tagged_at  timestamptz;
alter table public.style_images add column if not exists embedding  vector(768);
alter table public.style_images add column if not exists user_id    uuid references auth.users(id) on delete cascade;

-- Global styles (user_id null) stay public; a user's own custom styles are
-- only visible to them. Replaces the old "read active styles" policy.
drop policy if exists "read active styles" on public.style_images;
drop policy if exists "read styles" on public.style_images;
create policy "read styles" on public.style_images
  for select using (active = true and (user_id is null or user_id = auth.uid()));

drop policy if exists "insert own styles" on public.style_images;
create policy "insert own styles" on public.style_images
  for insert with check (user_id = auth.uid());

drop policy if exists "update own styles" on public.style_images;
create policy "update own styles" on public.style_images
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own styles" on public.style_images;
create policy "delete own styles" on public.style_images
  for delete using (user_id = auth.uid());

-- 2) user_personas: saved reference faces/subjects for the persona flow.
create table if not exists public.user_personas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,
  name       text,
  created_at timestamptz not null default now()
);

alter table public.user_personas enable row level security;
drop policy if exists "owner manages personas" on public.user_personas;
create policy "owner manages personas" on public.user_personas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) match_styles(): cosine-similarity search used by the "match-style"
--    Edge Function (global styles + the caller's own custom styles).
create or replace function public.match_styles(query_embedding vector, match_count integer default 8)
returns table(path text, name text, meta jsonb, similarity double precision)
language sql stable
set search_path = public
as $$
  select s.path, s.name, s.meta, 1 - (s.embedding <=> query_embedding) as similarity
  from public.style_images s
  where s.active = true and s.embedding is not null
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_styles(query_embedding vector, match_count integer, p_user_id uuid)
returns table(path text, name text, meta jsonb, similarity double precision)
language sql stable
set search_path = public
as $$
  select s.path, s.name, s.meta, 1 - (s.embedding <=> query_embedding) as similarity
  from public.style_images s
  where s.active = true
    and s.embedding is not null
    and (s.user_id is null or s.user_id = p_user_id)
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

-- 4) Storage buckets + policies for user-uploaded style refs and personas.
insert into storage.buckets (id, name, public)
values ('personas', 'personas', false)
on conflict (id) do nothing;

drop policy if exists "users write own style files" on storage.objects;
create policy "users write own style files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'styles' and (storage.foldername(name))[1] = 'user' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "users update own style files" on storage.objects;
create policy "users update own style files" on storage.objects
  for update to authenticated
  using (bucket_id = 'styles' and (storage.foldername(name))[1] = 'user' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "users delete own style files" on storage.objects;
create policy "users delete own style files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'styles' and (storage.foldername(name))[1] = 'user' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "read own persona files" on storage.objects;
create policy "read own persona files" on storage.objects
  for select to authenticated
  using (bucket_id = 'personas' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "write own persona files" on storage.objects;
create policy "write own persona files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'personas' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "update own persona files" on storage.objects;
create policy "update own persona files" on storage.objects
  for update to authenticated
  using (bucket_id = 'personas' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own persona files" on storage.objects;
create policy "delete own persona files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'personas' and (storage.foldername(name))[1] = auth.uid()::text);
