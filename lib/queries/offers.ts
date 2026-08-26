import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { PROVINCE_CODE, productTermYears, productTermLabel, type LenderDealListItem } from "@/lib/queries/deals"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]

// ── Lender: make an offer ──────────────────────────────────────────────────────

export type MakeOfferInput = {
  dealId: string
  mortgageProduct: Enums["mortgage_product"]
  rate: number
  rateLockDays: number
  commissionBps: number
  commitmentTurnTimeDays?: number | null
  docReviewTurnTimeDays?: number | null
  comments?: string | null
  /** Optional, one decimal — loan-pricing info shown to the broker for comparison; never affects the invoice. */
  lenderFeePct?: number | null
}

/** Submit an offer (atomic RPC: insert + flip deal to offer_received + notify broker). */
export async function makeOffer(supabase: DB, input: MakeOfferInput) {
  const { data, error } = await supabase.rpc("make_offer", {
    p_deal_id: input.dealId,
    p_mortgage_product: input.mortgageProduct,
    p_rate: input.rate,
    p_rate_lock_days: input.rateLockDays,
    p_commission_bps: input.commissionBps,
    p_commitment_turn_time_days: input.commitmentTurnTimeDays ?? undefined,
    p_doc_review_turn_time_days: input.docReviewTurnTimeDays ?? undefined,
    p_comments: input.comments ?? undefined,
    p_lender_fee_pct: input.lenderFeePct ?? undefined,
  })
  if (error) throw new Error(error.message)
  return data
}

export type EditOfferInput = Omit<MakeOfferInput, "dealId"> & { offerId: string }

/**
 * Round 3: edit a PENDING offer in place (edit_offer RPC, migration 41) — same field set as
 * make_offer. Server enforces own-offer + still-pending, re-scans the comments for contact info,
 * and notifies the broker (without revealing the lender's identity).
 */
