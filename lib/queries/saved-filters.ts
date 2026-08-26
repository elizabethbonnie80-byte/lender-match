import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { LABELS } from "@/lib/enums"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]
type Row = Database["public"]["Tables"]["saved_filters"]["Row"]

/**
 * The full criteria shape `saved_filters` carries (see migration 01 + 29): weighted criteria that
 * score the maturing/expired match %, plus unweighted criteria that only FILTER (never score) —
 * ranges, location/doors, and the two "check to EXCLUDE" sets (income type, residency status) +
 * the 20 "check to EXCLUDE this program/product" flags. Shared between a saved, named filter
 * (`SavedFilterInput` below) and the New Deals page's ad-hoc (unsaved) Filters panel
 * (`OpenDealFilters` in `lib/queries/deals.ts`), since both apply via the same `saved_filter_matches`
 * DB function.
 */
export type FilterCriteria = {
  transactionType: Enums["transaction_type"] | null
  province: Enums["province"] | null
  mortgageProduct: Enums["mortgage_product"] | null
  purpose: Enums["transaction_purpose"] | null
  dwellingType: Enums["dwelling_type"] | null
  mortgagePosition: Enums["mortgage_position"] | null
  occupancy: Enums["occupancy_type"] | null
  locationType: Enums["location_type"] | null
  insured: boolean | null
  ltvMin: number | null
  ltvMax: number | null
  amortizationMin: number | null
  amortizationMax: number | null
  loanAmountMin: number | null
  loanAmountMax: number | null
  gdsMax: number | null
  tdsMax: number | null
  creditScoreMin: number | null
  maxDoors: number | null
  propertyValueMin: number | null
  propertyValueMax: number | null
  squareFootageMin: number | null
  acresMax: number | null
  /** Checked = this income type is NOT wanted (excluded), per the reference panel's copy. */
  /** A-1 (2026-07-23): dwelling types the lender does NOT want. Replaces the single-value
   *  `dwellingType` include in the UI; that field stays only for filters saved before the change. */
  dwellingTypesExcluded: Enums["dwelling_type"][]
  incomeTypesExcluded: Enums["income_type"][]
  /** Checked = this residency status is NOT wanted (excluded). */
  residencyStatusesExcluded: Enums["residency_status"][]
  excludeFthb: boolean
  excludeNewToCanada: boolean
  excludeNetworthProgram: boolean
  excludeMedicalProfessional: boolean
  excludeCollateralTransfer: boolean
  excludeCashback: boolean
  excludeBridgeLoan: boolean
  excludePurchasePlusImprovements: boolean
  excludeFirstAndHeloc: boolean
  excludeHeloc: boolean
  excludeFixedSecond: boolean
  excludeCosignorOccupying: boolean
  excludeCosignorNotOccupying: boolean
  excludeGuarantor: boolean
  excludePrequal: boolean
  excludeNewBuild: boolean
  excludeRecreational: boolean
  excludeHobbyFarm: boolean
  excludeWellWater: boolean
  excludeSeptic: boolean
  excludeHoldcoOnTitle: boolean
  excludeLenderToPayPropertyTaxes: boolean
  excludeBorrowerToPayPropertyTaxes: boolean
  // Round 3 Create Deal fields replicated as criteria (migration 43) — filter-only, never scored.
  /** Checked = deals carrying this credit issue are NOT wanted (excluded). */
  creditIssuesExcluded: Enums["credit_issue"][]
  /** Checked = deals with this down-payment source are NOT wanted (excluded). */
  downPaymentSourcesExcluded: Enums["down_payment_source"][]
  excludeReverseMortgage: boolean
  excludeSpousalBuyout: boolean
  excludeRefinancePlusImprovements: boolean
  excludeMarriedOrCommonLaw: boolean
  excludeSpouseNotOnApplication: boolean
  excludeTransunion: boolean
  assetsLiquidMin: number | null
  assetsTotalMin: number | null
  maxDoorTitles: number | null
  /** Only show deals whose "No lender exceptions required" box is checked (all 4 notes empty). */
  requireNoExceptions: boolean
}

