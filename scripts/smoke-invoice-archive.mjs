/**
 * Smoke for the paid-invoice retention rules (client 2026-07-28, A-25; migration 60).
 *
 *   archive at 1 year after payment  →  delete at 7 years after payment
 *
 * Exercises the archive job and the purge SELECTOR against invoices back-dated across every boundary,
 * and asserts invoices_to_purge() is not callable with a user token (Security invariant #6). The actual
 * deletion lives in the purge-invoices edge function, so this checks what it would be handed rather than
 * invoking Storage.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-invoice-archive.mjs
 */
import { service, signIn, idByEmail, attachDealDocuments } from "./_demo-lib.mjs"

const svc = service()
let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
const created = []

async function main() {
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")

  // One real deal + offer + invoice, then clones of the invoice back-dated to each boundary. Cloning the
  // invoice rather than building five deals keeps the fixture small; only paid_at drives the rules.
  const { data: d, error: de } = await broker.from("deals").insert({
    broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
    loan_amount: 500000, property_value: 625000, ltv: 80, mortgage_product: "5_year_fixed",
    province: "ontario", transaction_type: "prime", city: "Barrie",
    closing_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  }).select("id").single()
  if (de) throw new Error(`deal: ${de.message}`)
  created.push(d.id)
  await broker.from("deal_identities").insert({
    deal_id: d.id, borrower_first_name: "Arch", borrower_last_name: "Ival", property_address: "9 Retention Rd",
  })
  await attachDealDocuments(broker, d.id)
  const { error: se } = await broker.rpc("submit_deal", { p_deal_id: d.id })
  if (se) throw new Error(`submit: ${se.message}`)

  const { data: offer, error: oe } = await lender.rpc("make_offer", {
    p_deal_id: d.id, p_mortgage_product: "5_year_fixed", p_rate: 4.99,
    p_rate_lock_days: 90, p_commission_bps: 40,
    p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2,
  })
  if (oe) throw new Error(`make_offer: ${oe.message}`)
  const { error: ae } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
  if (ae) throw new Error(`accept_offer: ${ae.message}`)

  const { data: base } = await svc.from("invoices").select("*").eq("deal_id", d.id).single()
  check("acceptance generated an invoice", !!base, base?.invoice_number)

  /** Clone the generated invoice with a given status / paid_at, so each case is independent. */
  const mkInvoice = async (suffix, status, paidAt) => {
    const row = { ...base }
    delete row.id
    row.invoice_number = `${base.invoice_number}-${suffix}`
    row.status = status
    row.paid_at = paidAt
    row.archived_at = null
    row.pdf_path = null // nothing in Storage for these clones; the purge tolerates a null path
    const { data, error } = await svc.from("invoices").insert(row).select("id, invoice_number").single()
    if (error) throw new Error(`clone ${suffix}: ${error.message}`)
    return data
  }

  const recent   = await mkInvoice("RECENT", "paid", daysAgo(30))       // paid last month
  const old11m   = await mkInvoice("11M",    "paid", daysAgo(330))      // just under a year
  const old13m   = await mkInvoice("13M",    "paid", daysAgo(400))      // just over a year
  const old8y    = await mkInvoice("8Y",     "paid", daysAgo(365 * 8))  // past the 7-year retention
  const pending  = await mkInvoice("PEND",   "pending", null)           // never paid
  const cancelled = await mkInvoice("CANC",  "cancelled", null)

  const archivedOf = async (id) =>
    (await svc.from("invoices").select("archived_at").eq("id", id).single()).data?.archived_at

  // ── The archive job ─────────────────────────────────────────────────────────
  const { data: n, error: je } = await svc.rpc("job_archive_paid_invoices")
  check("job_archive_paid_invoices runs", !je, je?.message ?? `${n} archived`)

  check("paid 13 months ago → archived", !!(await archivedOf(old13m.id)))
  check("paid 8 years ago → archived", !!(await archivedOf(old8y.id)))
  check("paid 11 months ago → NOT archived (inside the 1-year window)", !(await archivedOf(old11m.id)))
  check("paid 30 days ago → NOT archived", !(await archivedOf(recent.id)))
  check("a PENDING invoice is never archived", !(await archivedOf(pending.id)))
  check("a CANCELLED invoice is never archived", !(await archivedOf(cancelled.id)))

  // Idempotent: a second run must not re-stamp what it already archived.
  const stampBefore = await archivedOf(old13m.id)
  const { data: n2 } = await svc.rpc("job_archive_paid_invoices")
  check("re-running archives nothing new", n2 === 0, `${n2} archived on the second pass`)
  check("an already-archived invoice keeps its original timestamp", (await archivedOf(old13m.id)) === stampBefore)

  // ── The purge selector ──────────────────────────────────────────────────────
  const { data: toPurge, error: pe } = await svc.rpc("invoices_to_purge")
  check("invoices_to_purge runs for the service role", !pe, pe?.message)
  const purgeIds = (toPurge ?? []).map((r) => r.id)
  check("the 8-year-old invoice is up for deletion", purgeIds.includes(old8y.id))
  check("the 13-month-old invoice is NOT up for deletion (archived, not expired)", !purgeIds.includes(old13m.id))
  check("a never-archived invoice is NOT up for deletion", !purgeIds.includes(recent.id))

  // Security invariant #6: Postgres grants EXECUTE to PUBLIC by default, so the revoke has to name
  // `public` — otherwise any signed-in user could enumerate the platform's whole billing history.
  const { error: lenderErr } = await lender.rpc("invoices_to_purge")
  check("a lender cannot call invoices_to_purge", !!lenderErr, lenderErr?.message ?? "IT RETURNED DATA — leak")
  const { error: brokerErr } = await broker.rpc("invoices_to_purge")
  check("a broker cannot call invoices_to_purge", !!brokerErr, brokerErr?.message ?? "IT RETURNED DATA — leak")

  // ── The archived flag is a filter, not a disappearance ──────────────────────
  const { data: adminSees } = await (await signIn("admin@loanlink.test"))
    .from("invoices").select("id, archived_at").eq("id", old13m.id).maybeSingle()
  check("an admin can still read an archived invoice", !!adminSees, adminSees ? "readable" : "no row")

  // Lenders never saw paid invoices anyway (client revision A-24/B-28 limited their list to
  // Pending + Overdue), so archiving changes nothing for them — but the row must stay theirs to read.
  const { data: lenderSees } = await lender.from("invoices").select("id").eq("id", old13m.id).maybeSingle()
  check("the invoice's own lender can still read it", !!lenderSees)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  return failures === 0 ? 0 : 1
}

main()
  .then(async (code) => {
    // Clean up: invoice clones first (they reference the deal), then the deal's children.
    await svc.from("invoices").delete().in("deal_id", created)
    await svc.from("surveys").delete().in("deal_id", created)
    await svc.from("offers").delete().in("deal_id", created)
    await svc.from("deal_documents").delete().in("deal_id", created)
    await svc.from("deal_identities").delete().in("deal_id", created)
    await svc.from("deals").delete().in("id", created)
    process.exit(code)
  })
  .catch(async (e) => {
    console.error(e)
    await svc.from("invoices").delete().in("deal_id", created)
    await svc.from("deals").delete().in("id", created)
    process.exit(1)
  })