export async function editOffer(supabase: DB, input: EditOfferInput) {
  const { data, error } = await supabase.rpc("edit_offer", {
    p_offer_id: input.offerId,
    p_mortgage_product: input.mortgageProduct,
    p_rate: input.rate,
    p_rate_lock_days: input.rateLockDays,
    p_commission_bps: input.commissionBps,
    p_commitment_turn_time_days: input.commitmentTurnTimeDays ?? undefined,
    p_doc_review_turn_time_days: input.docReviewTurnTimeDays ?? undefined,
    p_comments: input.comments ?? undefined,
    p_lender_fee_pct: input.lenderFeePct ?? undefined,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── Broker: deal detail + offers ───────────────────────────────────────────────

export type DealOffer = {
  id: string
  offerNumber: number
  status: Enums["offer_status"]
  mortgageProduct: Enums["mortgage_product"]
  rate: number
  rateLockDays: number
  commissionBps: number
  commitmentTurnTimeDays: number | null
  docReviewTurnTimeDays: number | null
  comments: string | null
  createdAt: string
  lenderFeePct: number | null
}

export type BrokerDealDetail = {
  id: string
  dealNumber: string
  status: Enums["deal_status"]
  clientName: string
  propertyAddress: string | null
  city: string | null
  province: Enums["province"] | null
  loanAmount: number
  ltv: number | null
  mortgageProduct: Enums["mortgage_product"] | null
  amortizationYears: number | null
  closingDate: string | null
  acceptedOfferId: string | null
  lenderConfirmed: boolean
  /** Round 3 Phase 3: still a prequal (no address/closing date yet). */
  prequal: boolean
  /** Non-null once "Move to Live Deal" ran. Either flag means the offers on this deal were placed on
   *  a pre-qualification, which is what the broker-facing prequal disclaimer is keyed off. */
  prequalConvertedAt: string | null
}

/** The broker's own deal with the borrower identity (RLS lets the owner read deal_identities). */
export async function getBrokerDealDetail(supabase: DB, dealId: string): Promise<BrokerDealDetail | null> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, deal_number, status, city, province, loan_amount, ltv, mortgage_product, amortization_years, closing_date, accepted_offer_id, lender_confirmed, prequal, prequal_converted_at, deal_identities(borrower_first_name, borrower_last_name, property_address)",
    )
    .eq("id", dealId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  const ident = Array.isArray(data.deal_identities) ? data.deal_identities[0] : data.deal_identities
  const name = [ident?.borrower_first_name, ident?.borrower_last_name].filter(Boolean).join(" ")
  return {
    id: data.id,
    dealNumber: data.deal_number ?? "—",
    status: data.status,
    clientName: name || "—",
    propertyAddress: ident?.property_address ?? null,
    city: data.city,
    province: data.province,
    loanAmount: Number(data.loan_amount ?? 0),
    ltv: data.ltv === null ? null : Number(data.ltv),
    mortgageProduct: data.mortgage_product,
    amortizationYears: data.amortization_years === null ? null : Number(data.amortization_years),
    closingDate: data.closing_date,
    acceptedOfferId: data.accepted_offer_id,
    lenderConfirmed: data.lender_confirmed,
    prequal: data.prequal ?? false,
    prequalConvertedAt: data.prequal_converted_at,
  }
}

/**
 * A deal as the FULL non-identity field set (property/deal/qualifying), shaped like a
 * LenderDealListItem so the shared LenderDealDetailSections component can render it.
 *
 * Works for BOTH roles and relies on RLS to decide: the owning broker reads their own row, and a lender
 * reads it once they have offered on it (deals_lender_offered) — which is what lets Submitted Offers
 * show the same detail as New Deals (client 2026-07-23 A-19). deal_identities is never selected here,
 * so the borrower name / property address stay behind the anonymity boundary either way.
 */
export async function getDealFull(supabase: DB, dealId: string): Promise<LenderDealListItem | null> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, deal_number, created_at, city, province, location_type, dwelling_type, property_value, square_footage, acres, general_notes, closing_date, closing_date_flexible, cof_date, mortgage_product, mortgage_position, loan_amount, ltv, amortization_years, insured, previously_declined, previously_declined_reason, primary_credit_score, co_borrower_credit_score, gds, tds, tds_includes_child_support_alimony, foreign_income_country, owns_other_properties, door_count, credit_notes, income_notes, prequal, down_payment_notes, occupancy, new_build, hobby_farm, recreational_property, well_water, septic, holdco_on_title, fthb, networth_program, medical_professional, new_to_canada, purchase_plus_improvements, collateral_transfer, cashback, bridge_loan_needed, first_and_heloc, heloc, fixed_second, cosignor_occupying, cosignor_not_occupying, guarantor, reverse_mortgage, spousal_buyout, refinance_plus_improvements, assets_liquid_value, assets_total_value, door_titles_count, transunion_being_used, married_or_common_law, spouse_not_on_application, no_lender_exceptions_required, purpose, transaction_type, deal_income_types(income_type), deal_residency_statuses(residency), deal_credit_issues(credit_issue), deal_down_payment_sources(down_payment_source)",
    )
    .eq("id", dealId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    id: data.id,
    dealNumber: data.deal_number ?? "—",
    submittedAt: data.created_at,
    city: data.city,
    province: data.province,
    locationType: data.location_type,
    dwellingType: data.dwelling_type,
    propertyValue: data.property_value === null ? null : Number(data.property_value),
    squareFootage: data.square_footage === null ? null : Number(data.square_footage),
    acres: data.acres === null ? null : Number(data.acres),
    generalNotes: data.general_notes,
    closingDate: data.closing_date,
    closingDateFlexible: data.closing_date_flexible ?? false,
    cofDate: data.cof_date,
    mortgageProduct: data.mortgage_product,
    mortgagePosition: data.mortgage_position,
    loanAmount: data.loan_amount === null ? null : Number(data.loan_amount),
    ltv: data.ltv === null ? null : Number(data.ltv),
    amortizationYears: data.amortization_years,
    insured: data.insured ?? false,
    previouslyDeclined: data.previously_declined ?? false,
    previouslyDeclinedReason: data.previously_declined_reason,
    primaryCreditScore: data.primary_credit_score,
    creditIssues: (data.deal_credit_issues ?? []).map((r: { credit_issue: Enums["credit_issue"] }) => r.credit_issue),
    coBorrowerCreditScore: data.co_borrower_credit_score,
    incomeTypes: (data.deal_income_types ?? []).map((r: { income_type: Enums["income_type"] }) => r.income_type),
    gds: data.gds === null ? null : Number(data.gds),
    tds: data.tds === null ? null : Number(data.tds),
    tdsIncludesChildSupportAlimony: data.tds_includes_child_support_alimony ?? false,
    foreignIncomeCountry: data.foreign_income_country,
    residencyStatuses: (data.deal_residency_statuses ?? []).map((r: { residency: Enums["residency_status"] }) => r.residency),
    downPaymentSources: (data.deal_down_payment_sources ?? []).map((r: { down_payment_source: Enums["down_payment_source"] }) => r.down_payment_source),
    ownsOtherProperties: data.owns_other_properties ?? false,
    doorCount: data.door_count,
    creditNotes: data.credit_notes,
    incomeNotes: data.income_notes,
    downPaymentNotes: data.down_payment_notes,
    prequal: data.prequal ?? false,
    purpose: data.purpose,
    transactionType: data.transaction_type,
    occupancy: data.occupancy,
    newBuild: data.new_build ?? false,
    hobbyFarm: data.hobby_farm ?? false,
    recreationalProperty: data.recreational_property ?? false,
    wellWater: data.well_water ?? false,
    septic: data.septic ?? false,
    holdcoOnTitle: data.holdco_on_title ?? false,
    fthb: data.fthb ?? false,
    networthProgram: data.networth_program ?? false,
    medicalProfessional: data.medical_professional ?? false,
    newToCanada: data.new_to_canada ?? false,
    purchasePlusImprovements: data.purchase_plus_improvements ?? false,
    collateralTransfer: data.collateral_transfer ?? false,
    cashback: data.cashback ?? false,
    bridgeLoanNeeded: data.bridge_loan_needed ?? false,
    firstAndHeloc: data.first_and_heloc ?? false,
    heloc: data.heloc ?? false,
    fixedSecond: data.fixed_second ?? false,
    cosignorOccupying: data.cosignor_occupying ?? false,
    cosignorNotOccupying: data.cosignor_not_occupying ?? false,
    guarantor: data.guarantor ?? false,
    reverseMortgage: data.reverse_mortgage ?? false,
    spousalBuyout: data.spousal_buyout ?? false,
    refinancePlusImprovements: data.refinance_plus_improvements ?? false,
    assetsLiquidValue: data.assets_liquid_value === null ? null : Number(data.assets_liquid_value),
    assetsTotalValue: data.assets_total_value === null ? null : Number(data.assets_total_value),
    doorTitlesCount: data.door_titles_count,
    transunionBeingUsed: data.transunion_being_used ?? false,
    marriedOrCommonLaw: data.married_or_common_law ?? false,
    spouseNotOnApplication: data.spouse_not_on_application ?? false,
    noLenderExceptionsRequired: data.no_lender_exceptions_required ?? false,
  }
}

