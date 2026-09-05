import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { productTermLabel } from "./deals"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]

// ── Lender approvals ───────────────────────────────────────────────────────────

export type LenderApproval = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  institution: string | null
  isApproved: boolean
  pendingApproval: boolean
  rejected: boolean
  rejectionReason: string | null
  createdAt: string
  status: "Pending" | "Approved" | "Rejected"
}

/** All lenders (admin-only via profiles RLS is_admin()); pending first, then newest. */
export async function listLenders(supabase: DB): Promise<LenderApproval[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, is_approved, pending_approval, rejected, rejection_reason, created_at, lender_institutions!profiles_lender_institution_id_fkey(name)",
    )
    .eq("role", "lender")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => {
    const inst = Array.isArray(p.lender_institutions) ? p.lender_institutions[0] : p.lender_institutions
    const status: LenderApproval["status"] = p.rejected
      ? "Rejected"
      : p.is_approved
        ? "Approved"
        : "Pending"
    return {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone,
      institution: inst?.name ?? null,
      isApproved: p.is_approved,
      pendingApproval: p.pending_approval,
      rejected: p.rejected,
      rejectionReason: p.rejection_reason,
      createdAt: p.created_at,
      status,
    }
  })
}

/** Approve a lender via the admin-gated RPC (updates the profile + notifies the lender atomically). */
export async function approveLender(supabase: DB, id: string) {
  const { error } = await supabase.rpc("approve_lender", { p_lender_id: id })
  if (error) throw new Error(error.message)
}

/** Reject a lender via the admin-gated RPC (update + `lender_rejected` notification). */
export async function rejectLender(supabase: DB, id: string, reason: string) {
  const { error } = await supabase.rpc("reject_lender", { p_lender_id: id, p_reason: reason })
  if (error) throw new Error(error.message)
}

// ── Lender rating penalties (OQ#25) ─────────────────────────────────────────────

export type LenderRating = {
  lenderId: string
  firstName: string
  lastName: string
  institution: string | null
  penaltyActive: boolean
  avgSatisfaction: number | null // over last 5 completed surveys; null if none rated
  surveyCount: number
}

/**
 * Every lender with their penalty flag + recent avg satisfaction (last 5 completed surveys — the
 * same window the weekly penalty job uses). Admin-only (admin_lender_ratings() gates on is_admin()).
 */
export async function listLenderRatings(supabase: DB): Promise<LenderRating[]> {
  const { data, error } = await supabase.rpc("admin_lender_ratings")
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    lenderId: r.lender_id,
    firstName: r.first_name,
    lastName: r.last_name,
    institution: r.institution,
    penaltyActive: r.penalty_active,
    avgSatisfaction: r.avg_satisfaction === null ? null : Number(r.avg_satisfaction),
    surveyCount: r.survey_count,
  }))
}

/**
 * Apply or lift a lender's rating penalty. A direct admin UPDATE on profiles.penalty_active —
 * allowed by the profiles_admin_update policy + the privilege guard's is_admin() bypass.
 */
export async function setLenderPenalty(supabase: DB, lenderId: string, active: boolean) {
  const { error } = await supabase.from("profiles").update({ penalty_active: active }).eq("id", lenderId)
  if (error) throw new Error(error.message)
}

// The near-closing / near-COF visibility windows a penalized lender is hidden from (OQ#25).
export type PenaltyThresholds = { nearClosingDays: number; nearCofDays: number }

/** Read the configurable penalty windows (single-row penalty_settings; readable by any authenticated). */
export async function getPenaltyThresholds(supabase: DB): Promise<PenaltyThresholds> {
  const { data, error } = await supabase
    .from("penalty_settings")
    .select("near_closing_days, near_cof_days")
    .eq("id", 1)
    .single()
  if (error) throw new Error(error.message)
  return { nearClosingDays: data.near_closing_days, nearCofDays: data.near_cof_days }
}

/** Update the penalty windows via the admin-gated RPC (validates + stamps updated_by/at atomically). */
export async function setPenaltyThresholds(
  supabase: DB,
  nearClosingDays: number,
  nearCofDays: number,
): Promise<PenaltyThresholds> {
  const { data, error } = await supabase.rpc("set_penalty_thresholds", {
    p_near_closing_days: nearClosingDays,
    p_near_cof_days: nearCofDays,
  })
  if (error) throw new Error(error.message)
  const r = data as { near_closing_days: number; near_cof_days: number }
  return { nearClosingDays: r.near_closing_days, nearCofDays: r.near_cof_days }
}

// ── Broker admins (client feedback 2026-07-20 #8) ──────────────────────────────
// listBrokers()/BrokerRow (a plain profiles+brokerages read) were superseded by
// listBrokerDirectory()/BrokerDirectoryRow below (Round 4, 2026-09-04), which adds email/suspension/
// violation state via admin_broker_directory(). setBrokerAdmin() is unchanged — same direct UPDATE.

