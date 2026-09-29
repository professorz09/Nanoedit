-- ═══════════════════════════════════════════════════════════════════
-- Admin settings (Admin → ⚙️ Settings): which image model / provider and text
-- provider the thumbnail + text calls use, and how many Shorts render at once
-- (per user, and on the whole Shorts server). One row, id 'global'.
--
-- data (jsonb) — every key optional, the readers fall back to defaults:
--   image_model     'gemini' | 'gpt'                      (gpt → always OpenRouter)
--   image_provider  'google' | 'openrouter' | 'fallback'  (Gemini images)
--   text_provider   'google' | 'openrouter' | 'fallback'  (titles, text, tagging, embeddings)
--   gpt_image_model                OpenRouter id of the ChatGPT image model
--   gemini_openrouter_image_model  OpenRouter id of the Gemini image model
--   shorts_per_user  Shorts one user can have rendering at once
--   shorts_total     Shorts rendering at once on the server, all users together
--
-- Read by the servers with the service role; readable and writable from the
-- browser only by an admin (profiles.is_admin, which no client can set).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.app_settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values ('global') on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "admins read settings" on public.app_settings;
create policy "admins read settings" on public.app_settings
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

drop policy if exists "admins update settings" on public.app_settings;
create policy "admins update settings" on public.app_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (id = 'global' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