/** Offers on a deal (broker view). Lender identity is intentionally absent — offers carry only the
 *  opaque lender_id; the name is revealed post-acceptance via accepted_lender_for_deal. */
export async function listDealOffers(supabase: DB, dealId: string): Promise<DealOffer[]> {
  const { data, error } = await supabase
    .from("offers")
    .select(
      "id, offer_number, status, mortgage_product, rate, rate_lock_days, commission_bps, commitment_turn_time_days, doc_review_turn_time_days, comments, created_at, lender_fee_pct",
    )
    .eq("deal_id", dealId)
    .order("offer_number", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => ({
    id: o.id,
    offerNumber: o.offer_number,
    status: o.status,
    mortgageProduct: o.mortgage_product,
    rate: Number(o.rate),
    rateLockDays: o.rate_lock_days,
    commissionBps: o.commission_bps,
    commitmentTurnTimeDays: o.commitment_turn_time_days,
    docReviewTurnTimeDays: o.doc_review_turn_time_days,
    comments: o.comments,
    createdAt: o.created_at,
    lenderFeePct: o.lender_fee_pct === null ? null : Number(o.lender_fee_pct),
  }))
}

/**
 * Accept an offer — Round 3 ONE-step model (supersedes OQ#21): the RPC atomically accepts,
 * auto-declines the others, reveals identities (deal → confirmed), creates the platform-fee
 * invoice, and notifies the lender. There is no separate Confirm Lender step anymore.
 */
