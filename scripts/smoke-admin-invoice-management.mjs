/**
 * Smoke for Admin Invoice Management (migration 87, approved 2026-09-04): admin_update_invoice,
 * admin_void_invoice, set_invoice_settings, the revision-logging now shared by every invoice-mutating
 * RPC (admin edit/void, lender update_invoice/cancel_invoice/mark_invoice_paid, and the automatic
 * switch-supersession void — that last one is covered in smoke-switch.mjs), and Invoice Settings
 * defaults flowing into a newly-created invoice.
 *
 * Covers: total recalculation (subtotal - discount + tax) · a client-supplied total/tax-amount cannot
 * override the server's own computation · revision snapshot written BEFORE the edit + revision_number
 * increments · pdf_path cleared on every mutation · admin void (reusing the existing 'voided' status) ·
 * a paid OR voided invoice cannot be mutated by the lender's normal RPCs · the lender's own
 * update_invoice still works and is now revision-audited · anonymous/non-admin callers are rejected
 * from the two new admin RPCs exactly like the migration-84 functions · Invoice Settings defaults
 * (tax template + description + payment instructions) apply to a brand-new invoice · a "legacy-shaped"
 * row (new columns relying on their DB defaults, exactly what the migration-87 backfill produced for
 * every pre-existing invoice) stays fully readable and satisfies every CHECK constraint.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-admin-invoice-management.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, dateDaysAgo, upsertSubmittedDeal } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

const DEALNUM = "DEAL-2026-902"
const DEALNUM2 = "DEAL-2026-903"
const DEALNUM3 = "DEAL-2026-904"
const DEALNUM4 = "DEAL-2026-905"

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  const adminId = await idByEmail(svc, "admin@loanlink.test")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")
  const admin = await signIn("admin@loanlink.test")
  const anonClient = (await import("@supabase/supabase-js")).createClient(
    process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
    process.env.SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    { auth: { persistSession: false } },
  )

  const invoiceById = async (id) => (await svc.from("invoices").select("*").eq("id", id).single()).data
  const revisionsFor = async (id) =>
    (await svc.from("invoice_revisions").select("*").eq("invoice_id", id).order("revision_number")).data ?? []

  const dealIds = []
  try {
    // ── Fixture A: a plain accepted deal for the edit/revision tests ────────────────────────────
    const dealA = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM, brokerId, brokerageId: bp.brokerage_id, createdAt: dateDaysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "Toronto", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 500000,
        property_value: 625000, amortization_years: 25, primary_credit_score: 720, closing_date: dateDaysAgo(-60) },
      client: { first: "Admin", last: "InvoiceTest", address: "1 Test Rd, Toronto, ON" },
    })
    dealIds.push(dealA)
    const { data: offerA } = await lender.rpc("make_offer", {
      p_deal_id: dealA, p_mortgage_product: "5_year_fixed", p_rate: 5.09, p_rate_lock_days: 120,
      p_commission_bps: 40, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    await broker.rpc("accept_offer", { p_offer_id: offerA.id })
    const { data: invARow } = await svc.from("invoices").select("id").eq("deal_id", dealA).single()
    const invAId = invARow.id
    const invA0 = await invoiceById(invAId)

    check("fixture: new invoice starts at revision 1", invA0.revision_number === 1, invA0.revision_number)
    check("fixture: new invoice has subtotal = amount, discount 0, tax 0 (no Invoice Settings configured)",
      Number(invA0.subtotal) === Number(invA0.amount) && Number(invA0.discount_amount) === 0 && Number(invA0.tax_total) === 0,
      JSON.stringify({ subtotal: invA0.subtotal, amount: invA0.amount, discount: invA0.discount_amount, tax: invA0.tax_total }))

    // ── (A) Total recalculation: subtotal - discount + tax ──────────────────────────────────────
    // Stamp a dummy pdf_path first so clearing it is a meaningful assertion, not a no-op.
    await svc.from("invoices").update({ pdf_path: "dummy.pdf" }).eq("id", invAId)

    const { data: edited1, error: edit1Err } = await admin.rpc("admin_update_invoice", {
      p_invoice_id: invAId, p_subtotal: 1000, p_discount_amount: 100,
      p_discount_reason: "Loyalty discount", p_tax_lines: [{ label: "GST", rate: 5 }],
      p_description: "Custom description", p_change_reason: "Smoke test edit",
    })
    check("(A) admin_update_invoice succeeds", !edit1Err, edit1Err?.message)
    const expectedTax = Math.round((1000 - 100) * 5) / 100 // 45.00
    const expectedTotal = Math.round((1000 - 100 + expectedTax) * 100) / 100 // 945.00
    check("(A) tax line amount is server-computed", Number(edited1?.tax_lines?.[0]?.amount) === expectedTax,
      JSON.stringify(edited1?.tax_lines))
    check("(A) grand total = subtotal - discount + tax", Number(edited1?.amount) === expectedTotal,
      `got ${edited1?.amount}, expected ${expectedTotal}`)
    check("(A) pdf_path cleared by the edit", edited1?.pdf_path === null, edited1?.pdf_path)

    // ── (B) A client-supplied total/tax-amount cannot override the server's computation ──────────
    // admin_update_invoice has NO parameter for the grand total at all — proven by attempting to pass
    // one; Postgres rejects the call outright because no matching function signature exists.
    const { error: bogusTotalErr } = await admin.rpc("admin_update_invoice", {
      p_invoice_id: invAId, p_subtotal: 1000, p_discount_amount: 0, p_tax_lines: [],
      p_amount: 1, // not a real parameter — proves there is no way to inject a total
    })
    check("(B) a client-supplied grand total is rejected outright (no such parameter exists)", !!bogusTotalErr, bogusTotalErr?.message)

    // A client-supplied "amount" INSIDE a tax line is silently ignored — the server always recomputes it.
    const { data: edited2, error: edit2Err } = await admin.rpc("admin_update_invoice", {
      p_invoice_id: invAId, p_subtotal: 1000, p_discount_amount: 0,
      p_tax_lines: [{ label: "HST", rate: 13, amount: 999999 }], // forged "amount" — must be ignored
    })
    check("(B) admin_update_invoice succeeds despite the forged per-line amount", !edit2Err, edit2Err?.message)
    check("(B) the forged tax-line amount is IGNORED — server recomputed it from rate × taxable base",
      Number(edited2?.tax_lines?.[0]?.amount) === 130, JSON.stringify(edited2?.tax_lines))
    check("(B) grand total reflects the REAL computed tax, not the forged one",
      Number(edited2?.amount) === 1130, edited2?.amount)

    // ── (C) Revision snapshot written BEFORE the edit; revision_number increments ────────────────
    const revsAfterTwoEdits = await revisionsFor(invAId)
    check("(C) two edits so far produced exactly two revision rows", revsAfterTwoEdits.length === 2, revsAfterTwoEdits.length)
    const rev1 = revsAfterTwoEdits.find((r) => r.revision_number === 1)
    check("(C) revision 1's snapshot is the ORIGINAL pre-edit invoice (subtotal unchanged from creation)",
      Number(rev1?.snapshot?.subtotal) === Number(invA0.subtotal), JSON.stringify(rev1?.snapshot?.subtotal))
    check("(C) revision 1 records who changed it and why", rev1?.changed_by === adminId && rev1?.change_reason === "Smoke test edit",
      JSON.stringify({ changed_by: rev1?.changed_by, reason: rev1?.change_reason }))
    check("(C) current invoice is now at revision 3 (1 created + 2 edits)",
      (await invoiceById(invAId)).revision_number === 3, (await invoiceById(invAId)).revision_number)

    // ── (D) Admin void works (fresh fixture, so the earlier edits don't interfere) ───────────────
    const dealB = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM2, brokerId, brokerageId: bp.brokerage_id, createdAt: dateDaysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "Ottawa", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 300000,
        property_value: 375000, amortization_years: 25, primary_credit_score: 700, closing_date: dateDaysAgo(-60) },
      client: { first: "Void", last: "Test", address: "2 Test Rd, Ottawa, ON" },
    })
    dealIds.push(dealB)
    const { data: offerB } = await lender.rpc("make_offer", {
      p_deal_id: dealB, p_mortgage_product: "5_year_fixed", p_rate: 5.09, p_rate_lock_days: 120,
      p_commission_bps: 40, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    await broker.rpc("accept_offer", { p_offer_id: offerB.id })
    const { data: invBRow } = await svc.from("invoices").select("id").eq("deal_id", dealB).single()
    const invBId = invBRow.id
    await svc.from("invoices").update({ pdf_path: "dummy.pdf" }).eq("id", invBId)

    const { error: voidNoReasonErr } = await admin.rpc("admin_void_invoice", { p_invoice_id: invBId, p_reason: "" })
    check("(D) void without a reason is rejected", !!voidNoReasonErr && /reason/i.test(voidNoReasonErr.message), voidNoReasonErr?.message)

    const { data: voided, error: voidErr } = await admin.rpc("admin_void_invoice", { p_invoice_id: invBId, p_reason: "Duplicate invoice" })
    check("(D) admin_void_invoice succeeds with a reason", !voidErr, voidErr?.message)
    check("(D) status → 'voided' (the SAME status migration 85/86 added, no new status)", voided?.status === "voided", voided?.status)
    check("(D) voided_at/voided_by/voided_reason set", !!voided?.voided_at && voided?.voided_by === adminId && voided?.voided_reason === "Duplicate invoice",
      JSON.stringify({ voided_at: voided?.voided_at, voided_by: voided?.voided_by, voided_reason: voided?.voided_reason }))
    check("(D) pdf_path cleared by the void", voided?.pdf_path === null, voided?.pdf_path)
    check("(D) revision_number incremented (2: created + voided)", voided?.revision_number === 2, voided?.revision_number)
    const bRevs = await revisionsFor(invBId)
    check("(D) a revision snapshot exists for the pre-void state", bRevs.length === 1 && bRevs[0].snapshot.status === "pending",
      JSON.stringify(bRevs[0]?.snapshot?.status))

    // ── (E) A voided (or paid) invoice cannot be mutated by the lender's normal RPCs ─────────────
    const { error: mpVoidErr } = await lender.rpc("mark_invoice_paid", { p_invoice_id: invBId })
    check("(E) mark_invoice_paid on a voided invoice is rejected", !!mpVoidErr?.message?.toLowerCase().includes("invoice is not pending"), mpVoidErr?.message)
    const { error: ciVoidErr } = await lender.rpc("cancel_invoice", { p_invoice_id: invBId, p_reason: "x" })
    check("(E) cancel_invoice on a voided invoice is rejected", !!ciVoidErr?.message?.toLowerCase().includes("invoice is not pending"), ciVoidErr?.message)
    const { error: uiVoidErr } = await lender.rpc("update_invoice", { p_invoice_id: invBId, p_loan_amount: 1 })
    check("(E) update_invoice on a voided invoice is rejected", !!uiVoidErr?.message?.toLowerCase().includes("invoice is not pending"), uiVoidErr?.message)
    const { error: adminEditVoidErr } = await admin.rpc("admin_update_invoice", { p_invoice_id: invBId, p_subtotal: 1, p_discount_amount: 0, p_tax_lines: [] })
    check("(E) admin_update_invoice on a voided invoice is rejected", !!adminEditVoidErr, adminEditVoidErr?.message)
    const { error: adminVoidVoidErr } = await admin.rpc("admin_void_invoice", { p_invoice_id: invBId, p_reason: "again" })
    check("(E) admin_void_invoice on an already-voided invoice is rejected", !!adminVoidVoidErr, adminVoidVoidErr?.message)

    // Now a PAID invoice, same set of refusals.
    const { data: paid } = await lender.rpc("mark_invoice_paid", { p_invoice_id: invAId })
    check("(E) fixture: invoice A is now paid", paid?.status === "paid", paid?.status)
    const { error: ciPaidErr } = await lender.rpc("cancel_invoice", { p_invoice_id: invAId, p_reason: "x" })
    check("(E) cancel_invoice on a paid invoice is rejected", !!ciPaidErr?.message?.toLowerCase().includes("invoice is not pending"), ciPaidErr?.message)
    const { error: adminEditPaidErr } = await admin.rpc("admin_update_invoice", { p_invoice_id: invAId, p_subtotal: 1, p_discount_amount: 0, p_tax_lines: [] })
    check("(E) admin_update_invoice on a paid invoice is rejected", !!adminEditPaidErr, adminEditPaidErr?.message)
    const { error: adminVoidPaidErr } = await admin.rpc("admin_void_invoice", { p_invoice_id: invAId, p_reason: "x" })
    check("(E) admin_void_invoice on a paid invoice is rejected", !!adminVoidPaidErr, adminVoidPaidErr?.message)

    // ── (F) The lender's own update_invoice still works and is revision-audited ──────────────────
    const dealC = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM3, brokerId, brokerageId: bp.brokerage_id, createdAt: dateDaysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "London", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 400000,
        property_value: 500000, amortization_years: 25, primary_credit_score: 710, closing_date: dateDaysAgo(-60) },
      client: { first: "SelfService", last: "Test", address: "3 Test Rd, London, ON" },
    })
    dealIds.push(dealC)
    const { data: offerC } = await lender.rpc("make_offer", {
      p_deal_id: dealC, p_mortgage_product: "5_year_fixed", p_rate: 5.09, p_rate_lock_days: 120,
      p_commission_bps: 40, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    await broker.rpc("accept_offer", { p_offer_id: offerC.id })
    const { data: invCRow } = await svc.from("invoices").select("id").eq("deal_id", dealC).single()
    const invCId = invCRow.id

    const { data: selfEdited, error: selfEditErr } = await lender.rpc("update_invoice", { p_invoice_id: invCId, p_loan_amount: 450000 })
    check("(F) the lender's own update_invoice still succeeds", !selfEditErr, selfEditErr?.message)
    check("(F) revision_number incremented by the lender's own edit", selfEdited?.revision_number === 2, selfEdited?.revision_number)
    const cRevs = await revisionsFor(invCId)
    check("(F) the lender's edit is revision-audited (not a second, untracked mutation path)",
      cRevs.length === 1 && cRevs[0].changed_by === lenderId, JSON.stringify({ count: cRevs.length, changed_by: cRevs[0]?.changed_by }))

    // ── (G) Cross-role / anonymous rejection for the two NEW admin RPCs ──────────────────────────
    const { error: anonEditErr } = await anonClient.rpc("admin_update_invoice", { p_invoice_id: invCId, p_subtotal: 1, p_discount_amount: 0, p_tax_lines: [] })
    check("(G) anonymous caller rejected from admin_update_invoice, specifically not-authenticated",
      !!anonEditErr?.message?.toLowerCase().includes("not authenticated"), anonEditErr?.message)
    const { error: lenderEditErr } = await lender.rpc("admin_update_invoice", { p_invoice_id: invCId, p_subtotal: 1, p_discount_amount: 0, p_tax_lines: [] })
    check("(G) a real authenticated but non-admin lender rejected from admin_update_invoice",
      !!lenderEditErr?.message?.toLowerCase().includes("admin only"), lenderEditErr?.message)
    const { error: anonVoidErr } = await anonClient.rpc("admin_void_invoice", { p_invoice_id: invCId, p_reason: "x" })
    check("(G) anonymous caller rejected from admin_void_invoice, specifically not-authenticated",
      !!anonVoidErr?.message?.toLowerCase().includes("not authenticated"), anonVoidErr?.message)
    const { error: lenderVoidErr } = await lender.rpc("admin_void_invoice", { p_invoice_id: invCId, p_reason: "x" })
    check("(G) a real authenticated but non-admin lender rejected from admin_void_invoice",
      !!lenderVoidErr?.message?.toLowerCase().includes("admin only"), lenderVoidErr?.message)
    const invCAfterRejections = await invoiceById(invCId)
    check("(G) invoice C completely unchanged by every rejected attempt",
      invCAfterRejections.revision_number === 2 && invCAfterRejections.status === "pending",
      JSON.stringify({ rev: invCAfterRejections.revision_number, status: invCAfterRejections.status }))

    // ── (H) Invoice Settings defaults apply to a NEW invoice ─────────────────────────────────────
    const { error: settingsErr } = await admin.rpc("set_invoice_settings", {
      p_header_text: null, p_default_description: "Smoke Test Default Description",
      p_footer_text: null, p_default_payment_instructions: "Pay via e-Transfer",
      p_default_tax_lines: [{ label: "HST", rate: 13 }],
    })
    check("(H) set_invoice_settings succeeds", !settingsErr, settingsErr?.message)

    const dealD = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM4, brokerId, brokerageId: bp.brokerage_id, createdAt: dateDaysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "Hamilton", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 200000,
        property_value: 250000, amortization_years: 25, primary_credit_score: 700, closing_date: dateDaysAgo(-60) },
      client: { first: "Settings", last: "Test", address: "4 Test Rd, Hamilton, ON" },
    })
    dealIds.push(dealD)
    const { data: offerD } = await lender2.rpc("make_offer", {
      p_deal_id: dealD, p_mortgage_product: "5_year_fixed", p_rate: 5.09, p_rate_lock_days: 120,
      p_commission_bps: 40, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    await broker.rpc("accept_offer", { p_offer_id: offerD.id })
    const { data: invDRow } = await svc.from("invoices").select("*").eq("deal_id", dealD).single()
    const expectedSubtotalD = Math.round(((200000 * invDRow.platform_bps) / 10000) * 100) / 100 // round(loan_amount * bps / 10000, 2)
    const expectedTaxD = Math.round(expectedSubtotalD * 13) / 100
    check("(H) new invoice picked up the default description", invDRow.description === "Smoke Test Default Description", invDRow.description)
    check("(H) new invoice picked up the default payment instructions", invDRow.payment_instructions === "Pay via e-Transfer", invDRow.payment_instructions)
    check("(H) new invoice applied the default HST tax line", invDRow.tax_lines?.[0]?.label === "HST" && Number(invDRow.tax_lines[0].rate) === 13,
      JSON.stringify(invDRow.tax_lines))
    check("(H) tax amount computed from the default rate against the new subtotal",
      Number(invDRow.tax_total) === expectedTaxD, `got ${invDRow.tax_total}, expected ${expectedTaxD}`)
    check("(H) grand total = subtotal + default tax (discount is always 0 on creation)",
      Number(invDRow.amount) === Math.round((expectedSubtotalD + expectedTaxD) * 100) / 100, invDRow.amount)
    check("(H) discount is 0 and revision_number is 1 on a fresh invoice",
      Number(invDRow.discount_amount) === 0 && invDRow.revision_number === 1,
      JSON.stringify({ discount: invDRow.discount_amount, rev: invDRow.revision_number }))

    // Reset Invoice Settings back to empty — this is a GLOBAL singleton shared by every other smoke
    // that accepts an offer, so leaving defaults configured here would silently change their invoices.
    const { error: resetErr } = await admin.rpc("set_invoice_settings", {
      p_header_text: null, p_default_description: null, p_footer_text: null,
      p_default_payment_instructions: null, p_default_tax_lines: [],
    })
    check("(H) fixture cleanup: Invoice Settings reset to empty for other smokes", !resetErr, resetErr?.message)

    // ── (I) A "legacy-shaped" row (new columns at their DB defaults) stays fully valid ───────────
    // Mirrors exactly what migration 87's backfill produced for every pre-existing invoice: subtotal
    // supplied (it has no column default), everything else OMITTED and left to its DEFAULT.
    const { data: legacyOffer } = await svc.from("offers").select("id, lender_id").eq("deal_id", dealC).single()
    const { data: legacyInvoice, error: legacyErr } = await svc.from("invoices").insert({
      invoice_number: `INV-LEGACY-${Date.now()}`, deal_id: dealC, offer_id: legacyOffer.id, lender_id: legacyOffer.lender_id,
      loan_amount: 100000, mortgage_product: "5_year_fixed", platform_bps: 4,
      subtotal: 40, amount: 40, // no discount/tax specified anywhere → 40 - 0 + 0 = 40, satisfies the CHECK
      broker_name: "Legacy Broker", client_name: "Legacy Client",
      closing_date: dateDaysAgo(-60), due_date: dateDaysAgo(-39),
    }).select("*").single()
    check("(I) a minimal insert relying on the new columns' defaults succeeds", !legacyErr, legacyErr?.message)
    check("(I) discount_amount/tax_total default to 0, tax_lines to '[]', revision_number to 1",
      legacyInvoice && Number(legacyInvoice.discount_amount) === 0 && Number(legacyInvoice.tax_total) === 0 &&
        Array.isArray(legacyInvoice.tax_lines) && legacyInvoice.tax_lines.length === 0 && legacyInvoice.revision_number === 1,
      JSON.stringify(legacyInvoice))
    check("(I) description/billing_reference/notes/payment_instructions default to null (UI/PDF fall back gracefully)",
      legacyInvoice?.description === null && legacyInvoice?.billing_reference === null &&
        legacyInvoice?.notes === null && legacyInvoice?.payment_instructions === null,
      JSON.stringify({ d: legacyInvoice?.description, b: legacyInvoice?.billing_reference, n: legacyInvoice?.notes, p: legacyInvoice?.payment_instructions }))
    await svc.from("invoices").delete().eq("id", legacyInvoice.id) // not tied to a deal we're cleaning up below
  } finally {
    for (const dealId of dealIds) {
      await svc.from("surveys").delete().eq("deal_id", dealId)
      await svc.from("invoice_revisions").delete().in(
        "invoice_id",
        (await svc.from("invoices").select("id").eq("deal_id", dealId)).data?.map((r) => r.id) ?? [],
      )
      await svc.from("invoices").delete().eq("deal_id", dealId)
    }
    await svc.from("deals").delete().in("deal_number", [DEALNUM, DEALNUM2, DEALNUM3, DEALNUM4])
    // Defensive: make sure Invoice Settings never leaks into the rest of the suite even if (H) failed midway.
    await svc.from("invoice_settings").update({
      header_text: null, default_description: null, footer_text: null,
      default_payment_instructions: null, default_tax_lines: [],
    }).eq("id", 1)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
