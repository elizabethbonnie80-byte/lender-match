-- Mobile Home Year Built + CSA Seal (approved 2026-08-27) — Broker Create Deal, Property section:
-- when dwelling_type = 'mobile_home', capture Year Built, "Has CSA seal?", and (nested, shown only
-- when the checkbox is checked) CSA Seal Year.
--
-- Three plain `deals` columns; ONE `saved_filters` criterion — a minimum CSA Seal Year — not a
-- boolean exclusion on the checkbox. There is deliberately no exclude_mobile_home_has_csa_seal
-- column: an unconfirmed checkbox must never exclude a deal. Only a KNOWN CSA Seal Year below the
-- lender's minimum does.
--
-- saved_filter_matches' new predicate is intentionally NULL-SAFE ON THE DEAL SIDE, unlike this
-- codebase's usual MIN-criterion convention (see migration 54's docstring — "MIN criteria
-- deliberately untouched": a deal with a null value normally FAILS a MIN filter here, e.g.
-- credit_score_min). This one is the deliberate exception: a mobile home with no CSA Seal Year on
-- file must pass the filter regardless of the lender's minimum, and the criterion must never apply
-- to a non-mobile-home deal at all. DO NOT "fix" this to match the usual null-unsafe MIN pattern —
-- that would exclude deals solely because the CSA information is unknown, which is the opposite of
-- the approved behaviour.
--
-- Built from migration 72's current latest definitions of saved_filter_matches and all four lender
-- feed RPCs — preserves lender_to_pay_property_taxes / borrower_to_pay_property_taxes /
-- holdco_on_title / spousal_buyout / refinance_plus_improvements / tds_includes_child_support_alimony
-- untouched.

alter table deals
  add column mobile_home_year_built integer,
  add column mobile_home_has_csa_seal boolean not null default false,
  add column mobile_home_csa_seal_year integer;

alter table saved_filters
  add column mobile_home_csa_seal_year_min integer;

comment on column deals.mobile_home_year_built is
  'Mobile Home / CSA Seal (2026-08-27): broker-entered year built, only meaningful when dwelling_type = mobile_home. Cleared to null in application code when dwelling type is changed away from mobile_home. Not a lender filter criterion, never part of match_percentage.';
comment on column deals.mobile_home_has_csa_seal is
  'Mobile Home / CSA Seal (2026-08-27): broker confirmation checkbox, only meaningful when dwelling_type = mobile_home. An unchecked value means "not confirmed" and must NEVER be used to exclude a deal from lender feeds — the lender-facing criterion is saved_filters.mobile_home_csa_seal_year_min against mobile_home_csa_seal_year, not this flag. Cleared to false in application code when dwelling type is changed away from mobile_home.';
comment on column deals.mobile_home_csa_seal_year is
  'Mobile Home / CSA Seal (2026-08-27): broker-entered CSA seal year, only collected when mobile_home_has_csa_seal is checked. Cleared to null in application code when dwelling type is changed away from mobile_home, or when mobile_home_has_csa_seal is unchecked. This is the field the lender minimum filter (saved_filters.mobile_home_csa_seal_year_min) is checked against.';
comment on column saved_filters.mobile_home_csa_seal_year_min is
  'Lender-set minimum CSA seal year for mobile home deals ("Minimum CSA seal year accepted"). NULL-SAFE ON THE DEAL SIDE, unlike this codebase''s other MIN criteria: a deal with no CSA Seal Year on file, or that is not a mobile home, always passes regardless of this value. See saved_filter_matches for the exact predicate. Filter-only — never part of match_percentage.';

