-- ═══════════════════════════════════════════════════════════════════════════
-- Untouched styles used to default to sort=0, the SAME value as "top
-- priority" — so once an admin had 50+ styles and hadn't manually ranked
-- most of them, the picker order was effectively dominated by whichever
-- batch was uploaded most/least recently (tie-break), not real curation.
-- Switch to sort being nullable: NULL = "never ranked", and both queries
-- that read this column now push NULLs after any explicit number, so an
-- admin only needs to rank the handful of styles they actually want to
-- promote — everything else just falls in behind them, in upload order.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.style_images alter column sort drop not null;
alter table public.style_images alter column sort drop default;
update public.style_images set sort = null where sort = 0;
