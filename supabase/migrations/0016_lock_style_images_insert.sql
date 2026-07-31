-- ═══════════════════════════════════════════════════════════════════════════
-- "insert/update/delete own styles" (migrations 0006, 0008) let any signed-in
-- client write directly to style_images as long as user_id = auth.uid() — with
-- no check on path, embedding, or count on insert, and no app UI ever uses
-- these paths: index-style and admin-styles Edge Functions (and AdminStyles.tsx,
-- the only delete UI) all write with the service-role key, which bypasses RLS
-- entirely. So these policies are pure unused attack surface — a signed-in
-- user could hit PostgREST directly to spam junk rows (bypassing the Edge
-- Function's vision-tagging, embedding and MAX_PER_USER cap), or rewrite/wipe
-- their own custom-style rows outside the app's own flows.
--
-- Styles are only ever written server-side now — deny all client writes.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "insert own styles" on public.style_images;
drop policy if exists "update own styles" on public.style_images;
drop policy if exists "delete own styles" on public.style_images;