/**
 * Mark / unmark a broker as an admin for their brokerage. A direct admin UPDATE on
 * profiles.is_broker_admin — allowed by `profiles_admin_update` plus the privilege guard's is_admin()
 * exemption, so no RPC is needed (same shape as setLenderPenalty).
 *
 * NOTE: Bubble auto-granted this to the first broker of a brokerage (OQ#23). That is deliberately NOT
 * restored — the client asked to manage it here explicitly instead (feedback 2026-07-20 #8).
 */
export async function setBrokerAdmin(supabase: DB, brokerId: string, isAdmin: boolean) {
  const { error } = await supabase.from("profiles").update({ is_broker_admin: isAdmin }).eq("id", brokerId)
  if (error) throw new Error(error.message)
}

// ── Organizations: brokerages + lender institutions (client feedback 2026-07-20 #9) ────

/** The two org lookup tables share an identical shape (id, name unique, is_active, created_at). */
export type OrgTable = "brokerages" | "lender_institutions"

export type AdminOrg = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  /**
   * Brokerages only (2026-08-29). null = standard term-based invoice pricing (platform_bps_for);
   * 3/4/5 = an admin-set override, used for every NEW invoice on a deal from this brokerage. Always
   * undefined for lender_institutions, which has no such column.
   */
  invoiceBps?: number | null
}

/**
 * Every organization of one kind, INCLUDING inactive ones (the signup dropdowns use the active-only
 * readers in lib/queries/lookups.ts). Writes below are plain inserts/updates — the `lookup_write` /
 * `inst_write` RLS policies are already `for all … using (is_admin())`, so no RPC is needed.
 *
 * The two tables' column sets diverged once brokerages gained `invoice_bps` — branch by table so each
 * query keeps its own precise generated type instead of forcing one shape onto both.
 */
export async function listOrganizations(supabase: DB, table: OrgTable): Promise<AdminOrg[]> {
  if (table === "brokerages") {
    const { data, error } = await supabase.from("brokerages").select("id, name, is_active, created_at, invoice_bps").order("name")
    if (error) throw new Error(error.message)
    return (data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      isActive: o.is_active,
      createdAt: o.created_at,
      invoiceBps: o.invoice_bps,
    }))
  }
  const { data, error } = await supabase.from("lender_institutions").select("id, name, is_active, created_at").order("name")
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    isActive: o.is_active,
    createdAt: o.created_at,
  }))
}

/**
 * Set (or clear, with `null`) a brokerage's invoice fee override. Brokerages only — the column
 * doesn't exist on lender_institutions. Never touches any existing invoice: accept_offer reads this
 * value only at the moment a NEW invoice is created (see migration 76).
 */
export async function setBrokerageInvoiceBps(supabase: DB, brokerageId: string, bps: 3 | 4 | 5 | null) {
  const { error } = await supabase.from("brokerages").update({ invoice_bps: bps }).eq("id", brokerageId)
  if (error) throw new Error(error.message)
}

/** `name` is UNIQUE on both tables — surface the duplicate as a friendly error, not a raw PG one. */
export async function createOrganization(supabase: DB, table: OrgTable, name: string) {
  const { error } = await supabase.from(table).insert({ name: name.trim() })
  if (error) throw new Error(error.code === "23505" ? "DUPLICATE_NAME" : error.message)
}

export async function renameOrganization(supabase: DB, table: OrgTable, id: string, name: string) {
  const { error } = await supabase.from(table).update({ name: name.trim() }).eq("id", id)
  if (error) throw new Error(error.code === "23505" ? "DUPLICATE_NAME" : error.message)
}

/**
 * Deactivate rather than delete: profiles/deals carry FKs into these tables, so a delete would either
 * fail or orphan real records. `is_active = false` already hides the row from the signup dropdowns
 * (the anon read policies from migration 18 filter on is_active).
 */
export async function setOrganizationActive(supabase: DB, table: OrgTable, id: string, active: boolean) {
  const { error } = await supabase.from(table).update({ is_active: active }).eq("id", id)
  if (error) throw new Error(error.message)
}

// ── Admin alerts (flagged content) ─────────────────────────────────────────────

export type AdminAlert = {
  id: string
  flaggedContent: string
  source: Enums["alert_source"]
  detection: Enums["alert_detection"]
  userName: string
  userRole: Enums["user_role"] | null
  isReviewed: boolean
  createdAt: string
}

const SOURCE_LABEL: Record<Enums["alert_source"], string> = {
  chat_message: "Chat Message",
  offer_comments: "Offer Comments",
  deal_credit_notes: "Deal Credit Notes",
  deal_income_notes: "Deal Income Notes",
  deal_down_payment_notes: "Deal Down Payment Notes",
  deal_general_notes: "Deal General Notes",
}