export const EMPTY_FILTER_CRITERIA: FilterCriteria = {
  transactionType: null,
  province: null,
  mortgageProduct: null,
  purpose: null,
  dwellingType: null,
  mortgagePosition: null,
  occupancy: null,
  locationType: null,
  insured: null,
  ltvMin: null,
  ltvMax: null,
  amortizationMin: null,
  amortizationMax: null,
  loanAmountMin: null,
  loanAmountMax: null,
  gdsMax: null,
  tdsMax: null,
  creditScoreMin: null,
  maxDoors: null,
  propertyValueMin: null,
  propertyValueMax: null,
  squareFootageMin: null,
  acresMax: null,
  dwellingTypesExcluded: [],
  incomeTypesExcluded: [],
  residencyStatusesExcluded: [],
  excludeFthb: false,
  excludeNewToCanada: false,
  excludeNetworthProgram: false,
  excludeMedicalProfessional: false,
  excludeCollateralTransfer: false,
  excludeCashback: false,
  excludeBridgeLoan: false,
  excludePurchasePlusImprovements: false,
  excludeFirstAndHeloc: false,
  excludeHeloc: false,
  excludeFixedSecond: false,
  excludeCosignorOccupying: false,
  excludeCosignorNotOccupying: false,
  excludeGuarantor: false,
  excludePrequal: false,
  excludeNewBuild: false,
  excludeRecreational: false,
  excludeHobbyFarm: false,
  excludeWellWater: false,
  excludeSeptic: false,
  excludeHoldcoOnTitle: false,
  excludeLenderToPayPropertyTaxes: false,
  excludeBorrowerToPayPropertyTaxes: false,
  creditIssuesExcluded: [],
  downPaymentSourcesExcluded: [],
  excludeReverseMortgage: false,
  excludeSpousalBuyout: false,
  excludeRefinancePlusImprovements: false,
  excludeMarriedOrCommonLaw: false,
  excludeSpouseNotOnApplication: false,
  excludeTransunion: false,
  assetsLiquidMin: null,
  assetsTotalMin: null,
  maxDoorTitles: null,
  requireNoExceptions: false,
}

/** Number of distinct criteria groups set on an ad-hoc FilterCriteria, for a "Filters (N)" badge.
 *  Shared by the New Deals and Maturing Deals Filters sidepanels (both apply the same criteria shape). */
export function countActiveFilters(f: FilterCriteria): number {
  let n = 0
  if (f.transactionType) n++
  if (f.province) n++
  if (f.mortgageProduct) n++
  if (f.purpose) n++
  if (f.dwellingType) n++
  if (f.mortgagePosition) n++
  if (f.occupancy) n++
  if (f.locationType) n++
  if (f.insured) n++
  if (f.ltvMin !== null || f.ltvMax !== null) n++
  if (f.amortizationMin !== null || f.amortizationMax !== null) n++
  if (f.loanAmountMin !== null || f.loanAmountMax !== null) n++
  if (f.gdsMax !== null) n++
  if (f.tdsMax !== null) n++
  if (f.creditScoreMin !== null) n++
  if (f.maxDoors !== null) n++
  if (f.propertyValueMin !== null || f.propertyValueMax !== null) n++
  if (f.squareFootageMin !== null) n++
  if (f.acresMax !== null) n++
  if (f.dwellingTypesExcluded.length) n++
  if (f.incomeTypesExcluded.length) n++
  if (f.residencyStatusesExcluded.length) n++
  if (f.creditIssuesExcluded.length) n++
  if (f.downPaymentSourcesExcluded.length) n++
  if (f.assetsLiquidMin !== null) n++
  if (f.assetsTotalMin !== null) n++
  if (f.maxDoorTitles !== null) n++
  if (f.requireNoExceptions) n++
  if (
    f.excludeFthb || f.excludeNewToCanada || f.excludeNetworthProgram || f.excludeMedicalProfessional ||
    f.excludeCollateralTransfer || f.excludeCashback || f.excludeBridgeLoan || f.excludePurchasePlusImprovements ||
    f.excludeFirstAndHeloc || f.excludeHeloc || f.excludeFixedSecond || f.excludeCosignorOccupying ||
    f.excludeCosignorNotOccupying || f.excludeGuarantor || f.excludePrequal || f.excludeNewBuild ||
    f.excludeRecreational || f.excludeHobbyFarm || f.excludeWellWater || f.excludeSeptic ||
    f.excludeReverseMortgage || f.excludeMarriedOrCommonLaw || f.excludeSpouseNotOnApplication ||
    f.excludeTransunion || f.excludeHoldcoOnTitle || f.excludeSpousalBuyout || f.excludeRefinancePlusImprovements ||
    f.excludeLenderToPayPropertyTaxes || f.excludeBorrowerToPayPropertyTaxes
  ) n++
  return n
}

export type SavedFilterInput = FilterCriteria & {
  name: string
  isActive: boolean
}

export type SavedFilterRow = SavedFilterInput & {
  id: string
  criteriaCount: number
  criteriaPreview: string
}

