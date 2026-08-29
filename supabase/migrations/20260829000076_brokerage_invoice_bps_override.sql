-- Brokerage-specific invoice bps override (approved 2026-08-29, revised same day to a single
-- consistent effective-bps rule used everywhere).
--
-- Business rule: the existing term-based platform fee (platform_bps_for — <=3y/open -> 3, 4y -> 4,
-- else -> 5) remains the DEFAULT for every brokerage. Admin can optionally pin an individual
-- brokerage to a fixed 3/4/5 bps rate; when set, it replaces the term-based calculation entirely for
-- every deal from that brokerage, regardless of mortgage term. Removing the override returns future
-- calculations to standard term-based pricing immediately.
--
-- ONE RULE, everywhere: `effective_platform_bps(brokerage_id, product) = coalesce(brokerage's
-- override, platform_bps_for(product))`. This single SQL function is now the only place that
-- calculation exists server-side:
--   * accept_offer calls it to compute the invoice's platform_bps.
--   * The four lender feed RPCs return the brokerage's raw override value (override_bps) — never the
--     brokerage_id itself (anonymity: brokerage_id is deliberately excluded from every lender-facing
--     deal field per migration 53's note, since a lender could join it against the anon-readable
--     `brokerages` table to de-anonymize the deal; a bare bps integer carries no such identity).
--     The client mirrors the SAME coalesce logic (lib/queries/deals.ts's effectivePlatformBpsFor) to
--     drive the Make Offer dialog's "Final Commission Amount" preview and the broker's net-commission
--     display — so the offer screen and the eventual invoice can never disagree.
--
-- Historical invoices are NEVER touched: invoices.platform_bps is a stored column populated once at
-- accept_offer time and never recomputed. A rate change has zero effect on any invoice already on
-- record.
--
-- Admin-only write enforcement reuses the EXISTING pattern for this table rather than a new RPC:
-- `lookup_write on brokerages for all to authenticated using (is_admin()) with check (is_admin())`
-- (migration 03) already covers UPDATE — the same policy already gating rename/activate/deactivate
-- from /admin/organizations. No RLS change needed.

alter table brokerages add column invoice_bps integer check (invoice_bps in (3, 4, 5));

comment on column brokerages.invoice_bps is
  'Admin-set invoice fee override in bps (2026-08-29). NULL (default) = standard term-based pricing. See effective_platform_bps() for the one calculation every screen and the invoice both use. Never affects invoices already created — invoices.platform_bps is fixed at insert time.';

-- ============================================================================
-- effective_platform_bps: the single source of truth. security definer so it can be called both from
-- accept_offer (broker's transaction) and from within the feed RPCs below without an RLS surprise.
-- ============================================================================

create or replace function effective_platform_bps(p_brokerage_id uuid, p_product mortgage_product) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select invoice_bps from brokerages where id = p_brokerage_id),
    platform_bps_for(p_product)
  )
$$;

-- ============================================================================
-- accept_offer: use effective_platform_bps instead of a bare platform_bps_for call. Signature
-- unchanged — CREATE OR REPLACE, no DROP needed. Built from migration 48's current latest body; every
-- other line (prequal guard, auto-decline, identity reveal, name-variance lookup, notification) is
-- byte-for-byte unchanged.
-- ============================================================================

create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
begin
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  -- Round 3 Phase 3: the offer carries over, but the deal must be live first — the invoice needs a
  -- closing date (invoices.closing_date is NOT NULL, due_date = closing_date + 21).
  if coalesce(d.prequal, false) or d.closing_date is null then
    raise exception 'Move this prequal to a live deal (address + closing date) before accepting an offer.';
  end if;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

  -- one-step confirm: acceptance immediately reveals + invoices (no separate Confirm Lender)
  update deals set status = 'confirmed', accepted_offer_id = o.id, lender_confirmed = true
  where id = d.id;

  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := effective_platform_bps(d.brokerage_id, o.mortgage_product);

  -- Name variance: surface the document name on the invoice (photo ID preferred) so the lender can
  -- reconcile. Only when a checked document flagged a preferred-name variance.
  select dd.extracted_name into v_doc_name
    from deal_documents dd
   where dd.deal_id = d.id and dd.name_variance is true and dd.extracted_name is not null
   order by (dd.kind = 'photo_id') desc, dd.checked_at desc nulls last
   limit 1;

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        document_name, closing_date, due_date)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(d.loan_amount * bps / 10000.0, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          v_doc_name,
          d.closing_date, d.closing_date + 21)
  returning * into inv;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted. Invoice %s has been generated.',
                        d.deal_number, inv.invoice_number),
                 d.id, o.id);

  select * into o from offers where id = p_offer_id;
  return o;
