-- ═══════════════════════════════════════════════════════════════════
-- Hybrid custom styles + per-user personas.
--
-- Until now the style pool was global-only (service-role writes). This
-- lets every signed-in user add THEIR OWN style thumbnails and persona
-- faces on top of the curated global defaults:
--
--   • style_images.user_id  NULL  → global default (shown to everyone)
--                            uuid  → private to that user
--   • Users can read global + their own; write only their own rows/files.
--   • Persona faces live in a PRIVATE bucket (owner-only) — a person's
--     face is not public; the client uses signed URLs, the generate
--     function reads them with the service role.
--
-- The same AI pipeline (vision tag + 768-dim embedding) indexes user
-- uploads via the "index-style" edge function, so custom styles work in
-- both the Recreate tab and the YouTube auto-style flow immediately.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Ownership column ──────────────────────────────────────────────
alter table public.style_images
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists style_images_user_idx on public.style_images(user_id);

-- ── 2) RLS: read global + own; write only your own ───────────────────
-- Replaces the old "read active styles" (global-only) policy.
drop policy if exists "read active styles" on public.style_images;
drop policy if exists "read styles" on public.style_images;
create policy "read styles" on public.style_images
  for select using (
    active = true and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "insert own styles" on public.style_images;
create policy "insert own styles" on public.style_images
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own styles" on public.style_images;
create policy "update own styles" on public.style_images
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "delete own styles" on public.style_images;
create policy "delete own styles" on public.style_images
  for delete to authenticated
  using (user_id = auth.uid());

-- ── 3) Storage: users may write ONLY under styles/user/<their-uid>/... ─
-- Read stays public (bucket is public); writes are folder-scoped per user.
drop policy if exists "users write own style files" on storage.objects;
create policy "users write own style files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'styles'
    and (storage.foldername(name))[1] = 'user'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "users update own style files" on storage.objects;
create policy "users update own style files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'styles'
    and (storage.foldername(name))[1] = 'user'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "users delete own style files" on storage.objects;
create policy "users delete own style files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'styles'
    and (storage.foldername(name))[1] = 'user'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ── 4) Topic-aware match: return global + the caller's own styles ─────
-- Overload of match_styles with a user filter. The match-style edge
-- function (service role) passes the authenticated caller's id here.
create or replace function public.match_styles(query_embedding vector(768), match_count int, p_user_id uuid)
returns table (path text, name text, meta jsonb, similarity float)
language sql stable as $$
  select s.path, s.name, s.meta, 1 - (s.embedding <=> query_embedding) as similarity
  from public.style_images s
  where s.active = true
    and s.embedding is not null
    and (s.user_id is null or s.user_id = p_user_id)
  order by s.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_styles(vector, int, uuid) to anon, authenticated;

-- ── 5) Persona: private bucket + owner-only table ────────────────────
insert into storage.buckets (id, name, public)
values ('personas', 'personas', false)
on conflict (id) do nothing;

-- Owner-only access to files under personas/<uid>/...
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

create table if not exists public.user_personas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,               -- object path in the 'personas' bucket
  name       text,                        -- optional human label
  created_at timestamptz not null default now()
);
create index if not exists user_personas_user_idx on public.user_personas(user_id, created_at);

alter table public.user_personas enable row level security;

drop policy if exists "owner manages personas" on public.user_personas;
create policy "owner manages personas" on public.user_personas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
