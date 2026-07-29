-- Client answers 2026-07-28 (B-33): an auto-offer should only fire when the closing date is far enough
-- out. Asked as "closing date 30 days+"; answered as "Allowing each lender to enter their own minimum
-- would be great but default to 30 days."
--
-- It belongs on auto_offers, not on saved_filters: it is a property of the standing OFFER (how much lead
-- time this lender needs to underwrite), not of how they browse the marketplace. A lender can keep
-- browsing deals closing next week while declining to auto-bid on them.

alter table auto_offers
  add column if not exists min_closing_days integer not null default 30;

comment on column auto_offers.min_closing_days is
  'Client 2026-07-28 (B-33): only auto-offer when the closing date is at least this many days out. Default 30. A deal with NO closing date (a prequal) is not constrained by it — see send_auto_offers.';

alter table auto_offers
  add constraint auto_offers_min_closing_days_nonneg check (min_closing_days >= 0);

-- Re-create the engine with the new gate. Everything else is migration 47 verbatim.
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