end $$;

-- ============================================================================
-- The four lender feed RPCs: add ONE new OUT column, override_bps — the brokerage's raw invoice_bps
-- value (null = standard pricing), never brokerage_id itself. Bodies are otherwise byte-for-byte
-- identical to migration 75 (the current latest) — every other column, join, and WHERE clause is
-- unchanged. OUT-column change requires DROP FUNCTION first for all four.
-- ============================================================================

drop function if exists open_deals_for_lender(p_filter_id uuid);
CREATE OR REPLACE FUNCTION public.open_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, override_bps integer)
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
         (select b.invoice_bps from brokerages b where b.id = d.brokerage_id)
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

drop function if exists open_deals_filtered(p_transaction_type transaction_type, p_province province, p_mortgage_product mortgage_product, p_purpose transaction_purpose, p_dwelling_type dwelling_type, p_mortgage_position mortgage_position, p_occupancy occupancy_type, p_location_type location_type, p_insured boolean, p_ltv_min numeric, p_ltv_max numeric, p_amortization_min numeric, p_amortization_max numeric, p_loan_amount_min numeric, p_loan_amount_max numeric, p_gds_max numeric, p_tds_max numeric, p_credit_score_min integer, p_max_doors integer, p_property_value_min numeric, p_property_value_max numeric, p_square_footage_min numeric, p_acres_max numeric, p_income_types_excluded income_type[], p_residency_statuses_excluded residency_status[], p_others_excluded text[], p_credit_issues_excluded credit_issue[], p_down_payment_sources_excluded down_payment_source[], p_assets_liquid_min numeric, p_assets_total_min numeric, p_max_door_titles integer, p_require_no_exceptions boolean, p_dwelling_types_excluded dwelling_type[], p_mobile_home_csa_seal_year_min integer);
CREATE OR REPLACE FUNCTION public.open_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[], p_mobile_home_csa_seal_year_min integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, override_bps integer)
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
           (select b.invoice_bps from brokerages b where b.id = d.brokerage_id)
    from deals d
    where lender_can_see_deal(d)
      and not my_institution_offered_on(d.id)
      and saved_filter_matches(v_sf, d)
    order by d.submitted_at desc nulls last;
end;
$function$;

drop function if exists maturing_deals_for_lender(p_filter_id uuid);
CREATE OR REPLACE FUNCTION public.maturing_deals_for_lender(p_filter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric(14,2), assets_total_value numeric(14,2), door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[], override_bps integer)
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
         m.pct, m.filter_name, m.fails,
         (select b.invoice_bps from brokerages b where b.id = d.brokerage_id)
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

