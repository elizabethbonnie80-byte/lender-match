-- Client revision 2026-07-30 (E-11): the auto-offers feature is hard to find, and there is no way to
-- turn it off as a whole.
--
--   "can we make the auto-offers box more accessible? Right now it's a bit hidden in settings. Maybe we
--    can have an auto-offer switch always at the top that can be toggled on or off, with an auto-offers
--    settings button beside it. Otherwise it's a bit hard to find or even know it exists?"
--
-- The switch she describes did not exist in any form: `auto_offers.is_active` is PER SAVED OFFER, so the
-- only way to stop everything was to toggle each row. This adds the missing lender-level master.
--
-- ── Why a column and not "flip every row" ───────────────────────────────────────────────────────────
-- Having the strip write is_active = false across the lender's rows would need no migration, but it
-- destroys information: after one off→on cycle the lender cannot tell which auto-offers they had
-- deliberately paused, because the master's off state and a per-offer pause became the same bit. Two
-- independent switches keep two independent meanings — master off = nothing sends at all; master on =
-- the per-row rules decide.
--
-- This is not a new pattern here: `profiles.notify_email_enabled` already sits above the per-type
-- notification toggles in exactly this shape.
--
-- ⚠️ DEFAULT TRUE, and that is load-bearing. Every lender with a live auto-offer predates this column;
-- a false default would silently stop all of them the moment this migration ran, with no UI event and
-- no notification to explain it. New lenders get true as well — the master is a kill switch, not an
-- opt-in, and an auto-offer only ever fires because the lender explicitly created one.

alter table profiles
  add column if not exists auto_offers_enabled boolean not null default true;

comment on column profiles.auto_offers_enabled is
  'Client 2026-07-30 (E-11): lender-level master switch for the auto-offer engine, surfaced on New Deals. Off = send_auto_offers skips this lender entirely regardless of per-row auto_offers.is_active. Default TRUE so pre-existing auto-offers keep working.';

-- The lender owns this flag, and no policy change is needed: `profiles_self_update` already covers the
-- row, and the `profiles_privilege_guard` trigger (protect_privileged_profile_fields, migration 03) is
-- an explicit DENY-list — role, is_approved, pending_approval, rejected, is_broker_admin, penalty_active,
-- offer_switches_this_month, switch_month, brokerage_id, lender_institution_id. Anything not named there
-- is self-service, which is what the notify_* preference columns beside it rely on too. Verified against
-- the trigger body rather than assumed, because adding a column to `profiles` is exactly the change that
-- would silently fail if the guard were an ALLOW-list instead.

-- Re-create the engine with the master gate. Everything else is migration 58 verbatim.
create or replace function send_auto_offers(p_deal_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  d deals%rowtype;
  a auto_offers%rowtype;
  o offers%rowtype;
  n integer := 0;
begin
  select * into d from deals where id = p_deal_id;
  if d.id is null or d.status not in ('submitted', 'offer_received') or d.archived then
    return 0;
  end if;
  if not deal_allows_auto_offer(d) then
    return 0;
  end if;

  for a in
    select distinct on (ao.lender_id) ao.*
    from auto_offers ao
    join saved_filters sf on sf.id = ao.saved_filter_id and sf.lender_id = ao.lender_id
    join profiles p on p.id = ao.lender_id
    where ao.is_active
      -- E-11: the lender-level master switch. Checked alongside the per-row is_active, never instead
      -- of it — the two are independent on purpose (see the header).
      and p.auto_offers_enabled
      and (ao.end_date is null or ao.end_date >= current_date)
      and p.role = 'lender' and p.is_approved and not p.pending_approval
      and saved_filter_matches(sf, d)
      -- B-33: enough lead time before closing. A deal with NO closing date is deliberately allowed
      -- through: a prequal has no date because there is no property yet, so it cannot be "too soon",
      -- and silently dropping null is the exact bug migration 54 had to undo for the max filters.
      and (d.closing_date is null
           or d.closing_date >= current_date + ao.min_closing_days)
      -- blocked in either direction
      and not exists (select 1 from lender_blocked_brokerages lb
                      where lb.lender_id = ao.lender_id and lb.brokerage_id = d.brokerage_id)
      and not exists (select 1 from broker_blocked_institutions bb
                      where bb.broker_id = d.broker_id
                        and bb.institution_id = p.lender_institution_id)
      -- never a second offer from the same lender on the same deal
      and not exists (select 1 from offers o2 where o2.deal_id = d.id and o2.lender_id = ao.lender_id)
      -- OQ#25 rating penalty: no near-closing / near-COF deals for a penalized lender
      and not (
        p.penalty_active and (
          (d.closing_date is not null
             and d.closing_date < current_date + (select near_closing_days from penalty_settings where id = 1))
          or (d.cof_date is not null
             and d.cof_date < current_date + (select near_cof_days from penalty_settings where id = 1))
        )
      )
    order by ao.lender_id, ao.created_at
  loop
    insert into offers (
      deal_id, lender_id, mortgage_product, rate, rate_lock_days, commission_bps,
      commitment_turn_time_days, doc_review_turn_time_days, lender_fee_pct, is_auto, auto_offer_id
    ) values (
      d.id, a.lender_id, a.mortgage_product, a.rate, a.rate_lock_days, a.commission_bps,
      a.commitment_turn_time_days, a.doc_review_turn_time_days, a.lender_fee_pct, true, a.id
    ) returning * into o;

    update auto_offers
       set last_sent_at = now(), sent_count = sent_count + 1, updated_at = now()
     where id = a.id;

    -- same broker-facing notification as a manual offer (no lender identity — invariant #1)
    perform notify(d.broker_id, 'new_offer',
                   format('You received a new offer on deal %s.', d.deal_number),
                   d.id, o.id);
    n := n + 1;
  end loop;

  if n > 0 and d.status = 'submitted' then
    update deals set status = 'offer_received' where id = d.id;
  end if;

  return n;
end $$;