export async function acceptOffer(supabase: DB, offerId: string) {
  const { data, error } = await supabase.rpc("accept_offer", { p_offer_id: offerId })
  if (error) throw new Error(error.message)
  return data
}

/** Undo an acceptance and switch (max 2 per calendar month, enforced server-side). */
export async function switchOffer(supabase: DB, dealId: string) {
  const { error } = await supabase.rpc("switch_offer", { p_deal_id: dealId })
  if (error) throw new Error(error.message)
}

export type AcceptedLender = {
  lenderId: string
  firstName: string
  lastName: string
  institution: string | null
}

/** The accepted lender's identity — returns null until an offer is accepted (broker only). */
export async function getAcceptedLender(supabase: DB, dealId: string): Promise<AcceptedLender | null> {
  const { data, error } = await supabase.rpc("accepted_lender_for_deal", { p_deal_id: dealId })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    lenderId: row.lender_id,
    firstName: row.first_name,
    lastName: row.last_name,
    institution: row.institution,
  }
}

// ── Lender: submitted offers ───────────────────────────────────────────────────

/** A row on the lender's Submitted Offers page (their offer + the deal it's on). */
export type SubmittedOfferItem = {
  id: string
  dealId: string
  dealNumber: string
  province: string
  city: string
  propertyType: string
  loanAmount: number
  ltv: number
  propertyValue: number
  purpose: string
  insuranceType: string
  closingDate: string
  offeredRate: number
  rateType: "Fixed" | "Variable" | "Hybrid"
  /** Years, or null for an open mortgage — which has no term. */
  term: number | null
  amortization: number
  commissionBps: number
  conditions: string[]
  offerDate: string
  expiryDate: string
  status: "Pending" | "Accepted" | "Declined"
  // Raw offer fields, kept for the Round 3 "Edit Offer" prefill (pending offers only).
  mortgageProduct: Enums["mortgage_product"]
  rateLockDays: number
  commitmentDays: number | null
  docReviewDays: number | null
  lenderFeePct: number | null
  comments: string | null
  /** Round 3: sent by the lender's standing auto-offer at deal submit, not typed by hand (migration 47). */
  isAuto: boolean
}

// Round 3: the lender portal shows a switched-away offer as plain "Declined" (the broker's switch
// is silent on the lender side — no notification, no distinct status).
const OFFER_STATUS_LABEL: Record<Enums["offer_status"], SubmittedOfferItem["status"]> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  switched: "Declined",
}

function dwellingToPropertyType(d: Enums["dwelling_type"] | null): string {
  switch (d) {
    case "condo_apartment": // retired, still possible on historical deals
    case "apartment_low_rise":
    case "apartment_high_rise":
      return "Condo"
    case "townhouse":
    case "condo_townhouse":
      return "Townhouse"
    case "duplex":
    case "duplex_detached":
    case "duplex_semi_detached":
    case "triplex":
    case "fourplex":
      return "Multi-Family"
    case null:
    case undefined:
      return "Residential"
    default:
      return "Residential"
  }
}

/**
 * The current lender's own offers, each joined to its deal. RLS: offers_lender_own (own offers) +
 * deals_lender_offered (deal readable because they offered). The deals embed needs the FK hint
 * because deals↔offers has two relationships (offers.deal_id and deals.accepted_offer_id).
 */
