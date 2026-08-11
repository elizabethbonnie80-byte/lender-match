-- Client 2026-08-11 (I-1): stop telling the broker that a prequal's lender window closed.
--
-- > "pre-quals aren't supposed to expire at the 15 day mark for brokers - only for lenders, but I
-- >  received this email - can you please fix it?"
--
-- The BEHAVIOUR she describes was already correct and is unchanged: a prequal never reaches status
-- 'expired', it only leaves the lender queues at 15 days (a visibility clause in lender_can_see_deal,
-- migration 52). Her own DEAL-2026-611 is still `submitted` with expired_at null. What was wrong was
-- the message: migration 52 also sent the broker a one-shot courtesy notice, and it reused the
-- `deal_expired` notification type because the body was prequal-specific and no new enum value seemed
-- warranted. That decision leaked in two places we do not control from the body text:
--   * the email subject is keyed off the TYPE (notify-email SUBJECTS) → "A deal has expired"
--   * the bell renders the type too → the "Deal expired" label + the red XCircle icon
-- So a prequal that deliberately does not expire for the broker announced itself to the broker as an
-- expired deal, in her inbox and in her bell. That is the whole of the bug.
--
-- The notice is removed rather than re-typed. It was never requested (we added it in migration 52 so
-- the Deal Room would not read "Submitted" forever while no lender could see the deal), and that
-- concern is already covered in the place the broker acts on it: the Deal Room row renders
-- `dealRoom.prequalQueueClosed` — "Past its 15 days on the lender queues — still yours to move to a
-- live deal or delete." — driven by isLenderQueueClosed() in lib/age-windows.ts. Re-typing it instead
-- would have cost a new enum value across 8 surfaces (notify(), the exhaustive icon/label Records,
-- notificationHref, DEAL_SURFACE_TYPES, both catalogs, the edge function's SUBJECTS + a redeploy) and
-- would still have put a day-15 email in her inbox, which is what she asked us to stop.
--
-- prequal_lender_notice_at KEEPS being stamped. It is a genuine record of when the window closed and
-- support can read it; it just no longer implies anybody was emailed. It was never the source of truth
-- for visibility (that is computed from created_at, so the window closes on time even if the cron does
-- not run) — see migration 52's header.
--
-- Recreates migration 52's job_expire_old_deals() with the second notification insert removed. The
-- live-deal path is untouched: a real deal with no offer still expires at 15 days and still notifies.

create or replace function job_expire_old_deals() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with expired as (
    update deals d
       set status = 'expired', expired_at = now()
     where d.status = 'submitted'
       -- Client 2026-07-27: a prequal stays active for the broker until they delete it. It only
       -- leaves the LENDER queues, which lender_can_see_deal does off created_at.
       and not coalesce(d.prequal, false)
       and d.created_at < now() - interval '15 days'
    returning d.id, d.broker_id, d.deal_number
  )
  insert into notifications (recipient_id, type, body, deal_id)
  select e.broker_id, 'deal_expired',
         format('Your deal %s has expired after 15 days without an offer.', e.deal_number), e.id
  from expired e
  join profiles p on p.id = e.broker_id
  where p.notify_deal_expiring and p.notify_inapp_enabled;
  get diagnostics n = row_count;

  -- Prequals: record that the lender window closed, and tell nobody (client 2026-08-11, I-1 — see
  -- the header). The file itself stays exactly where it was, active for the broker.
  update deals d
     set prequal_lender_notice_at = now()
   where coalesce(d.prequal, false)
     and d.prequal_converted_at is null
     and d.prequal_lender_notice_at is null
     and d.status in ('submitted', 'offer_received')
     and d.created_at < now() - interval '15 days';

  return n;
end $$;

-- Was revoked from public in migration 62; create or replace preserves that, but assert it so a future
-- reader does not have to check pg_proc.proacl to be sure (see Security invariants #6).
revoke execute on function job_expire_old_deals() from public, anon, authenticated;

comment on column deals.prequal_lender_notice_at is
  'When this prequal finished its 15 days on the lender queues, stamped by job_expire_old_deals. A record only: the broker is NOT notified (client 2026-08-11 — a prequal does not expire for the broker, so it must not announce itself as expired), and lender visibility is computed from created_at in lender_can_see_deal, never from this column.';
