-- ═══════════════════════════════════════════════════════════════════════════
-- Enforce plan expiry.
--
-- verify-payment sets renews_at on purchase, but nothing ever checked it —
-- once a user bought Pro/Studio they kept that plan (and never got a fresh
-- monthly credit allotment) forever, even long after their paid period
-- ended, since there is no recurring Razorpay subscription auto-charging
-- them again. This adds a scheduled job that downgrades any profile whose
-- renews_at has passed back to 'free' and zeroes its (expired) monthly
-- credits. addon_credits are untouched — those are documented as never
-- expiring, independent of plan.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema extensions;

create or replace function public.expire_subscriptions()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  with to_expire as (
    select id, credits as old_credits
    from public.profiles
    where plan in ('pro','studio')
      and renews_at is not null
      and renews_at < now()
    for update
  ),
  updated as (
    update public.profiles p
       set plan = 'free',
           credits = 0,
           renews_at = null,
           updated_at = now()
      from to_expire t
     where p.id = t.id
    returning p.id
  )
  insert into public.credit_ledger (user_id, delta, reason)
  select t.id, -t.old_credits, 'plan_expired'
  from to_expire t
  where t.old_credits > 0;
end;
$$;

-- Service-role only — same lockdown pattern as spend_credit/refund_credit.
-- This mass-downgrades users; it must never be callable from the client.
revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role, postgres;

-- Re-registering a job with the same name reschedules it (pg_cron upsert),
-- so this is safe to re-run. Hourly is cheap at this table size and keeps
-- the downgrade lag to under an hour.
select cron.schedule(
  'expire-subscriptions-hourly',
  '0 * * * *',
  $$select public.expire_subscriptions();$$
);