export async function listSubmittedOffers(supabase: DB): Promise<SubmittedOfferItem[]> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in.")

  const { data, error } = await supabase
    .from("offers")
    .select(
      "id, deal_id, status, rate, rate_lock_days, commission_bps, commitment_turn_time_days, doc_review_turn_time_days, lender_fee_pct, mortgage_product, comments, created_at, is_auto, deals!offers_deal_id_fkey(deal_number, province, city, dwelling_type, loan_amount, ltv, property_value, purpose, insured, closing_date, amortization_years)",
    )
    .eq("lender_id", user.id)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((o) => {
    const d = Array.isArray(o.deals) ? o.deals[0] : o.deals
    const created = new Date(o.created_at)
    const expiry = new Date(created)
    expiry.setDate(expiry.getDate() + o.rate_lock_days)
    return {
      id: o.id,
      dealId: o.deal_id,
      dealNumber: d?.deal_number ?? "—",
      province: d?.province ? PROVINCE_CODE[d.province as Enums["province"]] : "",
      city: d?.city ?? "",
      propertyType: dwellingToPropertyType(d?.dwelling_type ?? null),
      loanAmount: Number(d?.loan_amount ?? 0),
      ltv: d?.ltv === null || d?.ltv === undefined ? 0 : Number(d.ltv),
      propertyValue: Number(d?.property_value ?? 0),
      purpose: d?.purpose === "refinance" ? "Refinance" : d?.purpose === "renewal" ? "Renewal" : "Purchase",
      insuranceType: d?.insured ? "Insured" : "Conventional",
      closingDate: d?.closing_date ?? "",
      offeredRate: Number(o.rate),
      rateType: o.mortgage_product.includes("arm_vrm") ? "Variable" : "Fixed",
      term: productTermYears(o.mortgage_product),
      amortization: d?.amortization_years === null || d?.amortization_years === undefined ? 0 : Number(d.amortization_years),
      commissionBps: o.commission_bps,
      conditions: o.comments ? [o.comments] : [],
      offerDate: o.created_at.slice(0, 10),
      expiryDate: expiry.toISOString().slice(0, 10),
      status: OFFER_STATUS_LABEL[o.status],
      mortgageProduct: o.mortgage_product,
      rateLockDays: o.rate_lock_days,
      commitmentDays: o.commitment_turn_time_days,
      docReviewDays: o.doc_review_turn_time_days,
      lenderFeePct: o.lender_fee_pct === null ? null : Number(o.lender_fee_pct),
      comments: o.comments,
      isAuto: o.is_auto ?? false,
    }
  })
}

/** Withdraw a pending offer (hard-deletes it — RLS offers_lender_withdraw allows delete when pending). */
export async function withdrawOffer(supabase: DB, offerId: string) {
  const { error } = await supabase.from("offers").delete().eq("id", offerId)
  if (error) throw new Error(error.message)
}

/**
 * Lender declines (hides) a deal — RPC decline_deal: inserts into deal_declines (lender_can_see_deal
 * excludes declined deals, so it drops out of the New / Maturing / Expired feeds) and deletes any
 * chat thread the lender had on that deal. Idempotent: a repeat decline is a no-op.
 */
export async function declineDeal(supabase: DB, dealId: string) {
  const { error } = await supabase.rpc("decline_deal", { p_deal_id: dealId })
  if (error) throw new Error(error.message)
}

/** Whether the current lender already has an offer (any status) on this deal. */
export async function hasLenderOfferedOnDeal(supabase: DB, dealId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data, error } = await supabase
    .from("offers")
    .select("id")
    .eq("deal_id", dealId)
    .eq("lender_id", user.id)
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

// ── Lender: invoices ───────────────────────────────────────────────────────────

/** A row on the lender's Invoices page. `id` is the uuid (for actions); invoiceNumber is displayed. */
export type LenderInvoiceItem = {
  id: string
  invoiceNumber: string
  dealRef: string
  propertyCity: string
  propertyProvince: string
  dealType: "Purchase" | "Refinance" | "Renewal"
  term: string
  loanAmount: number
  closingDate: string
  bps: number
  amount: number
  issueDate: string
  dueDate: string
  status: "Pending" | "Paid" | "Cancelled"
  paidDate?: string
  cancelledDate?: string
  /** Round 3 Phase 3: name as printed on the ID when it is a preferred-name variance (else null). */
  documentName?: string | null
}

const INVOICE_STATUS_LABEL: Record<Enums["invoice_status"], LenderInvoiceItem["status"]> = {
  pending: "Pending",
  paid: "Paid",
  cancelled: "Cancelled",
}