export const EMPTY_SAVED_FILTER: SavedFilterInput = {
  name: "",
  isActive: true,
  ...EMPTY_FILTER_CRITERIA,
}

function rangeLabel(label: string, min: number | null, max: number | null, fmt = (n: number) => String(n)): string | null {
  if (min === null && max === null) return null
  if (min !== null && max !== null) return `${label} ${fmt(min)}–${fmt(max)}`
  if (min !== null) return `${label} ≥ ${fmt(min)}`
  return `${label} ≤ ${fmt(max as number)}`
}

/** Human summary of a filter's defined criteria (for the settings list). */
function summarize(f: SavedFilterInput): { count: number; preview: string } {
  const parts: string[] = []
  if (f.transactionType) parts.push(LABELS.transaction_type[f.transactionType])
  if (f.purpose) parts.push(LABELS.purpose[f.purpose])
  if (f.province) parts.push(LABELS.province[f.province])
  if (f.mortgageProduct) parts.push(LABELS.mortgage_product[f.mortgageProduct])
  if (f.mortgagePosition) parts.push(LABELS.mortgage_position[f.mortgagePosition])
  if (f.dwellingType) parts.push(LABELS.dwelling_type[f.dwellingType])
  if (f.occupancy) parts.push(LABELS.occupancy[f.occupancy])
  if (f.locationType) parts.push(LABELS.location_type[f.locationType])
  if (f.insured) parts.push("Insured")
  const ltv = rangeLabel("LTV", f.ltvMin, f.ltvMax, (n) => `${n}%`)
  if (ltv) parts.push(ltv)
  if (f.creditScoreMin !== null) parts.push(`Credit ≥ ${f.creditScoreMin}`)
  const amort = rangeLabel("Amort.", f.amortizationMin, f.amortizationMax, (n) => `${n}yr`)
  if (amort) parts.push(amort)
  const pv = rangeLabel("Value", f.propertyValueMin, f.propertyValueMax, (n) => `$${(n / 1000).toFixed(0)}k`)
  if (pv) parts.push(pv)
  const loan = rangeLabel("Loan", f.loanAmountMin, f.loanAmountMax, (n) => `$${(n / 1000).toFixed(0)}k`)
  if (loan) parts.push(loan)
  if (f.maxDoors !== null) parts.push(`Max ${f.maxDoors} doors`)
  if (f.maxDoorTitles !== null) parts.push(`Max ${f.maxDoorTitles} titles`)
  if (f.assetsLiquidMin !== null) parts.push(`Liquid ≥ $${(f.assetsLiquidMin / 1000).toFixed(0)}k`)
  if (f.assetsTotalMin !== null) parts.push(`Assets ≥ $${(f.assetsTotalMin / 1000).toFixed(0)}k`)
  if (f.requireNoExceptions) parts.push("No exceptions only")
  const excludedCount =
    f.dwellingTypesExcluded.length +
    f.incomeTypesExcluded.length +
    f.residencyStatusesExcluded.length +
    f.creditIssuesExcluded.length +
    f.downPaymentSourcesExcluded.length +
    [
      f.excludeFthb, f.excludeNewToCanada, f.excludeNetworthProgram, f.excludeMedicalProfessional,
      f.excludeCollateralTransfer, f.excludeCashback, f.excludeBridgeLoan, f.excludePurchasePlusImprovements,
      f.excludeFirstAndHeloc, f.excludeHeloc, f.excludeFixedSecond, f.excludeCosignorOccupying,
      f.excludeCosignorNotOccupying, f.excludeGuarantor, f.excludePrequal, f.excludeNewBuild,
      f.excludeRecreational, f.excludeHobbyFarm, f.excludeWellWater, f.excludeSeptic,
      f.excludeReverseMortgage, f.excludeMarriedOrCommonLaw, f.excludeSpouseNotOnApplication,
      f.excludeTransunion, f.excludeHoldcoOnTitle, f.excludeSpousalBuyout, f.excludeRefinancePlusImprovements,
      f.excludeLenderToPayPropertyTaxes, f.excludeBorrowerToPayPropertyTaxes,
    ].filter(Boolean).length
  if (excludedCount > 0) parts.push(`${excludedCount} exclusion${excludedCount > 1 ? "s" : ""}`)
  return { count: parts.length, preview: parts.join(" · ") || "No criteria set" }
}