export function alertSourceLabel(s: Enums["alert_source"]): string {
  return SOURCE_LABEL[s]
}

/** Flagged-content alerts (RLS alerts_admin). */
export async function listAdminAlerts(supabase: DB): Promise<AdminAlert[]> {
  const { data, error } = await supabase
    .from("admin_alerts")
    .select("id, flagged_content, source, detection, is_reviewed, created_at, profiles(first_name, last_name, role)")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((a) => {
    const u = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles
    return {
      id: a.id,
      flaggedContent: a.flagged_content,
      source: a.source,
      detection: a.detection,
      userName: u ? `${u.first_name} ${u.last_name}` : "—",
      userRole: u?.role ?? null,
      isReviewed: a.is_reviewed,
      createdAt: a.created_at,
    }
  })
}

export async function markAlertReviewed(supabase: DB, id: string) {
  const { error } = await supabase.from("admin_alerts").update({ is_reviewed: true }).eq("id", id)
  if (error) throw new Error(error.message)
}

// ── Deal overview (admin sees every deal via RLS deals_admin) ───────────────────

export type AdminDealRow = {
  id: string
  dealNumber: string | null
  status: Enums["deal_status"]
  province: Enums["province"] | null
  mortgageProduct: Enums["mortgage_product"] | null
  loanAmount: number | null
  brokerName: string
  brokerageName: string | null
  offerCount: number
  createdAt: string
  submittedAt: string | null
}

/** Every deal, newest first (admin only). Broker/brokerage identity is fine here — admin is not
 *  bound by the anonymity rule. Offer count comes from the embedded aggregate (FK-hinted). */
export async function listAllDeals(supabase: DB): Promise<AdminDealRow[]> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, deal_number, status, province, mortgage_product, loan_amount, created_at, submitted_at, brokerages!deals_brokerage_id_fkey(name), profiles!deals_broker_id_fkey(first_name, last_name), offers!offers_deal_id_fkey(count)",
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => {
    const brokerage = Array.isArray(d.brokerages) ? d.brokerages[0] : d.brokerages
    const broker = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles
    const offers = Array.isArray(d.offers) ? d.offers[0] : d.offers
    return {
      id: d.id,
      dealNumber: d.deal_number,
      status: d.status,
      province: d.province,
      mortgageProduct: d.mortgage_product,
      loanAmount: d.loan_amount,
      brokerName: broker ? `${broker.first_name} ${broker.last_name}`.trim() : "—",
      brokerageName: brokerage?.name ?? null,
      offerCount: (offers as { count: number } | null)?.count ?? 0,
      createdAt: d.created_at,
      submittedAt: d.submitted_at,
    }
  })
}

// ── Analytics (aggregate via admin-gated RPC) ───────────────────────────────────

export type Analytics = {
  deals: { total: number; draft: number; open: number; accepted: number; expired: number; cancelled: number }
  offers_total: number
  invoices: { count: number; billed: number; paid: number; pending: number }
  surveys: { completed: number; avg_satisfaction: number | null }
  by_status: Record<string, number>
  by_province: Record<string, number>
  by_month: { month: string; count: number }[]
}

export async function getAnalytics(supabase: DB): Promise<Analytics> {
  const { data, error } = await supabase.rpc("admin_analytics")
  if (error) throw new Error(error.message)
  return data as unknown as Analytics
}

// ── Platform invoices (admin sees every invoice via invoices_admin) ─────────────

/** One configured tax line — label/rate are admin-set, amount is ALWAYS server-computed. */
export type InvoiceTaxLine = { label: string; rate: number; amount: number }

export type AdminInvoiceRow = {
  id: string
  invoiceNumber: string
  dealNumber: string
  lenderName: string
  lenderInstitution: string | null
  clientName: string
  loanAmount: number
  amount: number // grand total = subtotal - discount + tax total (server-calculated, never client-trusted)
  bps: number
  term: string
  status: Enums["invoice_status"]
  issueDate: string
  dueDate: string
  paidDate: string | null
  cancelledDate: string | null
  cancelledReason: string | null
  /** Set when status is 'voided' — e.g. superseded by a broker Switch Lender (migration 86). */
  voidedDate: string | null
  voidedReason: string | null
  /**
   * Client 2026-07-28 (A-25): set 1 year after payment. Archived invoices are hidden from the default
   * admin list but stay fully readable under the Archived filter, and are deleted at 7 years.
   */
  archivedAt: string | null
  // Admin Invoice Management (2026-09-04)
  subtotal: number
  discountAmount: number
  discountReason: string | null
  taxLines: InvoiceTaxLine[]
  taxTotal: number
  description: string | null
  billingReference: string | null
  notes: string | null
  paymentInstructions: string | null
  revisionNumber: number
}