/** Invoices visible to the current lender (RLS: invoices_lender), with the deal's city/province/purpose. */
export async function listLenderInvoices(supabase: DB): Promise<LenderInvoiceItem[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, loan_amount, term_years, mortgage_product, platform_bps, amount, closing_date, due_date, status, paid_at, cancelled_at, created_at, document_name, deals(deal_number, city, province, purpose)",
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((i) => {
    const d = Array.isArray(i.deals) ? i.deals[0] : i.deals
    return {
      id: i.id,
      invoiceNumber: i.invoice_number,
      dealRef: d?.deal_number ?? "—",
      propertyCity: d?.city ?? "",
      propertyProvince: d?.province ? PROVINCE_CODE[d.province as Enums["province"]] : "",
      dealType: d?.purpose === "refinance" ? "Refinance" : d?.purpose === "renewal" ? "Renewal" : "Purchase",
      term: productTermLabel(i.mortgage_product),
      loanAmount: Number(i.loan_amount),
      closingDate: i.closing_date,
      bps: i.platform_bps,
      amount: Number(i.amount), // authoritative platform fee from the invoice RPC (don't recompute)
      issueDate: i.created_at.slice(0, 10),
      dueDate: i.due_date,
      status: INVOICE_STATUS_LABEL[i.status],
      paidDate: i.paid_at ? i.paid_at.slice(0, 10) : undefined,
      cancelledDate: i.cancelled_at ? i.cancelled_at.slice(0, 10) : undefined,
      documentName: i.document_name ?? null,
    }
  })
}

/** Mark a pending invoice paid (RPC mark_invoice_paid). */
export async function markInvoicePaid(supabase: DB, invoiceId: string) {
  const { error } = await supabase.rpc("mark_invoice_paid", { p_invoice_id: invoiceId })
  if (error) throw new Error(error.message)
}

/** Cancel a pending invoice (RPC cancel_invoice). */
export async function cancelInvoice(supabase: DB, invoiceId: string, reason: string) {
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: invoiceId, p_reason: reason })
  if (error) throw new Error(error.message)
}

/** Recalculate a pending invoice's term/closing/loan (RPC update_invoice). */
export async function updateInvoice(
  supabase: DB,
  invoiceId: string,
  changes: { product?: Enums["mortgage_product"]; closingDate?: string; loanAmount?: number },
) {
  const { error } = await supabase.rpc("update_invoice", {
    p_invoice_id: invoiceId,
    p_product: changes.product ?? undefined,
    p_closing: changes.closingDate ?? undefined,
    p_loan_amount: changes.loanAmount ?? undefined,
  })
  if (error) throw new Error(error.message)
}

/**
 * Generate (or regenerate) the invoice PDF via the `invoice-pdf` edge function and return a
 * short-lived signed download URL. The function re-checks access with RLS, so a lender can only
 * produce their own invoice's PDF. Requires the edge function to be served (locally: `supabase
 * start` serves supabase/functions/; hosted: `supabase functions deploy invoice-pdf`).
 */
export async function downloadInvoicePdf(supabase: DB, invoiceId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("invoice-pdf", { body: { invoiceId } })
  if (error) throw new Error(error.message)
  const signedPath = (data as { signedPath?: string } | null)?.signedPath
  if (!signedPath) throw new Error("The PDF service did not return a download link.")
  // The function returns a host-relative signed path; prepend the public Supabase URL (the runtime's
  // own SUPABASE_URL is the internal docker host and isn't reachable from the browser).
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")
  return `${base}${signedPath}`
}

/**
 * Client 2026-07-25 (B-32): "In bubble, you had a switch counter per calendar month. Can you please
 * add that back instead of the blurb above?" The data already exists — `profiles` tracks the count and
 * the month, and a monthly cron resets it — so this only surfaces it. `switch_month` is checked here
 * because the lazy reset happens inside switch_offer(): a stale month means the stored count belongs to
 * a previous month and should read as 0.
 */
export const MAX_SWITCHES_PER_MONTH = 2

export async function getSwitchCounter(supabase: DB): Promise<{ used: number; max: number }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { used: 0, max: MAX_SWITCHES_PER_MONTH }
  const { data } = await supabase
    .from("profiles")
    .select("offer_switches_this_month, switch_month")
    .eq("id", user.id)
    .maybeSingle()
  const thisMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
  const stale = !data?.switch_month || !data.switch_month.startsWith(thisMonth)
  return { used: stale ? 0 : data?.offer_switches_this_month ?? 0, max: MAX_SWITCHES_PER_MONTH }
}
