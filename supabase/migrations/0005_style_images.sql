-- ═══════════════════════════════════════════════════════════════════
-- Style / reference thumbnails moved into the database.
--
-- Until now the "Styles" pool lived only in the client bundle
-- (attached_assets/*), so adding a new style meant a code change + redeploy.
-- This makes it data-driven: rows in public.style_images + files in the public
-- "styles" Storage bucket. Add a row (and upload its file) and it shows up in
-- the app automatically — no rebuild.
--
-- Read is PUBLIC (anon) so logged-out visitors see the style pool too.
-- Writes are service-role only (seed script / admin), same as generations.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Catalog of style/reference thumbnails.
create table if not exists public.style_images (
  id         uuid primary key default gen_random_uuid(),
  path       text not null,                 -- object path in the 'styles' bucket, OR a full https URL
  name       text,                          -- optional human label
  sort       integer not null default 0,    -- lower = shown first
  active     boolean not null default true, -- soft-hide without deleting
  created_at timestamptz not null default now()
);
create index if not exists style_images_order_idx on public.style_images(active, sort, created_at);

alter table public.style_images enable row level security;

-- Public can read only the active rows; nobody can write via the anon/authed key.
drop policy if exists "read active styles" on public.style_images;
create policy "read active styles" on public.style_images
  for select using (active = true);

-- 2) Public Storage bucket for the style image files (served via CDN URL).
insert into storage.buckets (id, name, public)
values ('styles', 'styles', true)
on conflict (id) do nothing;

-- Anyone may read objects in the public 'styles' bucket (uploads stay
-- service-role only, so this is read-only for the anon/authed key).
drop policy if exists "public read styles bucket" on storage.objects;
create policy "public read styles bucket" on storage.objects
  for select using (bucket_id = 'styles');