const INVOICE_ADMIN_SELECT =
  "id, invoice_number, loan_amount, amount, mortgage_product, platform_bps, client_name, due_date, status, paid_at, cancelled_at, cancelled_reason, voided_at, voided_reason, archived_at, created_at, subtotal, discount_amount, discount_reason, tax_lines, tax_total, description, billing_reference, notes, payment_instructions, revision_number, deals(deal_number), profiles(first_name, last_name, lender_institutions!profiles_lender_institution_id_fkey(name))"

type InvoiceAdminRawRow = {
  id: string
  invoice_number: string
  loan_amount: number | string
  amount: number | string
  mortgage_product: Enums["mortgage_product"]
  platform_bps: number
  client_name: string
  due_date: string
  status: Enums["invoice_status"]
  paid_at: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  voided_at: string | null
  voided_reason: string | null
  archived_at: string | null
  created_at: string
  subtotal: number | string
  discount_amount: number | string
  discount_reason: string | null
  tax_lines: unknown
  tax_total: number | string
  description: string | null
  billing_reference: string | null
  notes: string | null
  payment_instructions: string | null
  revision_number: number
  deals: { deal_number: string | null } | { deal_number: string | null }[] | null
  profiles:
    | { first_name: string; last_name: string; lender_institutions: { name: string } | { name: string }[] | null }
    | { first_name: string; last_name: string; lender_institutions: { name: string } | { name: string }[] | null }[]
    | null
}

function mapAdminInvoiceRow(i: InvoiceAdminRawRow): AdminInvoiceRow {
  const deal = Array.isArray(i.deals) ? i.deals[0] : i.deals
  const lender = Array.isArray(i.profiles) ? i.profiles[0] : i.profiles
  const inst = lender
    ? Array.isArray(lender.lender_institutions)
      ? lender.lender_institutions[0]
      : lender.lender_institutions
    : null
  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    dealNumber: deal?.deal_number ?? "—",
    lenderName: lender ? `${lender.first_name} ${lender.last_name}`.trim() : "—",
    lenderInstitution: inst?.name ?? null,
    clientName: i.client_name,
    loanAmount: Number(i.loan_amount),
    amount: Number(i.amount),
    bps: i.platform_bps,
    term: productTermLabel(i.mortgage_product),
    status: i.status,
    issueDate: i.created_at.slice(0, 10),
    dueDate: i.due_date,
    paidDate: i.paid_at ? i.paid_at.slice(0, 10) : null,
    cancelledDate: i.cancelled_at ? i.cancelled_at.slice(0, 10) : null,
    cancelledReason: i.cancelled_reason ?? null,
    voidedDate: i.voided_at ? i.voided_at.slice(0, 10) : null,
    voidedReason: i.voided_reason ?? null,
    archivedAt: i.archived_at,
    subtotal: Number(i.subtotal),
    discountAmount: Number(i.discount_amount),
    discountReason: i.discount_reason ?? null,
    taxLines: (Array.isArray(i.tax_lines) ? i.tax_lines : []) as InvoiceTaxLine[],
    taxTotal: Number(i.tax_total),
    description: i.description ?? null,
    billingReference: i.billing_reference ?? null,
    notes: i.notes ?? null,
    paymentInstructions: i.payment_instructions ?? null,
    revisionNumber: i.revision_number,
  }
}

/**
 * Every platform invoice, newest first (admin only via the invoices_admin for-all policy). Lender
 * and borrower identity are fine here — admin isn't bound by the anonymity rule. `amount` is the
 * server-calculated grand total already stored on the invoice.
 */
export async function listAllInvoices(supabase: DB): Promise<AdminInvoiceRow[]> {
  const { data, error } = await supabase.from("invoices").select(INVOICE_ADMIN_SELECT).order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((i) => mapAdminInvoiceRow(i as unknown as InvoiceAdminRawRow))
}

export type AdminUpdateInvoiceInput = {
  subtotal: number
  discountAmount: number
  discountReason: string | null
  taxLines: { label: string; rate: number }[]
  description: string | null
  billingReference: string | null
  notes: string | null
  paymentInstructions: string | null
  dueDate: string | null
  changeReason: string | null
}

/**
 * Admin edits a PENDING invoice's financial/content fields (admin_update_invoice RPC). The grand total
 * is always recalculated server-side from these inputs — this function never sends a total.
 */
export async function adminUpdateInvoice(
  supabase: DB,
  invoiceId: string,
  input: AdminUpdateInvoiceInput,
): Promise<AdminInvoiceRow> {
  const { data, error } = await supabase.rpc("admin_update_invoice", {
    p_invoice_id: invoiceId,
    p_subtotal: input.subtotal,
    p_discount_amount: input.discountAmount,
    p_discount_reason: input.discountReason ?? undefined,
    p_tax_lines: input.taxLines as unknown as Database["public"]["Tables"]["invoices"]["Row"]["tax_lines"],
    p_description: input.description ?? undefined,
    p_billing_reference: input.billingReference ?? undefined,
    p_notes: input.notes ?? undefined,
    p_payment_instructions: input.paymentInstructions ?? undefined,
    p_due_date: input.dueDate ?? undefined,
    p_change_reason: input.changeReason ?? undefined,
  })
  if (error) throw new Error(error.message)
  return mapAdminInvoiceRow(data as unknown as InvoiceAdminRawRow)
}

