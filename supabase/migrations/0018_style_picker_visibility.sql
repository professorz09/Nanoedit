-- ═══════════════════════════════════════════════════════════════════════════
-- `active` currently gates a style everywhere: the manual "Styles" picker
-- (fetchStyleImages / the "read styles" RLS policy) AND the YouTube auto-match
-- pool (match_styles()). That means an admin who wants to declutter the manual
-- picker — without pulling a perfectly good style out of auto-matching too —
-- has no way to do it: their only lever, toggling `active` off, removes it
-- from BOTH.
--
-- Add a second, independent flag: `show_in_picker` (default true). The manual
-- picker now also requires this; match_styles() intentionally does NOT check
-- it, so a style hidden from the picker stays fully eligible for YouTube
-- auto-matching. `active` keeps its existing meaning — fully disabled,
-- everywhere — for styles that are actually broken/bad and shouldn't be used
-- at all.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.style_images add column if not exists show_in_picker boolean not null default true;

drop policy if exists "read styles" on public.style_images;
create policy "read styles" on public.style_images
  for select using (active = true and show_in_picker = true and (user_id is null or user_id = auth.uid()));
