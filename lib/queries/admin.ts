import type { SupabaseClient } from "@supabase/supabase-js"
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

export type BrokerRow = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  brokerage: string | null
  isBrokerAdmin: boolean
  createdAt: string
}

/**
 * Every broker with their brokerage + broker-admin flag. Admin-only: the profiles RLS read policy is
 * `id = auth.uid() or is_admin()`. The brokerage embed needs the FK hint (profiles has more than one
 * FK into the org tables → PGRST201 otherwise).
 */
export async function listBrokers(supabase: DB): Promise<BrokerRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, is_broker_admin, created_at, brokerages!profiles_brokerage_id_fkey(name)",
    )
    .eq("role", "broker")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => {
    const b = Array.isArray(p.brokerages) ? p.brokerages[0] : p.brokerages
    return {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone,
      brokerage: b?.name ?? null,
      isBrokerAdmin: p.is_broker_admin,
      createdAt: p.created_at,
    }
  })
}

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
}

/**
 * Every organization of one kind, INCLUDING inactive ones (the signup dropdowns use the active-only
 * readers in lib/queries/lookups.ts). Writes below are plain inserts/updates — the `lookup_write` /
 * `inst_write` RLS policies are already `for all … using (is_admin())`, so no RPC is needed.
 */
export async function listOrganizations(supabase: DB, table: OrgTable): Promise<AdminOrg[]> {
  const { data, error } = await supabase.from(table).select("id, name, is_active, created_at").order("name")
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    isActive: o.is_active,
    createdAt: o.created_at,
  }))
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

export type AdminInvoiceRow = {
  id: string
  invoiceNumber: string
  dealNumber: string
  lenderName: string
  lenderInstitution: string | null
  clientName: string
  loanAmount: number
  amount: number // platform fee = loan_amount × bps/10000
  bps: number
  term: string
  status: Enums["invoice_status"]
  issueDate: string
  dueDate: string
  paidDate: string | null
  cancelledDate: string | null
  /**
   * Client 2026-07-28 (A-25): set 1 year after payment. Archived invoices are hidden from the default
   * admin list but stay fully readable under the Archived filter, and are deleted at 7 years.
   */
  archivedAt: string | null
}

/**
 * Every platform invoice, newest first (admin only via the invoices_admin for-all policy). Lender
 * and borrower identity are fine here — admin isn't bound by the anonymity rule. `amount` is the
 * platform fee already stored on the invoice (loan_amount × platform_bps / 10000).
 */
export async function listAllInvoices(supabase: DB): Promise<AdminInvoiceRow[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, loan_amount, amount, mortgage_product, platform_bps, client_name, due_date, status, paid_at, cancelled_at, archived_at, created_at, deals(deal_number), profiles(first_name, last_name, lender_institutions!profiles_lender_institution_id_fkey(name))",
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((i) => {
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
      archivedAt: i.archived_at,
    }
  })
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
