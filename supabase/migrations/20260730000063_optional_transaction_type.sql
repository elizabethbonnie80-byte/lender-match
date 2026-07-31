-- Client revision 2026-07-30 (E-5): Transaction Type becomes OPTIONAL on Create Deal.
--
--   "can we make the Transaction Type optional instead of required? and if the broker doesn't select a
--    transaction type (from the list of prime, alt and private), the transaction type filter doesn't
--    apply, so that the deal runs through all 3 lender types and isn't filtered out by transaction type
--    alone? … Some brokers will be using this platform because they are unsure of which lender type to
--    use, so this being optional may give them more confidence that the deal will be shown to the
--    appropriate lenders."
--
-- `deals.transaction_type` was ALREADY nullable (migration 01) — the column needs nothing. The form was
-- the only thing making it mandatory, and the two read-side predicates below were written on the
-- assumption that it always had a value. Both had to change or the field would have been optional in
-- name only.
--
-- ── 1. saved_filter_matches — the visibility bug ────────────────────────────────────────────────────
-- The predicate was `(sf.transaction_type is null or sf.transaction_type = d.transaction_type)`:
-- null-safe for the FILTER's value, not for the DEAL's. With d.transaction_type null the comparison
-- yields NULL, and inside an AND chain NULL is indistinguishable from FALSE — so the deal silently
-- disappeared from every lender who had set a transaction type. Exactly the class of bug migration 54
-- fixed for the MAX criteria, and fixed the same way.
--
-- This one function is the convergence point for the saved-filter chips (open_deals_for_lender /
-- maturing_deals_for_lender), the ad-hoc Filters panel (open_deals_filtered / maturing_deals_filtered),
-- the submit_deal filter-match notifications and send_auto_offers — so one predicate covers all five.
--
-- ── 2. match_percentage — the ranking trap ──────────────────────────────────────────────────────────
-- Same shape, worse consequence, and the reason this migration is not a one-liner. The criterion was
-- gated on the FILTER's value alone:
--
--     if sf.transaction_type is not null then
--       total := total + 18;
--       if sf.transaction_type = d.transaction_type then matched := matched + 18;
--       else fails := array_append(fails, 'Transaction Type'); end if;
--
-- A null deal value takes the ELSE branch: 18 points charged to the denominator, 0 earned — and
-- transaction type is the heaviest weight in the engine. The deal would cap around 82%, render a red
-- "Does not match: Transaction Type" chip, and because Maturing orders by pct desc it would sink below
-- every typed deal on every lender's list. Visible, but last and flagged — the opposite of the request.
--
-- "The transaction type filter doesn't apply" has to mean the criterion drops out of the denominator
-- entirely, which is what an undefined criterion already does for every other field here.
--
-- ── Scope ───────────────────────────────────────────────────────────────────────────────────────────
-- Deliberately limited to transaction_type. The other criteria share the shape but not the situation:
-- their deal-side fields are still required on the form, so a null there means bad data rather than a
-- broker declining to guess. Migration 54 scoped itself the same way (all 9 MAX criteria, no MIN ones).
--
-- Neither signature changes, so the four feed RPCs, best_match_for, send_auto_offers and submit_deal
-- pick this up without being rebuilt.