/** Admin voids a PENDING invoice (admin_void_invoice RPC) — reuses the existing 'voided' status. */
export async function adminVoidInvoice(supabase: DB, invoiceId: string, reason: string): Promise<AdminInvoiceRow> {
  const { data, error } = await supabase.rpc("admin_void_invoice", { p_invoice_id: invoiceId, p_reason: reason })
  if (error) throw new Error(error.message)
  return mapAdminInvoiceRow(data as unknown as InvoiceAdminRawRow)
}

// ── Invoice revision history (append-only audit trail) ──────────────────────────

export type InvoiceRevision = {
  id: string
  revisionNumber: number
  changedByName: string
  changeReason: string | null
  snapshot: Record<string, unknown>
  createdAt: string
}

/** Every past revision of one invoice, newest first (admin-only via invoice_revisions_admin_read). */
export async function listInvoiceRevisions(supabase: DB, invoiceId: string): Promise<InvoiceRevision[]> {
  const { data, error } = await supabase
    .from("invoice_revisions")
    .select("id, revision_number, change_reason, snapshot, created_at, profiles!invoice_revisions_changed_by_fkey(first_name, last_name)")
    .eq("invoice_id", invoiceId)
    .order("revision_number", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const changer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return {
      id: r.id,
      revisionNumber: r.revision_number,
      changedByName: changer ? `${changer.first_name} ${changer.last_name}`.trim() : "—",
      changeReason: r.change_reason,
      snapshot: (r.snapshot ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    }
  })
}

// ── Global Invoice Settings (defaults for NEW invoices only) ────────────────────

export type InvoiceSettings = {
  headerText: string | null
  defaultDescription: string | null
  footerText: string | null
  defaultPaymentInstructions: string | null
  defaultTaxLines: { label: string; rate: number }[]
  updatedAt: string
}

/** Reads the single global Invoice Settings row (admin-only via invoice_settings_admin_read). */
export async function getInvoiceSettings(supabase: DB): Promise<InvoiceSettings> {
  const { data, error } = await supabase
    .from("invoice_settings")
    .select("header_text, default_description, footer_text, default_payment_instructions, default_tax_lines, updated_at")
    .eq("id", 1)
    .single()
  if (error) throw new Error(error.message)
  return {
    headerText: data.header_text,
    defaultDescription: data.default_description,
    footerText: data.footer_text,
    defaultPaymentInstructions: data.default_payment_instructions,
    defaultTaxLines: (Array.isArray(data.default_tax_lines) ? data.default_tax_lines : []) as { label: string; rate: number }[],
    updatedAt: data.updated_at,
  }
}

/** Updates the global Invoice Settings row (set_invoice_settings RPC, admin-gated + validated). */
export async function setInvoiceSettings(
  supabase: DB,
  input: Omit<InvoiceSettings, "updatedAt">,
): Promise<InvoiceSettings> {
  // NOTE: these 4 params have no SQL-level default (unlike admin_update_invoice's optional fields), so
  // they must be sent as explicit `null` — turning null into `undefined` here would make supabase-js's
  // JSON body omit the key entirely, and PostgREST would then reject the call as missing a required
  // parameter instead of clearing the setting.
  const { data, error } = await supabase.rpc("set_invoice_settings", {
    p_header_text: input.headerText,
    p_default_description: input.defaultDescription,
    p_footer_text: input.footerText,
    p_default_payment_instructions: input.defaultPaymentInstructions,
    p_default_tax_lines: input.defaultTaxLines as unknown as Database["public"]["Tables"]["invoice_settings"]["Row"]["default_tax_lines"],
  })
  if (error) throw new Error(error.message)
  return {
    headerText: data.header_text,
    defaultDescription: data.default_description,
    footerText: data.footer_text,
    defaultPaymentInstructions: data.default_payment_instructions,
    defaultTaxLines: (Array.isArray(data.default_tax_lines) ? data.default_tax_lines : []) as { label: string; rate: number }[],
    updatedAt: data.updated_at,
  }
}

// ── Legal documents (Privacy Policy / Terms) editor ─────────────────────────────

export type LegalDoc = {
  id: string
  type: Enums["legal_doc_type"]
  version: string
  content: string
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

export async function listLegalDocuments(supabase: DB): Promise<LegalDoc[]> {
  const { data, error } = await supabase
    .from("legal_documents")
    .select("id, type, version, content, is_published, created_at, updated_at")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => ({
    id: d.id,
    type: d.type,
    version: d.version,
    content: d.content,
    isPublished: d.is_published,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }))
}

