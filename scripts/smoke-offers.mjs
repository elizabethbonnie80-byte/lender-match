/**
 * End-to-end smoke for the offer loop: make_offer -> accept_offer (Round 3 ONE-step: accept =
 * reveal + invoice + lender notification, no Confirm Lender) -> invoice, plus the identity reveals
 * in both directions and the edit_offer RPC. Real broker + lender sessions against local Supabase.
 *   node scripts/seed-users.mjs && node scripts/smoke-offers.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const PASSWORD = "Test1234!"

// NOTE: this smoke intentionally LEAVES its confirmed deal + invoice behind — smoke-surveys and
// smoke-invoice-pdf consume it (documented chain). smoke-invoice-pdf, the terminal consumer, deletes
// it, so a full suite run is net-zero. Re-runs never collide: seed-maturing keeps the deal-number
// counter at/above the highest existing number, so submit_deal always issues a fresh number.

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  // Platform bps by term (pure platform_bps_for): ≤3y → 3, =4y → 4, else → 5.
  // OPEN is 3, not 5: it has no product_years so it used to fall through to the else branch (Bubble
  // parity, recorded as OQ#30 "pending"). The client settled it on 2026-07-25 (B-22) — an open term is
  // billed at the ≤3-year rate. Migration 55. This assertion is the guard against it silently
  // reverting, since the value feeds real invoice amounts.
  // The 3-bps branch is also proven end-to-end below (real accept_offer → invoice.platform_bps).
  for (const [product, expected] of [
    ["3_year_fixed", 3], ["2_year_fixed", 3], ["6_month_convertible", 3], ["open", 3],
    ["4_year_fixed", 4],
    ["5_year_fixed", 5], ["7_year_fixed", 5], ["10_year_fixed", 5],
  ]) {
    const { data: b } = await lender.rpc("platform_bps_for", { p: product })
    check(`platform_bps(${product}) = ${expected}`, b === expected, String(b))
  }

  // Broker creates + submits a deal
  const { data: deal } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft",
    loan_amount: 500000, mortgage_product: "5_year_fixed", province: "alberta", closing_date: "2026-09-01",
  }).select("id").single()
  await broker.from("deal_identities").insert({
    deal_id: deal.id, borrower_first_name: "John", borrower_last_name: "Borrower", property_address: "123 Secret St",
  })
  // Round 3 Phase 3: submit_deal requires both a consent form + photo ID uploaded first.
  await broker.from("deal_documents").insert([
    { deal_id: deal.id, kind: "consent", storage_path: `${deal.id}/consent.pdf`, file_name: "consent.pdf" },
    { deal_id: deal.id, kind: "photo_id", storage_path: `${deal.id}/photo_id.pdf`, file_name: "photo_id.pdf" },
  ])
  const { data: submitted } = await broker.rpc("submit_deal", { p_deal_id: deal.id })
  check("deal submitted", submitted?.status === "submitted", submitted?.deal_number)

  // Lender makes an offer (3_year_fixed -> 3 bps)
  const { data: offer, error: offerErr } = await lender.rpc("make_offer", {
    p_deal_id: deal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.29,
    p_rate_lock_days: 120, p_commission_bps: 85, p_comments: "Solid file.",
  })
  check("lender make_offer succeeds", !offerErr && offer?.id, offerErr?.message)
  check("offer_number assigned = 1", offer?.offer_number === 1)

  // Deal flipped to offer_received; broker was notified
  const { data: dealAfter } = await broker.from("deals").select("status").eq("id", deal.id).single()
  check("deal now offer_received", dealAfter?.status === "offer_received")
  const { data: notifs } = await broker.from("notifications").select("type, body").eq("deal_id", deal.id)
  const newOffer = notifs?.find((n) => n.type === "new_offer")
  check("broker got new_offer notification", !!newOffer)
  check("notification does NOT leak lender name/institution",
    !!newOffer && !/Lena|Lender|Merix/i.test(newOffer.body), newOffer?.body)

  // Broker sees the offer but NOT the lender identity in the row
  const { data: offersSeen } = await broker.from("offers")
    .select("id, offer_number, rate, commission_bps, lender_id").eq("deal_id", deal.id)
  check("broker sees the offer", offersSeen?.length === 1 && Number(offersSeen[0].rate) === 4.29)

  // Broker cannot read the lender's profile (identity hidden pre-reveal is moot — profiles is self-only)
  const { data: lenderProfilePeek } = await broker.from("profiles").select("first_name").eq("id", lenderUser.id)
  check("broker cannot read lender profile row", (lenderProfilePeek?.length ?? 0) === 0)

  // Round 3: the lender can EDIT a pending offer (edit_offer); the broker is notified, no identity leak.
  const { data: edited, error: editErr } = await lender.rpc("edit_offer", {
    p_offer_id: offer.id, p_mortgage_product: "3_year_fixed", p_rate: 4.19,
    p_rate_lock_days: 90, p_commission_bps: 85, p_comments: "Solid file, sharpened rate.",
  })
  check("edit_offer succeeds on a pending offer", !editErr && Number(edited?.rate) === 4.19, editErr?.message)
  const { data: editNotifs } = await broker.from("notifications").select("type, body").eq("offer_id", offer.id)
  const editNote = editNotifs?.find((n) => /updated/i.test(n.body ?? ""))
  check("broker notified of the offer edit (no lender name)",
    !!editNote && !/Lena|Merix/i.test(editNote.body), editNote?.body)
  // Another lender cannot edit it
  const lender2 = await clientFor("lender2@loanlink.test").catch(() => null)
  if (lender2) {
    const { error: foreignEditErr } = await lender2.rpc("edit_offer", {
      p_offer_id: offer.id, p_mortgage_product: "3_year_fixed", p_rate: 1,
      p_rate_lock_days: 1, p_commission_bps: 1,
    })
    check("edit_offer rejected for another lender", !!foreignEditErr, foreignEditErr?.message)
  }

  // Broker accepts — Round 3 ONE-step: accept + auto-decline + reveal + invoice + lender notification.
  const { data: accepted, error: accErr } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
  check("accept_offer succeeds", !accErr && accepted?.status === "accepted", accErr?.message)

  // Deal jumped straight to confirmed (no separate Confirm Lender step)
  const { data: dealConfirmed } = await broker.from("deals")
    .select("status, lender_confirmed, accepted_offer_id").eq("id", deal.id).single()
  check("deal confirmed in ONE step", dealConfirmed?.status === "confirmed" && dealConfirmed?.lender_confirmed === true)

  // confirm_lender no longer exists
  const { error: confGoneErr } = await broker.rpc("confirm_lender", { p_deal_id: deal.id })
  check("confirm_lender RPC removed", !!confGoneErr, confGoneErr?.message?.slice(0, 60))

  // Lender now sees borrower identity (deal_identities revealed on acceptance)
  const { data: identReveal } = await lender.from("deal_identities")
    .select("borrower_first_name").eq("deal_id", deal.id)
  check("lender sees borrower identity AFTER acceptance", identReveal?.[0]?.borrower_first_name === "John")

  // Invoice was generated by the acceptance itself; the lender reads it (RLS invoices_lender)
  const { data: lenderInvoices } = await lender.from("invoices")
    .select("invoice_number, amount, platform_bps, client_name, due_date").eq("deal_id", deal.id)
  const invoice = lenderInvoices?.[0]
  check("invoice generated on acceptance", lenderInvoices?.length === 1, `${lenderInvoices?.length ?? 0} rows`)
  check("invoice number format INV-ddMMyyyy-n", /^INV-\d{8}-\d+$/.test(invoice?.invoice_number ?? ""), invoice?.invoice_number)
  check("invoice bps = 3 (3-year product)", invoice?.platform_bps === 3, String(invoice?.platform_bps))
  check("invoice amount = loan × bps/10000 = 150", Number(invoice?.amount) === 150, String(invoice?.amount))
  check("invoice client_name = BORROWER (not lender)", invoice?.client_name === "John Borrower", invoice?.client_name)
  check("invoice due = closing + 21d", invoice?.due_date === "2026-09-22", invoice?.due_date)

  // Lender was notified of acceptance + invoice in one notification
  const { data: lenderNotifs } = await lender.from("notifications").select("type, body").eq("deal_id", deal.id)
  const acceptNote = lenderNotifs?.find((n) => n.type === "offer_accepted")
  check("lender notified: acceptance + invoice", !!acceptNote && /invoice/i.test(acceptNote.body), acceptNote?.body)

  // Accepted offers are frozen — edit_offer must refuse now
  const { error: frozenEditErr } = await lender.rpc("edit_offer", {
    p_offer_id: offer.id, p_mortgage_product: "3_year_fixed", p_rate: 9,
    p_rate_lock_days: 9, p_commission_bps: 9,
  })
  check("edit_offer rejected once accepted", !!frozenEditErr, frozenEditErr?.message)

  // Invoice visibility (invariant #3): the invoice is for the lender + admin only — even the deal's
  // own broker cannot read the invoices row (RLS: invoices_lender = lender_id, plus admin).
  const { data: brokerInvoicePeek } = await broker.from("invoices").select("id").eq("deal_id", deal.id)
  check("invoice row NOT visible to the broker (lender + admin only)", (brokerInvoicePeek?.length ?? 0) === 0,
    `${brokerInvoicePeek?.length ?? 0} rows`)

  // Broker can now reveal the lender identity
  const { data: revealed } = await broker.rpc("accepted_lender_for_deal", { p_deal_id: deal.id })
  const lenderRow = Array.isArray(revealed) ? revealed[0] : revealed
  check("broker reveal shows lender name + institution",
    lenderRow?.first_name === "Lena" && lenderRow?.institution === "Merix",
    JSON.stringify(lenderRow))

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