CREATE OR REPLACE FUNCTION public.saved_filter_matches(sf saved_filters, d deals)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select
    -- E-5: `or d.transaction_type is null` — a deal the broker left untyped runs through all three
    -- lender types instead of being dropped by a filter that names one.
    (sf.transaction_type is null or d.transaction_type is null or sf.transaction_type = d.transaction_type)
    and (sf.province is null or sf.province = d.province)
    and (sf.mortgage_product is null or sf.mortgage_product = d.mortgage_product)
    and (sf.ltv_min is null or d.ltv >= sf.ltv_min)
    and (sf.ltv_max is null or d.ltv is null or d.ltv <= sf.ltv_max)
    and (sf.credit_score_min is null or d.primary_credit_score >= sf.credit_score_min)
    and (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
    and (sf.amortization_max is null or d.amortization_years is null or d.amortization_years <= sf.amortization_max)
    and (sf.mortgage_position is null or sf.mortgage_position = d.mortgage_position)
    and (sf.purpose is null or sf.purpose = d.purpose)
    and (sf.dwelling_type is null or sf.dwelling_type = d.dwelling_type)
    -- A-1: "change dwelling type to checkboxes … We need to be able to exclude certain types."
    -- Null-safe like every other exclusion: a deal whose type is unknown is not one of the excluded
    -- types, so it stays visible.
    and (
      sf.dwelling_types_excluded is null or cardinality(sf.dwelling_types_excluded) = 0
      or d.dwelling_type is null
      or not (d.dwelling_type = any(sf.dwelling_types_excluded))
    )
    and (sf.occupancy is null or sf.occupancy = d.occupancy)
    and (sf.property_value_min is null or d.property_value >= sf.property_value_min)
    and (sf.property_value_max is null or d.property_value is null or d.property_value <= sf.property_value_max)
    and (sf.loan_amount_min is null or d.loan_amount >= sf.loan_amount_min)
    and (sf.loan_amount_max is null or d.loan_amount is null or d.loan_amount <= sf.loan_amount_max)
    and (sf.gds_max is null or d.gds is null or d.gds <= sf.gds_max)
    and (sf.tds_max is null or d.tds is null or d.tds <= sf.tds_max)
    and (sf.insured is null or sf.insured = d.insured)
    and (sf.location_type is null or sf.location_type = d.location_type)
    and (sf.square_footage_min is null or d.square_footage >= sf.square_footage_min)
    and (sf.acres_max is null or d.acres is null or d.acres <= sf.acres_max)
    and (sf.max_doors is null or d.door_count is null or d.door_count <= sf.max_doors)
    and (
      sf.income_types is null or cardinality(sf.income_types) = 0 or not exists (
        select 1 from deal_income_types dit
        where dit.deal_id = d.id and dit.income_type = any(sf.income_types)
      )
    )
    and (
      sf.residency_statuses is null or cardinality(sf.residency_statuses) = 0 or not exists (
        select 1 from deal_residency_statuses drs
        where drs.deal_id = d.id and drs.residency = any(sf.residency_statuses)
      )
    )
    and not (coalesce(sf.exclude_fthb, false) and d.fthb)
    and not (coalesce(sf.exclude_new_to_canada, false) and d.new_to_canada)
    and not (coalesce(sf.exclude_networth_program, false) and d.networth_program)
    and not (coalesce(sf.exclude_medical_professional, false) and d.medical_professional)
    and not (coalesce(sf.exclude_collateral_transfer, false) and d.collateral_transfer)
    and not (coalesce(sf.exclude_cashback, false) and d.cashback)
    and not (coalesce(sf.exclude_bridge_loan, false) and d.bridge_loan_needed)
    and not (coalesce(sf.exclude_purchase_plus_improvements, false) and d.purchase_plus_improvements)
    and not (coalesce(sf.exclude_first_and_heloc, false) and d.first_and_heloc)
    and not (coalesce(sf.exclude_heloc, false) and d.heloc)
    and not (coalesce(sf.exclude_fixed_second, false) and d.fixed_second)
    and not (coalesce(sf.exclude_cosignor_occupying, false) and d.cosignor_occupying)
    and not (coalesce(sf.exclude_cosignor_not_occupying, false) and d.cosignor_not_occupying)
    and not (coalesce(sf.exclude_guarantor, false) and d.guarantor)
    and not (coalesce(sf.exclude_prequal, false) and d.prequal)
    and not (coalesce(sf.exclude_new_build, false) and d.new_build)
    and not (coalesce(sf.exclude_recreational, false) and d.recreational_property)
    and not (coalesce(sf.exclude_hobby_farm, false) and d.hobby_farm)
    and not (coalesce(sf.exclude_well_water, false) and d.well_water)
    and not (coalesce(sf.exclude_septic, false) and d.septic)
    -- Round 3 Create Deal fields, replicated as criteria:
    and (
      sf.credit_issues is null or cardinality(sf.credit_issues) = 0 or not exists (
        select 1 from deal_credit_issues dci
        where dci.deal_id = d.id and dci.credit_issue = any(sf.credit_issues)
      )
    )
    and (
      sf.down_payment_sources is null or cardinality(sf.down_payment_sources) = 0 or not exists (
        select 1 from deal_down_payment_sources ddps
        where ddps.deal_id = d.id and ddps.down_payment_source = any(sf.down_payment_sources)
      )
    )
    and not (coalesce(sf.exclude_reverse_mortgage, false) and d.reverse_mortgage)
    and not (coalesce(sf.exclude_married_or_common_law, false) and d.married_or_common_law)
    and not (coalesce(sf.exclude_spouse_not_on_application, false) and d.spouse_not_on_application)
    and not (coalesce(sf.exclude_transunion, false) and d.transunion_being_used)
    and (sf.assets_liquid_min is null or d.assets_liquid_value >= sf.assets_liquid_min)
    and (sf.assets_total_min is null or d.assets_total_value >= sf.assets_total_min)
    and (sf.max_door_titles is null or d.door_titles_count is null or d.door_titles_count <= sf.max_door_titles)
    and (not coalesce(sf.require_no_exceptions, false) or d.no_lender_exceptions_required)
$function$;

create or replace function match_percentage(sf saved_filters, d deals,
                                            out pct integer, out fails text[])
language plpgsql stable as $$
declare
  total integer := 0;
  matched integer := 0;
begin
  fails := '{}';
  -- E-5: the deal-side null check is what makes the criterion DROP OUT rather than score 0/18. Without
  -- it an untyped deal is charged the heaviest weight in the engine as a miss.
  if sf.transaction_type is not null and d.transaction_type is not null then
    total := total + 18;
    if sf.transaction_type = d.transaction_type then matched := matched + 18;
    else fails := array_append(fails, 'Transaction Type'); end if;
  end if;
  if sf.province is not null then
    total := total + 14;
    if sf.province = d.province then matched := matched + 14;
    else fails := array_append(fails, 'Province'); end if;
  end if;
  if sf.mortgage_product is not null then
    total := total + 14;
    if sf.mortgage_product = d.mortgage_product then matched := matched + 14;
    else fails := array_append(fails, 'Mortgage Product'); end if;
  end if;
  if sf.ltv_min is not null or sf.ltv_max is not null then
    total := total + 12;
    if (sf.ltv_min is null or d.ltv >= sf.ltv_min) and (sf.ltv_max is null or d.ltv <= sf.ltv_max)
      then matched := matched + 12;
    else fails := array_append(fails, 'LTV (%)'); end if;
  end if;
  if sf.credit_score_min is not null then
    total := total + 10;
    if d.primary_credit_score >= sf.credit_score_min then matched := matched + 10;
    else fails := array_append(fails, 'Credit Score'); end if;   -- Bubble omitted this from fails (OQ#10)
  end if;
  if sf.amortization_min is not null or sf.amortization_max is not null then
    total := total + 8;
    if (sf.amortization_min is null or d.amortization_years >= sf.amortization_min)
       and (sf.amortization_max is null or d.amortization_years <= sf.amortization_max)
      then matched := matched + 8;
    else fails := array_append(fails, 'Amortization'); end if;
  end if;
  if sf.mortgage_position is not null then
    total := total + 6;
    if sf.mortgage_position = d.mortgage_position then matched := matched + 6;
    else fails := array_append(fails, 'Mortgage Position'); end if;
  end if;
  if sf.purpose is not null then
    total := total + 6;
    if sf.purpose = d.purpose then matched := matched + 6;   -- fixed comparison (OQ#11)
    else fails := array_append(fails, 'Purpose'); end if;
  end if;
  if sf.dwelling_type is not null then
    total := total + 4;
    if sf.dwelling_type = d.dwelling_type then matched := matched + 4;
    else fails := array_append(fails, 'Dwelling Type'); end if;
  end if;
  if sf.occupancy is not null then
    total := total + 4;
    if sf.occupancy = d.occupancy then matched := matched + 4;
    else fails := array_append(fails, 'Occupancy Type'); end if;
  end if;
  if sf.property_value_min is not null or sf.property_value_max is not null then
    total := total + 4;
    if (sf.property_value_min is null or d.property_value >= sf.property_value_min)
       and (sf.property_value_max is null or d.property_value <= sf.property_value_max)
      then matched := matched + 4;
    else fails := array_append(fails, 'Property Value'); end if;
  end if;

  if total = 0 then pct := null;
  else pct := round(matched::numeric / total * 100)::int; end if;
end $$;

comment on column deals.transaction_type is
  'Prime / Alt / Private. OPTIONAL since E-5 (2026-07-30) — when null the deal is shown to lenders of all three types and the criterion is skipped by both saved_filter_matches and match_percentage.';
