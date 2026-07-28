-- Client revisions 2026-07-23 (A-15) + 2026-07-25 (B-18, B-19, B-20): a MAX filter was throwing
-- away deals that simply have no value for that field.
--
-- "if a loan doesn't have a TDS and GDS … when I put numbers in the filter it removed the deal without
-- the numbers showing … it's a max number. If there isn't a number at all it shouldn't remove it"
-- "Max doors is still removing loans that have 0 doors … It should only remove deals that are OVER the
-- number of doors allowed" / "Max Titles is doing the same thing" / "Max number of Acres is the same -
-- it is removing deals that don't have an amount listed. This is not what we want."
--
-- Root cause is SQL three-valued logic: `NULL <= 5` is NULL, not TRUE, so the predicate neither passes
-- nor fails — and inside a chain of ANDs that is indistinguishable from FALSE. Every upper-bound
-- criterion had the same shape, so all 9 are fixed, not just the four he happened to hit:
--   (sf.x_max is null or d.y <= sf.x_max)
--   → (sf.x_max is null or d.y is null or d.y <= sf.x_max)
--
-- His "0 doors" case is the same bug: a deal with door_count = 0 already passed (`0 <= 1` is TRUE), so
-- the ones disappearing were the ones where the broker left the field empty.
--
-- Rationale for extending it to ltv/amortization/property value/loan amount as well: a max filter is an
-- EXCLUSION tool ("nothing above X"), and a deal with an unknown value is not known to be above X.
-- Excluding it hides business from the lender — the exact complaint — while including it costs them a
-- glance at a "-". Same reasoning the client gave, applied consistently.
--
-- ⚠️ MIN criteria are deliberately NOT changed (credit_score_min, assets_liquid_min, assets_total_min,
-- property_value_min, loan_amount_min, ltv_min, amortization_min, square_footage_min). There the
-- opposite reading is defensible — asking for "at least $100k liquid assets" arguably should not match a
-- deal with none recorded — and the client only spoke about maximums. Flagged as an open question.
--
-- saved_filter_matches is the one place all the filtering paths converge (the saved-filter chips, the
-- ad-hoc Filters side panel via open_deals_filtered / maturing_deals_filtered, and the filter-match
-- notifications in submit_deal), so this single change fixes every one of them. The weighted match
-- engine (match_percentage / best_match_for) does NOT go through here and is untouched.
--
-- Signature is unchanged, so CREATE OR REPLACE is enough; the body below is the live definition with
-- only the 9 predicates above rewritten.

CREATE OR REPLACE FUNCTION public.saved_filter_matches(sf saved_filters, d deals)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select
    (sf.transaction_type is null or sf.transaction_type = d.transaction_type)
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
