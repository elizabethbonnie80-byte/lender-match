-- One offer per lender institution per deal (approved 2026-08-28) — step 2 of 2.
--
-- Approved decisions (see the client conversation this migration was built from):
--   1. One offer EVER per (deal, lender institution) — not merely one ACTIVE offer. A withdrawn or
--      declined offer still permanently occupies that institution's one slot on that deal.
--   2. NARROW approach: `i_offered_on()` (per lender USER) is left completely untouched, so its other
--      three call sites — the `deals_lender_offered` RLS policy, the messaging guard in
--      `send_deal_message`, and the OQ#25 penalty-exemption clause in `lender_can_see_deal` — keep
--      their exact current (per-user) behaviour. A new function, `my_institution_offered_on()`, is
--      added instead and used ONLY where this feature needs institution-level scoping.
--   3. Edit/withdraw stay creator-only for now (no change to edit_offer's `o.lender_id <> auth.uid()`
--      guard). Other same-institution users get read-only visibility in Submitted Offers.
--   4. Withdrawal must retain history (a hard DELETE would let the institution's slot reopen), so it
--      becomes an RPC that sets status = 'withdrawn' (migration 74 added the enum value) instead of a
--      raw client-side DELETE. The old offers_lender_withdraw DELETE policy is dropped so there is no
--      remaining path to hard-delete an offer and defeat "one offer ever".
--   5. The unique index is the actual race-safe guarantee (stale tab / concurrent session / direct RPC
--      call) — the pre-checks in make_offer/send_auto_offers exist only to turn that into a clean,
--      catchable error/skip instead of a raw constraint-violation exception.
--   6. A plain unique index treats every NULL as distinct, so an offer with a null
--      lender_institution_id would silently escape the guarantee. The column is NOT NULL (see below,
--      confirmed safe against both live environments), and make_offer/send_auto_offers additionally
--      refuse/skip a lender with no institution on file before ever attempting an insert — belt and
--      suspenders: a clean application-level error instead of a raw not-null-constraint failure.
--
-- Audited on 2026-08-28: staging and prod currently have ZERO duplicate (deal_id, lender institution)
-- offer pairs, so no dedup/cleanup step is needed before adding the unique constraint.
--
-- Also confirmed on 2026-08-28 (both envs): zero existing offers have an unresolvable lender
-- institution (`select count(*) from offers o join profiles p on p.id = o.lender_id where
-- p.lender_institution_id is null` returned 0 on staging and prod). Combined with decision #6, the
-- column is set NOT NULL below — the invariant is now enforced structurally, not just by the two
-- application-level guards, for both existing rows and every future one.

-- ============================================================================
-- 1. offers.lender_institution_id — denormalized at insert time (profiles.lender_institution_id is on
--    the privilege-guard's deny-list, so it can never change under a lender after signup — safe to
--    denormalize once and never re-sync).
-- ============================================================================

alter table offers add column lender_institution_id uuid references lender_institutions(id);

update offers o
set lender_institution_id = p.lender_institution_id
from profiles p
where p.id = o.lender_id and o.lender_institution_id is null;

-- Verified zero nulls remain on both staging and prod after the backfill (see header) — safe to
-- enforce structurally rather than relying solely on the make_offer/send_auto_offers guards below.
alter table offers alter column lender_institution_id set not null;

comment on column offers.lender_institution_id is
  'Denormalized from profiles.lender_institution_id at offer-creation time (2026-08-28). Backs the one-offer-per-institution-per-deal unique constraint below; profiles.lender_institution_id cannot change after signup (privilege-guard deny-list), so this never goes stale. NOT NULL: verified zero existing offers had an unresolvable institution before this was added.';

-- One offer EVER per (deal, institution) — no status exception, per the approved decision above.
alter table offers add constraint offers_one_per_institution_per_deal unique (deal_id, lender_institution_id);

-- ============================================================================
-- 2. withdraw_offer RPC — replaces the raw client-side DELETE. Same ownership/pending guard as the old
--    offers_lender_withdraw policy, but retains the row as status = 'withdrawn' instead of deleting it.
-- ============================================================================

drop policy if exists offers_lender_withdraw on offers;

create or replace function withdraw_offer(p_offer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  if o.lender_id <> auth.uid() then raise exception 'not your offer'; end if;
  if o.status <> 'pending' then raise exception 'only pending offers can be withdrawn'; end if;
  update offers set status = 'withdrawn', updated_at = now() where id = p_offer_id;
end $$;

grant execute on function withdraw_offer(uuid) to authenticated;

-- ============================================================================
-- 3. make_offer — populate lender_institution_id, and turn a duplicate-institution attempt into a
--    clean 'DUPLICATE_INSTITUTION_OFFER' exception instead of a raw unique-constraint error. The
--    pre-check is for the common case (no wasted insert attempt); the nested BEGIN/EXCEPTION is the
--    actual guarantee against a race between two concurrent submissions from the same institution.
--    Signature is unchanged (still 9 args) — CREATE OR REPLACE, no DROP needed.
-- ============================================================================

create or replace function make_offer(
  p_deal_id uuid,
  p_mortgage_product mortgage_product,
  p_rate numeric,
  p_rate_lock_days integer,
  p_commission_bps integer,
  p_commitment_turn_time_days integer default null,
  p_doc_review_turn_time_days integer default null,
  p_comments text default null,
  p_lender_fee_pct numeric default null
) returns offers
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; o offers%rowtype; v_institution_id uuid := my_institution();
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if not i_am_approved_lender() then raise exception 'only approved lenders can make offers'; end if;
  -- re-check visibility here because SECURITY DEFINER bypasses RLS
  if not lender_can_see_deal(d) then raise exception 'you cannot make an offer on this deal'; end if;
  if p_commission_bps is null or p_commission_bps < 0 then raise exception 'commission (bps) is required'; end if;
  -- offers.lender_institution_id is NOT NULL (see below), so inserting with a null value here would
  -- otherwise fail as a generic "null value ... violates not-null constraint" error. Checking it
  -- explicitly turns that into a clean, specific message — this should never actually fire, since
  -- every approved lender is expected to have an institution on file (required at signup).
  if v_institution_id is null then
    raise exception 'your account has no lender institution on file — contact support before submitting an offer';
  end if;

  if exists (
    select 1 from offers where deal_id = p_deal_id and lender_institution_id = v_institution_id
  ) then
    raise exception 'DUPLICATE_INSTITUTION_OFFER';
  end if;

  begin
    insert into offers (deal_id, lender_id, lender_institution_id, mortgage_product, rate, rate_lock_days,
                        commission_bps, commitment_turn_time_days, doc_review_turn_time_days, comments,
                        lender_fee_pct)
    values (p_deal_id, auth.uid(), v_institution_id, p_mortgage_product, p_rate, p_rate_lock_days,
            p_commission_bps, p_commitment_turn_time_days, p_doc_review_turn_time_days, p_comments,
            p_lender_fee_pct)
    returning * into o;
  exception when unique_violation then
    raise exception 'DUPLICATE_INSTITUTION_OFFER';
  end;

  if d.status = 'submitted' then
    update deals set status = 'offer_received' where id = d.id;
  end if;

  perform notify(d.broker_id, 'new_offer',
                 format('You received a new offer on deal %s.', d.deal_number),
                 d.id, o.id);
  return o;
end $$;

-- ============================================================================
-- 4. send_auto_offers — populate lender_institution_id, and skip (not abort) a loop iteration that
--    would violate the new unique constraint. This matters even though a brand-new deal starts with
--    zero offers: two DIFFERENT lender users at the SAME institution can both have an active,
--    eligible auto-offer matching it, and the existing per-user dedup check (line "not exists ...
--    o2.lender_id = ao.lender_id") does not catch that. Without the exception guard, the second
--    insert's unique-violation would propagate up and abort the whole send_auto_offers call — which
--    runs inside submit_deal's transaction, so it would fail the broker's deal submission itself.
--    Everything else is migration 64 (auto_offers_master_switch) verbatim.
-- ============================================================================

create or replace function send_auto_offers(p_deal_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  d deals%rowtype;
  a auto_offers%rowtype;
  o offers%rowtype;
  n integer := 0;
  v_institution_id uuid;
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
      -- one offer per institution per deal: never auto-send for a lender with no institution on
      -- file, for the same reason make_offer refuses one manually (see its guard above).
      and p.lender_institution_id is not null
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
    select lender_institution_id into v_institution_id from profiles where id = a.lender_id;

    begin
      insert into offers (
        deal_id, lender_id, lender_institution_id, mortgage_product, rate, rate_lock_days, commission_bps,
        commitment_turn_time_days, doc_review_turn_time_days, lender_fee_pct, is_auto, auto_offer_id
      ) values (
        d.id, a.lender_id, v_institution_id, a.mortgage_product, a.rate, a.rate_lock_days, a.commission_bps,
        a.commitment_turn_time_days, a.doc_review_turn_time_days, a.lender_fee_pct, true, a.id
      ) returning * into o;
    exception when unique_violation then
      -- One offer ever per institution per deal: another lender user at the same institution already
      -- has (or just got, earlier in this same loop) the deal's one slot. Skip, don't abort.
      continue;
    end;

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

-- ============================================================================
-- 5. my_institution_offered_on — the purpose-built institution-level check. Used ONLY in the four
--    lender feed RPCs and the new deals_institution_offered RLS policy below. Deliberately separate
--    from i_offered_on(), which keeps its exact current per-user behaviour everywhere else.
-- ============================================================================

create or replace function my_institution_offered_on(p_deal_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from offers o
    where o.deal_id = p_deal_id
      and o.lender_institution_id is not null
      and o.lender_institution_id = my_institution()
  )
$$;

-- Companion RLS: lets a same-institution user (who hasn't personally offered) read the deal row their
-- colleague's offer points to — needed for the Submitted Offers page's `deals!offers_deal_id_fkey(...)`
-- embed to resolve for them. Additive alongside the existing per-user deals_lender_offered policy
-- (using i_offered_on) — that policy is untouched.
create policy deals_institution_offered on deals for select to authenticated
  using (my_institution_offered_on(deals.id));

-- Companion RLS: lets a same-institution user read their institution's offer row directly (not just
-- their own). Additive alongside the existing offers_lender_own policy — that policy is untouched.
create policy offers_institution_read on offers for select to authenticated
  using (lender_institution_id is not null and lender_institution_id = my_institution());

-- ============================================================================
-- 6. The four lender feed RPCs: swap the per-user `not i_offered_on(d.id)` for the institution-level
--    check. i_offered_on() itself is untouched, so deals_lender_offered / send_deal_message /
--    lender_can_see_deal's penalty exemption all keep their current per-user behaviour. Bodies are
--    otherwise byte-for-byte identical to migration 73 (the current latest) — no OUT-column or
--    parameter change, so no DROP FUNCTION is needed for any of the four.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.open_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.id, d.deal_number, d.submitted_at,
         d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
         d.acres, d.general_notes,
         d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
         d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
         d.previously_declined, d.previously_declined_reason,
         d.primary_credit_score,
         (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
         d.co_borrower_credit_score,
         (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
         d.gds, d.tds, d.tds_includes_child_support_alimony, d.foreign_income_country,
         (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
         (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
         d.owns_other_properties, d.door_count,
         d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.lender_to_pay_property_taxes, d.borrower_to_pay_property_taxes, d.mobile_home_year_built, d.mobile_home_has_csa_seal, d.mobile_home_csa_seal_year, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required
  from deals d
  where lender_can_see_deal(d)
    and not my_institution_offered_on(d.id)
    and (
      p_filter_id is null
      or exists (
        select 1 from saved_filters sf
        where sf.id = p_filter_id
          and sf.lender_id = auth.uid()
          and saved_filter_matches(sf, d)
      )
    )
  order by d.submitted_at desc nulls last
$function$;

CREATE OR REPLACE FUNCTION public.open_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[], p_mobile_home_csa_seal_year_min integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sf saved_filters%rowtype;
  v_others text[] := coalesce(p_others_excluded, '{}'::text[]);
begin
  v_sf.transaction_type := p_transaction_type;
  v_sf.province := p_province;
  v_sf.mortgage_product := p_mortgage_product;
  v_sf.purpose := p_purpose;
  v_sf.dwelling_type := p_dwelling_type;
  v_sf.dwelling_types_excluded := p_dwelling_types_excluded;
  v_sf.mortgage_position := p_mortgage_position;
  v_sf.occupancy := p_occupancy;
  v_sf.location_type := p_location_type;
  v_sf.insured := p_insured;
  v_sf.ltv_min := p_ltv_min;
  v_sf.ltv_max := p_ltv_max;
  v_sf.amortization_min := p_amortization_min;
  v_sf.amortization_max := p_amortization_max;
  v_sf.loan_amount_min := p_loan_amount_min;
  v_sf.loan_amount_max := p_loan_amount_max;
  v_sf.gds_max := p_gds_max;
  v_sf.tds_max := p_tds_max;
  v_sf.credit_score_min := p_credit_score_min;
  v_sf.max_doors := p_max_doors;
  v_sf.property_value_min := p_property_value_min;
  v_sf.property_value_max := p_property_value_max;
  v_sf.square_footage_min := p_square_footage_min;
  v_sf.acres_max := p_acres_max;
  v_sf.income_types := p_income_types_excluded;
  v_sf.residency_statuses := p_residency_statuses_excluded;
  v_sf.exclude_fthb := 'fthb' = any(v_others);
  v_sf.exclude_new_to_canada := 'new_to_canada' = any(v_others);
  v_sf.exclude_networth_program := 'networth_program' = any(v_others);
  v_sf.exclude_medical_professional := 'medical_professional' = any(v_others);
  v_sf.exclude_collateral_transfer := 'collateral_transfer' = any(v_others);
  v_sf.exclude_cashback := 'cashback' = any(v_others);
  v_sf.exclude_bridge_loan := 'bridge_loan_needed' = any(v_others);
  v_sf.exclude_purchase_plus_improvements := 'purchase_plus_improvements' = any(v_others);
  v_sf.exclude_first_and_heloc := 'first_and_heloc' = any(v_others);
  v_sf.exclude_heloc := 'heloc' = any(v_others);
  v_sf.exclude_fixed_second := 'fixed_second' = any(v_others);
  v_sf.exclude_cosignor_occupying := 'cosignor_occupying' = any(v_others);
  v_sf.exclude_cosignor_not_occupying := 'cosignor_not_occupying' = any(v_others);
  v_sf.exclude_guarantor := 'guarantor' = any(v_others);
  v_sf.exclude_prequal := 'prequal' = any(v_others);
  v_sf.exclude_new_build := 'new_build' = any(v_others);
  v_sf.exclude_recreational := 'recreational_property' = any(v_others);
  v_sf.exclude_hobby_farm := 'hobby_farm' = any(v_others);
  v_sf.exclude_well_water := 'well_water' = any(v_others);
  v_sf.exclude_septic := 'septic' = any(v_others);
  v_sf.exclude_holdco_on_title := 'holdco_on_title' = any(v_others);
  v_sf.exclude_lender_to_pay_property_taxes := 'lender_to_pay_property_taxes' = any(v_others);
  v_sf.exclude_borrower_to_pay_property_taxes := 'borrower_to_pay_property_taxes' = any(v_others);
  -- Round 3 criteria
  v_sf.credit_issues := p_credit_issues_excluded;
  v_sf.down_payment_sources := p_down_payment_sources_excluded;
  v_sf.exclude_reverse_mortgage := 'reverse_mortgage' = any(v_others);
  v_sf.exclude_married_or_common_law := 'married_or_common_law' = any(v_others);
  v_sf.exclude_spouse_not_on_application := 'spouse_not_on_application' = any(v_others);
  v_sf.exclude_transunion := 'transunion_being_used' = any(v_others);
  -- Round 4 J-3 (2026-08-25)
  v_sf.exclude_spousal_buyout := 'spousal_buyout' = any(v_others);
  v_sf.exclude_refinance_plus_improvements := 'refinance_plus_improvements' = any(v_others);
  v_sf.assets_liquid_min := p_assets_liquid_min;
  v_sf.assets_total_min := p_assets_total_min;
  v_sf.max_door_titles := p_max_door_titles;
  v_sf.require_no_exceptions := coalesce(p_require_no_exceptions, false);
  v_sf.mobile_home_csa_seal_year_min := p_mobile_home_csa_seal_year_min;

  return query
    select d.id, d.deal_number, d.submitted_at,
           d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
           d.acres, d.general_notes,
           d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
           d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
           d.previously_declined, d.previously_declined_reason,
           d.primary_credit_score,
           (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
           d.co_borrower_credit_score,
           (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
           d.gds, d.tds, d.tds_includes_child_support_alimony, d.foreign_income_country,
           (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
           (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
           d.owns_other_properties, d.door_count,
           d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.lender_to_pay_property_taxes, d.borrower_to_pay_property_taxes, d.mobile_home_year_built, d.mobile_home_has_csa_seal, d.mobile_home_csa_seal_year, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required
    from deals d
    where lender_can_see_deal(d)
      and not my_institution_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
    order by d.submitted_at desc nulls last;
end;
$function$;

CREATE OR REPLACE FUNCTION public.maturing_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.id, d.deal_number, d.submitted_at,
         d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
         d.acres, d.general_notes,
         d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
         d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
         d.previously_declined, d.previously_declined_reason,
         d.primary_credit_score,
         (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
         d.co_borrower_credit_score,
         (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
         d.gds, d.tds, d.tds_includes_child_support_alimony, d.foreign_income_country,
         (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
         (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
         d.owns_other_properties, d.door_count,
         d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.lender_to_pay_property_taxes, d.borrower_to_pay_property_taxes, d.mobile_home_year_built, d.mobile_home_has_csa_seal, d.mobile_home_csa_seal_year, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required,
         m.pct, m.filter_name, m.fails
  from deals d
  cross join lateral best_match_for(auth.uid(), d.id) m
  where lender_can_see_deal(d)
    and not my_institution_offered_on(d.id)
    and d.created_at <= now() - interval '2 days'
    and d.created_at >  now() - interval '15 days'
    and (
      p_filter_id is null
      or exists (
        select 1 from saved_filters sf
        where sf.id = p_filter_id
          and sf.lender_id = auth.uid()
          and saved_filter_matches(sf, d)
      )
    )
  order by m.pct desc nulls last, d.closing_date asc nulls last
$function$;

CREATE OR REPLACE FUNCTION public.maturing_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[], p_mobile_home_csa_seal_year_min integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sf saved_filters%rowtype;
  v_others text[] := coalesce(p_others_excluded, '{}'::text[]);
begin
  v_sf.transaction_type := p_transaction_type;
  v_sf.province := p_province;
  v_sf.mortgage_product := p_mortgage_product;
  v_sf.purpose := p_purpose;
  v_sf.dwelling_type := p_dwelling_type;
  v_sf.dwelling_types_excluded := p_dwelling_types_excluded;
  v_sf.mortgage_position := p_mortgage_position;
  v_sf.occupancy := p_occupancy;
  v_sf.location_type := p_location_type;
  v_sf.insured := p_insured;
  v_sf.ltv_min := p_ltv_min;
  v_sf.ltv_max := p_ltv_max;
  v_sf.amortization_min := p_amortization_min;
  v_sf.amortization_max := p_amortization_max;
  v_sf.loan_amount_min := p_loan_amount_min;
  v_sf.loan_amount_max := p_loan_amount_max;
  v_sf.gds_max := p_gds_max;
  v_sf.tds_max := p_tds_max;
  v_sf.credit_score_min := p_credit_score_min;
  v_sf.max_doors := p_max_doors;
  v_sf.property_value_min := p_property_value_min;
  v_sf.property_value_max := p_property_value_max;
  v_sf.square_footage_min := p_square_footage_min;
  v_sf.acres_max := p_acres_max;
  v_sf.income_types := p_income_types_excluded;
  v_sf.residency_statuses := p_residency_statuses_excluded;
  v_sf.exclude_fthb := 'fthb' = any(v_others);
  v_sf.exclude_new_to_canada := 'new_to_canada' = any(v_others);
  v_sf.exclude_networth_program := 'networth_program' = any(v_others);
  v_sf.exclude_medical_professional := 'medical_professional' = any(v_others);
  v_sf.exclude_collateral_transfer := 'collateral_transfer' = any(v_others);
  v_sf.exclude_cashback := 'cashback' = any(v_others);
  v_sf.exclude_bridge_loan := 'bridge_loan_needed' = any(v_others);
  v_sf.exclude_purchase_plus_improvements := 'purchase_plus_improvements' = any(v_others);
  v_sf.exclude_first_and_heloc := 'first_and_heloc' = any(v_others);
  v_sf.exclude_heloc := 'heloc' = any(v_others);
  v_sf.exclude_fixed_second := 'fixed_second' = any(v_others);
  v_sf.exclude_cosignor_occupying := 'cosignor_occupying' = any(v_others);
  v_sf.exclude_cosignor_not_occupying := 'cosignor_not_occupying' = any(v_others);
  v_sf.exclude_guarantor := 'guarantor' = any(v_others);
  v_sf.exclude_prequal := 'prequal' = any(v_others);
  v_sf.exclude_new_build := 'new_build' = any(v_others);
  v_sf.exclude_recreational := 'recreational_property' = any(v_others);
  v_sf.exclude_hobby_farm := 'hobby_farm' = any(v_others);
  v_sf.exclude_well_water := 'well_water' = any(v_others);
  v_sf.exclude_septic := 'septic' = any(v_others);
  v_sf.exclude_holdco_on_title := 'holdco_on_title' = any(v_others);
  v_sf.exclude_lender_to_pay_property_taxes := 'lender_to_pay_property_taxes' = any(v_others);
  v_sf.exclude_borrower_to_pay_property_taxes := 'borrower_to_pay_property_taxes' = any(v_others);
  -- Round 3 criteria
  v_sf.credit_issues := p_credit_issues_excluded;
  v_sf.down_payment_sources := p_down_payment_sources_excluded;
  v_sf.exclude_reverse_mortgage := 'reverse_mortgage' = any(v_others);
  v_sf.exclude_married_or_common_law := 'married_or_common_law' = any(v_others);
  v_sf.exclude_spouse_not_on_application := 'spouse_not_on_application' = any(v_others);
  v_sf.exclude_transunion := 'transunion_being_used' = any(v_others);
  -- Round 4 J-3 (2026-08-25)
  v_sf.exclude_spousal_buyout := 'spousal_buyout' = any(v_others);
  v_sf.exclude_refinance_plus_improvements := 'refinance_plus_improvements' = any(v_others);
  v_sf.assets_liquid_min := p_assets_liquid_min;
  v_sf.assets_total_min := p_assets_total_min;
  v_sf.max_door_titles := p_max_door_titles;
  v_sf.require_no_exceptions := coalesce(p_require_no_exceptions, false);
  v_sf.mobile_home_csa_seal_year_min := p_mobile_home_csa_seal_year_min;

  return query
    select d.id, d.deal_number, d.submitted_at,
           d.city, d.province, d.location_type, d.dwelling_type, d.property_value, d.square_footage,
           d.acres, d.general_notes,
           d.closing_date, d.closing_date_flexible, d.cof_date, d.mortgage_product, d.mortgage_position,
           d.loan_amount, d.ltv, d.amortization_years, d.insured, d.purpose, d.transaction_type,
           d.previously_declined, d.previously_declined_reason,
           d.primary_credit_score,
           (select array_agg(dci.credit_issue) from deal_credit_issues dci where dci.deal_id = d.id),
           d.co_borrower_credit_score,
           (select array_agg(dit.income_type) from deal_income_types dit where dit.deal_id = d.id),
           d.gds, d.tds, d.tds_includes_child_support_alimony, d.foreign_income_country,
           (select array_agg(drs.residency) from deal_residency_statuses drs where drs.deal_id = d.id),
           (select array_agg(ddps.down_payment_source) from deal_down_payment_sources ddps where ddps.deal_id = d.id),
           d.owns_other_properties, d.door_count,
           d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.lender_to_pay_property_taxes, d.borrower_to_pay_property_taxes, d.mobile_home_year_built, d.mobile_home_has_csa_seal, d.mobile_home_csa_seal_year, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required,
           m.pct, m.filter_name, m.fails
    from deals d
    cross join lateral best_match_for(auth.uid(), d.id) m
    where lender_can_see_deal(d)
      and not my_institution_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
      and d.created_at <= now() - interval '2 days'
      and d.created_at >  now() - interval '15 days'
    order by m.pct desc nulls last, d.closing_date asc nulls last;
end;
$function$;