export async function createLegalDocument(
  supabase: DB,
  input: { type: Enums["legal_doc_type"]; version: string; content: string },
) {
  const { error } = await supabase
    .from("legal_documents")
    .insert({ type: input.type, version: input.version, content: input.content, is_published: false })
  if (error) throw new Error(error.message)
}

export async function updateLegalDocument(
  supabase: DB,
  id: string,
  input: { version: string; content: string },
) {
  const { error } = await supabase
    .from("legal_documents")
    .update({ version: input.version, content: input.content })
    .eq("id", id)
  if (error) throw new Error(error.message)
}

/** Publish one document and unpublish the other versions of the same type (one live per type). */
export async function publishLegalDocument(supabase: DB, id: string, type: Enums["legal_doc_type"]) {
  const un = await supabase.from("legal_documents").update({ is_published: false }).eq("type", type).neq("id", id)
  if (un.error) throw new Error(un.error.message)
  const { error } = await supabase.from("legal_documents").update({ is_published: true }).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function unpublishLegalDocument(supabase: DB, id: string) {
  const { error } = await supabase.from("legal_documents").update({ is_published: false }).eq("id", id)
  if (error) throw new Error(error.message)
}

/** Delete a document (UI only offers this for unpublished versions). */
export async function deleteLegalDocument(supabase: DB, id: string) {
  const { error } = await supabase.from("legal_documents").delete().eq("id", id)
  if (error) throw new Error(error.message)
}

// ── Survey report (admin) ───────────────────────────────────────────────────────

export type SurveyReportRow = {
  id: string
  dealNumber: string | null
  lenderInstitution: string | null
  brokerName: string
  lenderName: string
  closedWithLender: boolean | null
  commitmentOnTime: boolean | null
  docReviewOnTime: boolean | null
  fundedOnTime: boolean | null
  satisfaction: number | null
  notClosedReason: string | null
  /** Broker's free-text note (client 2026-07-28, B-3) — admin-only, never surfaced to the lender. */
  comments: string | null
  completedAt: string | null
}

type NameRow = { first_name: string; last_name: string }
const nameOf = (p: NameRow | NameRow[] | null) => {
  const r = Array.isArray(p) ? p[0] : p
  return r ? `${r.first_name} ${r.last_name}`.trim() : "—"
}

/** All completed closing surveys with context (admin only via surveys_admin). Newest first. */
export async function listSurveyReport(supabase: DB): Promise<SurveyReportRow[]> {
  const { data, error } = await supabase
    .from("surveys")
    .select(
      "id, closed_with_lender, commitment_on_time, doc_review_on_time, funded_on_time, satisfaction, not_closed_reason, comments, completed_at, deals(deal_number), lender_institutions!surveys_lender_institution_id_fkey(name), broker:profiles!surveys_broker_id_fkey(first_name, last_name), lender:profiles!surveys_lender_id_fkey(first_name, last_name)",
    )
    .eq("is_completed", true)
    .order("completed_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((s) => {
    const deal = Array.isArray(s.deals) ? s.deals[0] : s.deals
    const inst = Array.isArray(s.lender_institutions) ? s.lender_institutions[0] : s.lender_institutions
    return {
      id: s.id,
      dealNumber: deal?.deal_number ?? null,
      lenderInstitution: inst?.name ?? null,
      brokerName: nameOf(s.broker as NameRow | NameRow[] | null),
      lenderName: nameOf(s.lender as NameRow | NameRow[] | null),
      closedWithLender: s.closed_with_lender,
      commitmentOnTime: s.commitment_on_time,
      docReviewOnTime: s.doc_review_on_time,
      fundedOnTime: s.funded_on_time,
      satisfaction: s.satisfaction,
      notClosedReason: s.not_closed_reason,
      comments: s.comments,
      completedAt: s.completed_at,
    }
  })
}

// ── Deal documents (admin viewer) ──────────────────────────────────────────────

/**
 * Client 2026-07-28 (B-17): *"where can we view them in case we need to?"* → *"We don't want lenders to
 * have access to it - just in the admin portal in case we need to check them, or pull them for a lender
 * regarding their invoice."*
 *
 * Until now the documents were only visible during Create Deal, so nothing showed them after submission.
 * No migration was needed: `deal_documents` RLS already grants owner / brokerage-admin / platform admin
 * and never the lender, and the `deal-documents` bucket policies match. This is the read side only.
 */
export type AdminDealDocumentRow = {
  id: string
  dealId: string
  dealNumber: string | null
  kind: "consent" | "photo_id"
  storagePath: string
  fileName: string | null
  /** Borrower name on the deal, to check the document against. Admin-readable per invariant #1. */
  borrowerName: string | null
  /** AI name-match result — null when the document was never checked (the check is fail-open). */
  extractedName: string | null
  nameMatches: boolean | null
  nameVariance: boolean | null
  uploadedAt: string
}