drop function if exists maturing_deals_filtered(p_transaction_type transaction_type, p_province province, p_mortgage_product mortgage_product, p_purpose transaction_purpose, p_dwelling_type dwelling_type, p_mortgage_position mortgage_position, p_occupancy occupancy_type, p_location_type location_type, p_insured boolean, p_ltv_min numeric, p_ltv_max numeric, p_amortization_min numeric, p_amortization_max numeric, p_loan_amount_min numeric, p_loan_amount_max numeric, p_gds_max numeric, p_tds_max numeric, p_credit_score_min integer, p_max_doors integer, p_property_value_min numeric, p_property_value_max numeric, p_square_footage_min numeric, p_acres_max numeric, p_income_types_excluded income_type[], p_residency_statuses_excluded residency_status[], p_others_excluded text[], p_credit_issues_excluded credit_issue[], p_down_payment_sources_excluded down_payment_source[], p_assets_liquid_min numeric, p_assets_total_min numeric, p_max_door_titles integer, p_require_no_exceptions boolean, p_dwelling_types_excluded dwelling_type[], p_mobile_home_csa_seal_year_min integer);
CREATE OR REPLACE FUNCTION public.maturing_deals_filtered(p_transaction_type transaction_type DEFAULT NULL::transaction_type, p_province province DEFAULT NULL::province, p_mortgage_product mortgage_product DEFAULT NULL::mortgage_product, p_purpose transaction_purpose DEFAULT NULL::transaction_purpose, p_dwelling_type dwelling_type DEFAULT NULL::dwelling_type, p_mortgage_position mortgage_position DEFAULT NULL::mortgage_position, p_occupancy occupancy_type DEFAULT NULL::occupancy_type, p_location_type location_type DEFAULT NULL::location_type, p_insured boolean DEFAULT NULL::boolean, p_ltv_min numeric DEFAULT NULL::numeric, p_ltv_max numeric DEFAULT NULL::numeric, p_amortization_min numeric DEFAULT NULL::numeric, p_amortization_max numeric DEFAULT NULL::numeric, p_loan_amount_min numeric DEFAULT NULL::numeric, p_loan_amount_max numeric DEFAULT NULL::numeric, p_gds_max numeric DEFAULT NULL::numeric, p_tds_max numeric DEFAULT NULL::numeric, p_credit_score_min integer DEFAULT NULL::integer, p_max_doors integer DEFAULT NULL::integer, p_property_value_min numeric DEFAULT NULL::numeric, p_property_value_max numeric DEFAULT NULL::numeric, p_square_footage_min numeric DEFAULT NULL::numeric, p_acres_max numeric DEFAULT NULL::numeric, p_income_types_excluded income_type[] DEFAULT NULL::income_type[], p_residency_statuses_excluded residency_status[] DEFAULT NULL::residency_status[], p_others_excluded text[] DEFAULT NULL::text[], p_credit_issues_excluded credit_issue[] DEFAULT NULL::credit_issue[], p_down_payment_sources_excluded down_payment_source[] DEFAULT NULL::down_payment_source[], p_assets_liquid_min numeric DEFAULT NULL::numeric, p_assets_total_min numeric DEFAULT NULL::numeric, p_max_door_titles integer DEFAULT NULL::integer, p_require_no_exceptions boolean DEFAULT NULL::boolean, p_dwelling_types_excluded dwelling_type[] DEFAULT NULL::dwelling_type[], p_mobile_home_csa_seal_year_min integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, deal_number text, submitted_at timestamp with time zone, city text, province province, location_type location_type, dwelling_type dwelling_type, property_value numeric, square_footage numeric, acres numeric, general_notes text, closing_date date, closing_date_flexible boolean, cof_date date, mortgage_product mortgage_product, mortgage_position mortgage_position, loan_amount numeric, ltv numeric, amortization_years numeric, insured boolean, purpose transaction_purpose, transaction_type transaction_type, previously_declined boolean, previously_declined_reason text, primary_credit_score integer, credit_issues credit_issue[], co_borrower_credit_score integer, income_types income_type[], gds numeric, tds numeric, tds_includes_child_support_alimony boolean, foreign_income_country text, residency_statuses residency_status[], down_payment_sources down_payment_source[], owns_other_properties boolean, door_count integer, credit_notes text, income_notes text, down_payment_notes text, prequal boolean, new_build boolean, hobby_farm boolean, recreational_property boolean, well_water boolean, septic boolean, holdco_on_title boolean, lender_to_pay_property_taxes boolean, borrower_to_pay_property_taxes boolean, mobile_home_year_built integer, mobile_home_has_csa_seal boolean, mobile_home_csa_seal_year integer, occupancy occupancy_type, fthb boolean, networth_program boolean, medical_professional boolean, new_to_canada boolean, purchase_plus_improvements boolean, collateral_transfer boolean, cashback boolean, bridge_loan_needed boolean, first_and_heloc boolean, heloc boolean, fixed_second boolean, cosignor_occupying boolean, cosignor_not_occupying boolean, guarantor boolean, reverse_mortgage boolean, spousal_buyout boolean, refinance_plus_improvements boolean, assets_liquid_value numeric, assets_total_value numeric, door_titles_count integer, transunion_being_used boolean, married_or_common_law boolean, spouse_not_on_application boolean, no_lender_exceptions_required boolean, match_pct integer, match_filter text, match_fails text[], override_bps integer)
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
           m.pct, m.filter_name, m.fails,
           (select b.invoice_bps from brokerages b where b.id = d.brokerage_id)
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
