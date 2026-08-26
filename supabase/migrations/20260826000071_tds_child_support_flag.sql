-- Round 4 (approved for this item only, 2026-08-26) — J-7: "Check if child support or alimony
-- payments are included in the TDS ratios." Broker Create Deal, directly under GDS/TDS.
--
-- Purely informational: the broker's entered TDS value is never recalculated or altered by this
-- flag, and it carries no lender filter (explicitly not requested) — so, unlike every other flag
-- added today, this migration touches NEITHER `saved_filters` NOR `saved_filter_matches` NOR
-- `match_percentage`. The only reason the four lender feed RPCs are touched at all is that the
-- client wants this shown on the lender deal-detail card next to GDS/TDS, which requires the value
-- to flow through the feed the card is built from.
--
-- New OUT column changes the RETURNS TABLE shape of the four feed RPCs, which CREATE OR REPLACE
-- cannot do — same DROP + CREATE pattern as migrations 29/31/37/49/53/67/68. Built from migration
-- 68's function bodies — the current latest definition of all four RPCs — so holdco_on_title,
-- spousal_buyout, and refinance_plus_improvements are carried forward untouched.

alter table deals
  add column tds_includes_child_support_alimony boolean not null default false;

comment on column deals.tds_includes_child_support_alimony is
  'Round 4 J-7 (2026-08-26): broker-recorded note that the entered TDS already includes child support/alimony payments. Purely informational — never recalculates TDS, no lender filter, not part of match_percentage or saved_filter_matches.';

-- ============================================================================
-- The four feed RPCs: add tds_includes_child_support_alimony to the OUT column list.
-- saved_filter_matches and match_percentage are NOT touched by this migration.
-- ============================================================================

drop function if exists open_deals_for_lender(p_filter_id uuid);
CREATE OR REPLACE FUNCTION public.open_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean)
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
         d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required
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
CREATE OR REPLACE FUNCTION public.open_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[])
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean)
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
           d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required
    from deals d
    where lender_can_see_deal(d)
      and not i_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
    order by d.submitted_at desc nulls last;
end;
$function$;

drop function if exists maturing_deals_for_lender(p_filter_id uuid);
CREATE OR REPLACE FUNCTION public.maturing_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[])
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
         d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required,
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
CREATE OR REPLACE FUNCTION public.maturing_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[])
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[])
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
           d.credit_notes, d.income_notes, d.down_payment_notes, d.prequal, d.new_build, d.hobby_farm, d.recreational_property, d.well_water, d.septic, d.holdco_on_title, d.occupancy, d.fthb, d.networth_program, d.medical_professional, d.new_to_canada, d.purchase_plus_improvements, d.collateral_transfer, d.cashback, d.bridge_loan_needed, d.first_and_heloc, d.heloc, d.fixed_second, d.cosignor_occupying, d.cosignor_not_occupying, d.guarantor, d.reverse_mortgage, d.spousal_buyout, d.refinance_plus_improvements, d.assets_liquid_value, d.assets_total_value, d.door_titles_count, d.transunion_being_used, d.married_or_common_law, d.spouse_not_on_application, d.no_lender_exceptions_required,
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