function rowToInput(r: Row): SavedFilterInput {
  return {
    name: r.name,
    isActive: r.is_active,
    transactionType: r.transaction_type,
    province: r.province,
    mortgageProduct: r.mortgage_product,
    purpose: r.purpose,
    dwellingType: r.dwelling_type,
    mortgagePosition: r.mortgage_position,
    occupancy: r.occupancy,
    locationType: r.location_type,
    insured: r.insured,
    ltvMin: r.ltv_min === null ? null : Number(r.ltv_min),
    ltvMax: r.ltv_max === null ? null : Number(r.ltv_max),
    amortizationMin: r.amortization_min === null ? null : Number(r.amortization_min),
    amortizationMax: r.amortization_max === null ? null : Number(r.amortization_max),
    loanAmountMin: r.loan_amount_min === null ? null : Number(r.loan_amount_min),
    loanAmountMax: r.loan_amount_max === null ? null : Number(r.loan_amount_max),
    gdsMax: r.gds_max === null ? null : Number(r.gds_max),
    tdsMax: r.tds_max === null ? null : Number(r.tds_max),
    creditScoreMin: r.credit_score_min,
    maxDoors: r.max_doors,
    propertyValueMin: r.property_value_min === null ? null : Number(r.property_value_min),
    propertyValueMax: r.property_value_max === null ? null : Number(r.property_value_max),
    squareFootageMin: r.square_footage_min === null ? null : Number(r.square_footage_min),
    acresMax: r.acres_max === null ? null : Number(r.acres_max),
    dwellingTypesExcluded: r.dwelling_types_excluded ?? [],
    incomeTypesExcluded: r.income_types ?? [],
    residencyStatusesExcluded: r.residency_statuses ?? [],
    excludeFthb: r.exclude_fthb ?? false,
    excludeNewToCanada: r.exclude_new_to_canada ?? false,
    excludeNetworthProgram: r.exclude_networth_program ?? false,
    excludeMedicalProfessional: r.exclude_medical_professional ?? false,
    excludeCollateralTransfer: r.exclude_collateral_transfer ?? false,
    excludeCashback: r.exclude_cashback ?? false,
    excludeBridgeLoan: r.exclude_bridge_loan ?? false,
    excludePurchasePlusImprovements: r.exclude_purchase_plus_improvements ?? false,
    excludeFirstAndHeloc: r.exclude_first_and_heloc ?? false,
    excludeHeloc: r.exclude_heloc ?? false,
    excludeFixedSecond: r.exclude_fixed_second ?? false,
    excludeCosignorOccupying: r.exclude_cosignor_occupying ?? false,
    excludeCosignorNotOccupying: r.exclude_cosignor_not_occupying ?? false,
    excludeGuarantor: r.exclude_guarantor ?? false,
    excludePrequal: r.exclude_prequal ?? false,
    excludeNewBuild: r.exclude_new_build ?? false,
    excludeRecreational: r.exclude_recreational ?? false,
    excludeHobbyFarm: r.exclude_hobby_farm ?? false,
    excludeWellWater: r.exclude_well_water ?? false,
    excludeSeptic: r.exclude_septic ?? false,
    excludeHoldcoOnTitle: r.exclude_holdco_on_title ?? false,
    excludeLenderToPayPropertyTaxes: r.exclude_lender_to_pay_property_taxes ?? false,
    excludeBorrowerToPayPropertyTaxes: r.exclude_borrower_to_pay_property_taxes ?? false,
    creditIssuesExcluded: r.credit_issues ?? [],
    downPaymentSourcesExcluded: r.down_payment_sources ?? [],
    excludeReverseMortgage: r.exclude_reverse_mortgage ?? false,
    excludeSpousalBuyout: r.exclude_spousal_buyout ?? false,
    excludeRefinancePlusImprovements: r.exclude_refinance_plus_improvements ?? false,
    excludeMarriedOrCommonLaw: r.exclude_married_or_common_law ?? false,
    excludeSpouseNotOnApplication: r.exclude_spouse_not_on_application ?? false,
    excludeTransunion: r.exclude_transunion ?? false,
    assetsLiquidMin: r.assets_liquid_min === null ? null : Number(r.assets_liquid_min),
    assetsTotalMin: r.assets_total_min === null ? null : Number(r.assets_total_min),
    maxDoorTitles: r.max_door_titles,
    requireNoExceptions: r.require_no_exceptions ?? false,
  }
}