export async function listAllDealDocuments(supabase: DB): Promise<AdminDealDocumentRow[]> {
  const { data, error } = await supabase
    .from("deal_documents")
    .select(
      "id, deal_id, kind, storage_path, file_name, extracted_name, name_matches, name_variance, created_at, deals(deal_number, deal_identities(borrower_first_name, borrower_last_name))",
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => {
    const deal = Array.isArray(d.deals) ? d.deals[0] : d.deals
    const ident = Array.isArray(deal?.deal_identities) ? deal?.deal_identities[0] : deal?.deal_identities
    const borrower = ident ? `${ident.borrower_first_name ?? ""} ${ident.borrower_last_name ?? ""}`.trim() : ""
    return {
      id: d.id,
      dealId: d.deal_id,
      dealNumber: deal?.deal_number ?? null,
      kind: d.kind as "consent" | "photo_id",
      storagePath: d.storage_path,
      fileName: d.file_name,
      borrowerName: borrower || null,
      extractedName: d.extracted_name,
      nameMatches: d.name_matches,
      nameVariance: d.name_variance,
      uploadedAt: d.created_at,
    }
  })
}

// ── Broker block/unblock monitoring (Round 4, 2026-09-03; grouped view 2026-09-03 follow-up) ────
// Admin-only view of the 5-per-broker lender-institution block cap. One row per broker with any
// block/unblock history (migration 20260903000079's admin_block_activity() — grouped from the full
// broker_block_audit table, not just currently-active blocks, and not a platform-wide capped list);
// per-broker drill-down via admin_broker_block_history(), which reads that one broker's own audit
// rows directly so it is never subject to another broker's activity crowding it out.

export type BlockActivitySummaryRow = {
  brokerId: string
  brokerName: string
  brokerageName: string | null
  /** Current active blocks only — 0 for a broker whose history is entirely past unblocks. */
  blockedCount: number
  blockedInstitutions: string[]
  /** All block + unblock events for this broker in the last 7 days (server-computed, migration 79). */
  changes7d: number
  latestAction: "blocked" | "unblocked"
  latestInstitutionName: string
  latestCreatedAt: string
}

export type BlockActivity = {
  summary: BlockActivitySummaryRow[]
}

export async function getBlockActivity(supabase: DB): Promise<BlockActivity> {
  const { data, error } = await supabase.rpc("admin_block_activity")
  if (error) throw new Error(error.message)
  const raw = (data as unknown as {
    summary: {
      broker_id: string
      broker_name: string
      brokerage_name: string | null
      blocked_count: number
      blocked_institutions: string[]
      changes_7d: number
      latest_action: "blocked" | "unblocked"
      latest_institution_name: string
      latest_created_at: string
    }[]
  }) ?? { summary: [] }
  return {
    summary: raw.summary.map((s) => ({
      brokerId: s.broker_id,
      brokerName: s.broker_name,
      brokerageName: s.brokerage_name,
      blockedCount: s.blocked_count,
      blockedInstitutions: s.blocked_institutions,
      changes7d: s.changes_7d,
      latestAction: s.latest_action,
      latestInstitutionName: s.latest_institution_name,
      latestCreatedAt: s.latest_created_at,
    })),
  }
}

export type BlockHistoryEvent = {
  id: string
  action: "blocked" | "unblocked"
  institutionId: string
  institutionName: string
  createdAt: string
}

/** One broker's full block/unblock history, newest first — the "View Activity" detail drill-down. */
export async function getBrokerBlockHistory(supabase: DB, brokerId: string): Promise<BlockHistoryEvent[]> {
  const { data, error } = await supabase.rpc("admin_broker_block_history", { p_broker_id: brokerId })
  if (error) throw new Error(error.message)
  return (data ?? []).map((e) => ({
    id: e.id,
    action: e.action as "blocked" | "unblocked",
    institutionId: e.institution_id,
    institutionName: e.institution_name,
    createdAt: e.created_at,
  }))
}

// ── Admin user management & broker enforcement (Round 4, 2026-09-04) ────────────
// Manage → Brokers: suspension (manual + automatic 3-strikes contact-info), soft-delete/Auth-ban.
// admin_broker_directory() is the only place in the app that ever reads auth.users columns (email,
// and — added on review — banned_until) — see migration 20260904000080.

export type BrokerDirectoryRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  brokerageName: string | null
  isBrokerAdmin: boolean
  isDeleted: boolean
  /**
   * Supabase Auth's OWN ban state (auth.users.banned_until, set/read for real — never a duplicate DB
   * flag), so the UI can tell "fully deleted" apart from "marked deleted but the Auth ban didn't take"
   * without guessing. Meaningless while isDeleted is false.
   */
  isAuthBanned: boolean
  isSuspended: boolean
  suspensionExpiresAt: string | null
  violations30d: number
  createdAt: string
}