-- ============================================================================
-- saved_filter_matches: one new line in the exclusion chain (return type unchanged)
-- ============================================================================

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
    and not (coalesce(sf.exclude_holdco_on_title, false) and d.holdco_on_title)
    and not (coalesce(sf.exclude_lender_to_pay_property_taxes, false) and d.lender_to_pay_property_taxes)
    and not (coalesce(sf.exclude_borrower_to_pay_property_taxes, false) and d.borrower_to_pay_property_taxes)
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
    and not (coalesce(sf.exclude_spousal_buyout, false) and d.spousal_buyout)
    and not (coalesce(sf.exclude_refinance_plus_improvements, false) and d.refinance_plus_improvements)
    and (sf.assets_liquid_min is null or d.assets_liquid_value >= sf.assets_liquid_min)
    and (sf.assets_total_min is null or d.assets_total_value >= sf.assets_total_min)
    and (sf.max_door_titles is null or d.door_titles_count is null or d.door_titles_count <= sf.max_door_titles)
    and (not coalesce(sf.require_no_exceptions, false) or d.no_lender_exceptions_required)
    -- Mobile Home / CSA Seal (2026-08-27): NULL-SAFE ON THE DEAL SIDE by design (see file header) —
    -- excludes only when the filter is set AND the deal is a mobile home AND a CSA Seal Year is on
    -- file AND that year is below the lender's minimum. Unconfirmed CSA info never excludes, and
    -- non-mobile-home deals are never affected.
    and (
      sf.mobile_home_csa_seal_year_min is null
      or d.dwelling_type is distinct from 'mobile_home'
      or d.mobile_home_csa_seal_year is null
      or d.mobile_home_csa_seal_year >= sf.mobile_home_csa_seal_year_min
    )
$function$;

-- ============================================================================
-- The four feed RPCs: add mobile_home_year_built, mobile_home_has_csa_seal, mobile_home_csa_seal_year
-- to the OUT column list (placed alongside the other Property Characteristics columns, right after
-- borrower_to_pay_property_taxes). tds_includes_child_support_alimony, holdco_on_title,
-- spousal_buyout, refinance_plus_improvements, lender/borrower_to_pay_property_taxes are carried
-- forward untouched. The two `_filtered` RPCs also gain a trailing
-- p_mobile_home_csa_seal_year_min integer parameter.
-- ============================================================================

drop function if exists open_deals_for_lender(p_filter_id uuid);
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
    and not i_offered_on(d.id)
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

drop function if exists open_deals_filtered(p_transaction_type transaction_type, p_province province, p_mortgage_product mortgage_product, p_purpose transaction_purpose, p_dwelling_type dwelling_type, p_mortgage_position mortgage_position, p_occupancy occupancy_type, p_location_type location_type, p_insured boolean, p_ltv_min numeric, p_ltv_max numeric, p_amortization_min numeric, p_amortization_max numeric, p_loan_amount_min numeric, p_loan_amount_max numeric, p_gds_max numeric, p_tds_max numeric, p_credit_score_min integer, p_max_doors integer, p_property_value_min numeric, p_property_value_max numeric, p_square_footage_min numeric, p_acres_max numeric, p_income_types_excluded income_type[], p_residency_statuses_excluded residency_status[], p_others_excluded text[], p_credit_issues_excluded credit_issue[], p_down_payment_sources_excluded down_payment_source[], p_assets_liquid_min numeric, p_assets_total_min numeric, p_max_door_titles integer, p_require_no_exceptions boolean, p_dwelling_types_excluded dwelling_type[]);
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
  -- Mobile Home / CSA Seal (2026-08-27)
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
      and not i_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
    order by d.submitted_at desc nulls last;
end;
$function$;

drop function if exists maturing_deals_for_lender(p_filter_id uuid);
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
    and not i_offered_on(d.id)
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

drop function if exists maturing_deals_filtered(p_transaction_type transaction_type, p_province province, p_mortgage_product mortgage_product, p_purpose transaction_purpose, p_dwelling_type dwelling_type, p_mortgage_position mortgage_position, p_occupancy occupancy_type, p_location_type location_type, p_insured boolean, p_ltv_min numeric, p_ltv_max numeric, p_amortization_min numeric, p_amortization_max numeric, p_loan_amount_min numeric, p_loan_amount_max numeric, p_gds_max numeric, p_tds_max numeric, p_credit_score_min integer, p_max_doors integer, p_property_value_min numeric, p_property_value_max numeric, p_square_footage_min numeric, p_acres_max numeric, p_income_types_excluded income_type[], p_residency_statuses_excluded residency_status[], p_others_excluded text[], p_credit_issues_excluded credit_issue[], p_down_payment_sources_excluded down_payment_source[], p_assets_liquid_min numeric, p_assets_total_min numeric, p_max_door_titles integer, p_require_no_exceptions boolean, p_dwelling_types_excluded dwelling_type[]);
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
  -- Mobile Home / CSA Seal (2026-08-27)
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
      and not i_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
      and d.created_at <= now() - interval '2 days'
      and d.created_at >  now() - interval '15 days'
    order by m.pct desc nulls last, d.closing_date asc nulls last;
end;
$function$;
