-- ═══════════════════════════════════════════════════════════════════════════
-- style_images.path had no uniqueness constraint, so re-running the seed/tag
-- scripts against the same file could only ever INSERT a fresh duplicate row
-- (or, worse, an upsert-by-path would error with no unique/exclusion
-- constraint to target). Each Storage object should map to exactly one
-- catalog row, so make that a real constraint and let tag-styles.mjs upsert
-- safely on repeat runs.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.style_images add constraint style_images_path_key unique (path);