/** Map the UI input to the saved_filters column set (lender_id is set by RLS-checked insert). */
function inputToColumns(input: SavedFilterInput) {
  return {
    name: input.name,
    is_active: input.isActive,
    transaction_type: input.transactionType,
    province: input.province,
    mortgage_product: input.mortgageProduct,
    purpose: input.purpose,
    dwelling_type: input.dwellingType,
    mortgage_position: input.mortgagePosition,
    occupancy: input.occupancy,
    location_type: input.locationType,
    insured: input.insured,
    ltv_min: input.ltvMin,
    ltv_max: input.ltvMax,
    amortization_min: input.amortizationMin,
    amortization_max: input.amortizationMax,
    loan_amount_min: input.loanAmountMin,
    loan_amount_max: input.loanAmountMax,
    gds_max: input.gdsMax,
    tds_max: input.tdsMax,
    credit_score_min: input.creditScoreMin,
    max_doors: input.maxDoors,
    property_value_min: input.propertyValueMin,
    property_value_max: input.propertyValueMax,
    square_footage_min: input.squareFootageMin,
    acres_max: input.acresMax,
    dwelling_types_excluded: input.dwellingTypesExcluded.length ? input.dwellingTypesExcluded : null,
    income_types: input.incomeTypesExcluded.length ? input.incomeTypesExcluded : null,
    residency_statuses: input.residencyStatusesExcluded.length ? input.residencyStatusesExcluded : null,
    exclude_fthb: input.excludeFthb,
    exclude_new_to_canada: input.excludeNewToCanada,
    exclude_networth_program: input.excludeNetworthProgram,
    exclude_medical_professional: input.excludeMedicalProfessional,
    exclude_collateral_transfer: input.excludeCollateralTransfer,
    exclude_cashback: input.excludeCashback,
    exclude_bridge_loan: input.excludeBridgeLoan,
    exclude_purchase_plus_improvements: input.excludePurchasePlusImprovements,
    exclude_first_and_heloc: input.excludeFirstAndHeloc,
    exclude_heloc: input.excludeHeloc,
    exclude_fixed_second: input.excludeFixedSecond,
    exclude_cosignor_occupying: input.excludeCosignorOccupying,
    exclude_cosignor_not_occupying: input.excludeCosignorNotOccupying,
    exclude_guarantor: input.excludeGuarantor,
    exclude_prequal: input.excludePrequal,
    exclude_new_build: input.excludeNewBuild,
    exclude_recreational: input.excludeRecreational,
    exclude_hobby_farm: input.excludeHobbyFarm,
    exclude_well_water: input.excludeWellWater,
    exclude_septic: input.excludeSeptic,
    exclude_holdco_on_title: input.excludeHoldcoOnTitle,
    exclude_lender_to_pay_property_taxes: input.excludeLenderToPayPropertyTaxes,
    exclude_borrower_to_pay_property_taxes: input.excludeBorrowerToPayPropertyTaxes,
    credit_issues: input.creditIssuesExcluded.length ? input.creditIssuesExcluded : null,
    down_payment_sources: input.downPaymentSourcesExcluded.length ? input.downPaymentSourcesExcluded : null,
    exclude_reverse_mortgage: input.excludeReverseMortgage,
    exclude_spousal_buyout: input.excludeSpousalBuyout,
    exclude_refinance_plus_improvements: input.excludeRefinancePlusImprovements,
    exclude_married_or_common_law: input.excludeMarriedOrCommonLaw,
    exclude_spouse_not_on_application: input.excludeSpouseNotOnApplication,
    exclude_transunion: input.excludeTransunion,
    assets_liquid_min: input.assetsLiquidMin,
    assets_total_min: input.assetsTotalMin,
    max_door_titles: input.maxDoorTitles,
    require_no_exceptions: input.requireNoExceptions,
  }
}

/** The current lender's saved filters (RLS: filters_owner). */
export async function listSavedFilters(supabase: DB): Promise<SavedFilterRow[]> {
  const { data, error } = await supabase
    .from("saved_filters")
    .select("*")
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const input = rowToInput(r)
    const { count, preview } = summarize(input)
    return { id: r.id, ...input, criteriaCount: count, criteriaPreview: preview }
  })
}

export async function createSavedFilter(supabase: DB, input: SavedFilterInput) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in.")
  const { error } = await supabase
    .from("saved_filters")
    .insert({ ...inputToColumns(input), lender_id: user.id })
  if (error) throw new Error(error.message)
}

export async function updateSavedFilter(supabase: DB, id: string, input: SavedFilterInput) {
  const { error } = await supabase.from("saved_filters").update(inputToColumns(input)).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function setSavedFilterActive(supabase: DB, id: string, isActive: boolean) {
  const { error } = await supabase.from("saved_filters").update({ is_active: isActive }).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function deleteSavedFilter(supabase: DB, id: string) {
  const { error } = await supabase.from("saved_filters").delete().eq("id", id)
  if (error) throw new Error(error.message)
}