export async function listBrokerDirectory(supabase: DB): Promise<BrokerDirectoryRow[]> {
  const { data, error } = await supabase.rpc("admin_broker_directory")
  if (error) throw new Error(error.message)
  return (data ?? []).map((b) => ({
    id: b.id,
    firstName: b.first_name,
    lastName: b.last_name,
    email: b.email,
    phone: b.phone,
    brokerageName: b.brokerage_name,
    isBrokerAdmin: b.is_broker_admin,
    isDeleted: b.is_deleted,
    isAuthBanned: b.is_auth_banned,
    isSuspended: b.is_suspended,
    suspensionExpiresAt: b.suspension_expires_at,
    violations30d: b.violations_30d,
    createdAt: b.created_at,
  }))
}

export type BrokerSuspensionRecord = {
  id: string
  reason: string
  isAutomatic: boolean
  createdByName: string | null
  startsAt: string
  expiresAt: string
  endedAt: string | null
  endedByName: string | null
  isActive: boolean
}

export type BrokerViolationRecord = {
  id: string
  flaggedContent: string | null
  dealNumber: string | null
  createdAt: string
}

export type BrokerEnforcementDetail = {
  isDeleted: boolean
  isSuspended: boolean
  violations30d: number
  suspensions: BrokerSuspensionRecord[]
  violations: BrokerViolationRecord[]
}

/** Full suspension + violation history for one broker — the Manage → Brokers detail dialog. */
export async function getBrokerEnforcementDetail(supabase: DB, brokerId: string): Promise<BrokerEnforcementDetail> {
  const { data, error } = await supabase.rpc("admin_broker_enforcement_detail", { p_broker_id: brokerId })
  if (error) throw new Error(error.message)
  const raw = data as unknown as {
    is_deleted: boolean
    is_suspended: boolean
    violations_30d: number
    suspensions: {
      id: string; reason: string; is_automatic: boolean; created_by_name: string | null
      starts_at: string; expires_at: string; ended_at: string | null; ended_by_name: string | null
      is_active: boolean
    }[]
    violations: { id: string; flagged_content: string | null; deal_number: string | null; created_at: string }[]
  }
  return {
    isDeleted: raw.is_deleted,
    isSuspended: raw.is_suspended,
    violations30d: raw.violations_30d,
    suspensions: raw.suspensions.map((s) => ({
      id: s.id,
      reason: s.reason,
      isAutomatic: s.is_automatic,
      createdByName: s.created_by_name,
      startsAt: s.starts_at,
      expiresAt: s.expires_at,
      endedAt: s.ended_at,
      endedByName: s.ended_by_name,
      isActive: s.is_active,
    })),
    violations: raw.violations.map((v) => ({
      id: v.id,
      flaggedContent: v.flagged_content,
      dealNumber: v.deal_number,
      createdAt: v.created_at,
    })),
  }
}

/** Manual suspension — preset or custom day count + a required internal reason. */
export async function suspendBroker(supabase: DB, brokerId: string, days: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_suspend_broker", {
    p_broker_id: brokerId,
    p_days: days,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

/** Ends one specific suspension early (manual or automatic) — does not touch any other active row. */
export async function endBrokerSuspension(supabase: DB, suspensionId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_end_suspension", { p_suspension_id: suspensionId })
  if (error) throw new Error(error.message)
}

/**
 * Delete Account = soft-delete + Auth ban, never physical deletion (Round 4 approved design). Routes
 * through the delete-broker edge function since Postgres itself cannot call the Supabase Auth Admin
 * API — see supabase/functions/delete-broker. Idempotent: calling this again for an already-deleted
 * broker safely re-runs admin_soft_delete_broker (a no-op update) and re-issues the Auth ban (GoTrue's
 * updateUserById is safe to call repeatedly with the same ban_duration) — this is the built-in retry
 * path for a broker whose first attempt banned nothing (see the review, 2026-09-04).
 *
 * On a non-2xx response, supabase-js's default error.message is the unhelpful, generic
 * "Edge Function returned a non-2xx status code" — the function's own specific message (validation
 * errors, and critically "Account flagged as deleted, but the Auth ban failed…") lives in the actual
 * response BODY, which FunctionsHttpError exposes via `.context` (the raw, unconsumed Response). Read
 * it here so the admin sees the real reason instead of a useless generic toast.
 */
export async function deleteBrokerAccount(supabase: DB, brokerId: string, reason: string): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-broker", {
    body: { broker_id: brokerId, reason },
  })
  if (!error) return
  let message = error.message
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string } | null
      if (body?.error) message = body.error
    } catch {
      // Response body wasn't JSON (an infra-level failure, not the function's own error path) —
      // fall back to the generic supabase-js message rather than throwing a parse error instead.
    }
  }
  throw new Error(message)
}
