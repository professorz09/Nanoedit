-- ═══════════════════════════════════════════════════════════════════════════
-- The "styles" bucket's read policy was unconditionally public
-- (bucket_id = 'styles'), which was fine for the original global-only pool
-- (admin/..., seed/...) but stopped being fine once per-user custom styles
-- were added at styles/user/<uid>/<file> — a signed-in user's own uploads,
-- gated as owner-only at the style_images TABLE level (see migration 0006),
-- were still fetchable by anyone who obtained the object URL, since Storage
-- object-level RLS didn't check ownership at all.
--
-- Scope reads so `user/<uid>/...` objects require auth.uid() to match the
-- uid in the path; every other path (admin/, seed/, anything not under
-- user/) stays public, unchanged from before.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "public read styles bucket" on storage.objects;
create policy "read styles bucket" on storage.objects
  for select using (
    bucket_id = 'styles'
    and (
      (storage.foldername(name))[1] is distinct from 'user'
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );
