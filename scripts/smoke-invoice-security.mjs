/**
 * Smoke for the 2026-09-04 invoice RPC authentication hardening (migration 84): mark_invoice_paid,
 * cancel_invoice, update_invoice, switch_offer, and accept_offer all shared the same NULL-bypass bug
 * already fixed elsewhere this session (submit_deal, convert_prequal_to_live) — `x <> auth.uid()` is
 * NULL, not TRUE, for an anonymous caller, and PL/pgSQL treats a NULL IF condition as false, so the
 * ownership RAISE never fired. None of the five had ever been revoked from the default PUBLIC/anon
 * EXECUTE grant either. Proves, for each of the 5:
 *   - a genuinely anonymous client (no sign-in at all) is rejected with the SPECIFIC "not authenticated"
 *     message, not just "some error";
 *   - a real, authenticated but WRONG owner is rejected with the existing "not your invoice"/"not your
 *     deal" message — this half was already correct before the fix; re-proven here so a regression is
 *     caught. mark_invoice_paid/cancel_invoice/update_invoice are lender-owned (cross-LENDER rejection);
 *     switch_offer/accept_offer are broker-owned (cross-BROKER rejection) — confirmed by reading each
 *     function's own ownership check rather than assumed;
 *   - the correct owner (and, where a fallback actually exists in the function today, an admin) can
 *     still perform every currently-permitted action — switch_offer and accept_offer have NO is_admin()
 *     fallback at all, confirmed by reading their bodies, so no admin-success case is asserted for them;
 *   - every rejected attempt leaves the target invoice/offer/deal completely unchanged.
 * Also proves next_invoice_number() (the lower-severity hygiene fix — no ownership concept, so no
 * auth.uid() guard, purely a grant/revoke change) is no longer directly callable by an anonymous client,
 * while every accept_offer success above already re-proves its internal call from within accept_offer
 * still works.
 *
 * Self-contained fixtures via direct service-role deal inserts + the real make_offer/accept_offer RPCs
 * (same lightweight pattern scripts/_demo-lib.mjs already uses for seeding), rather than the full
 * create-deal-with-documents-and-submit_deal dance smoke-offers.mjs uses — this smoke is a pure
 * authorization check, not a business-logic check (already covered by smoke-offers.mjs/smoke-switch.mjs).
 *
 * NOTE (2026-09-04, migration 86): switch_offer()'s and accept_offer()'s BODIES changed again after
 * migration 84 (the switch/void invoice-preservation fix — full business-logic coverage is in
 * smoke-switch.mjs, not here). The auth.uid() guard + ownership checks this file asserts are untouched
 * by that migration and are re-proven here against the current (migration-86) bodies; section (4)'s
 * "the correct broker CAN still switch" assertions were updated to match switch_offer's NEW effect
 * (leaves the accepted offer/invoice untouched, only reverts the deal) instead of the OLD one (deleted
 * the invoice, cleared accepted_offer_id) so this file doesn't silently assert stale business logic.
 *   node scripts/seed-users.mjs && node scripts/smoke-invoice-security.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "Test1234!"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
const svc = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}
async function freshUser(email, role, extra) {
  const { data: list } = await svc.auth.admin.listUsers()
  const ex = list?.users.find((u) => u.email === email)
  if (ex) await svc.auth.admin.deleteUser(ex.id)
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, tos_accepted: true, tos_version: "v1", ...extra },
  })
  if (error) throw new Error(`create ${email}: ${error.message}`)
  if (role === "lender") {
    await svc.from("profiles").update({ is_approved: true, pending_approval: false }).eq("id", data.user.id)
  }
  return data.user.id
}
const closingSoon = () => new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lenderB = await clientFor("lender@loanlink.test") // the CORRECT/owning lender throughout
  const admin = await clientFor("admin@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  // Fresh "wrong owner" identities, created here rather than assumed to exist in seed data.
  const { data: instRow } = await svc.from("lender_institutions").select("id").eq("name", "RFA").single()
  const lenderAId = await freshUser("invsec.lenderA@loanlink.test", "lender", {
    first_name: "InvSec", last_name: "LenderA", lender_institution_id: instRow?.id,
  })
  const lenderA = await clientFor("invsec.lenderA@loanlink.test")

  const { data: brokerageRow } = await svc.from("brokerages").select("id").limit(1).single()
  const brokerXId = await freshUser("invsec.brokerX@loanlink.test", "broker", {
    first_name: "InvSec", last_name: "BrokerX", brokerage_id: brokerageRow?.id,
  })
  const brokerX = await clientFor("invsec.brokerX@loanlink.test")

  // Genuinely anonymous — no sign-in call at all, same as anyone holding only the public anon key.
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } })

  // Clean slate — invoices/surveys FK deals with NO ACTION (they'd block the delete), so clear them first.
  const { data: priorDeals } = await svc.from("deals").select("id").like("deal_number", "TEST-INVSEC-%")
  for (const d of priorDeals ?? []) {
    await svc.from("surveys").delete().eq("deal_id", d.id)
    await svc.from("invoices").delete().eq("deal_id", d.id)
  }
  await svc.from("deals").delete().like("deal_number", "TEST-INVSEC-%")

  async function mkDeal(number) {
    const { data: deal, error } = await svc.from("deals").insert({
      broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: number, status: "submitted",
      province: "ontario", loan_amount: 400000, mortgage_product: "5_year_fixed", mortgage_position: "first",
      closing_date: closingSoon(), submitted_at: new Date().toISOString(),
    }).select("id").single()
    if (error) throw new Error(`create deal ${number}: ${error.message}`)
    return deal.id
  }
  async function mkOffer(dealId) {
    const { data: offer, error } = await lenderB.rpc("make_offer", {
      p_deal_id: dealId, p_mortgage_product: "5_year_fixed", p_rate: 4.5,
      p_rate_lock_days: 90, p_commission_bps: 80,
    })
    if (error) throw new Error(`make_offer: ${error.message}`)
    return offer
  }

  // ── (1) mark_invoice_paid — lender-owned, anonymous + cross-lender rejection, correct-lender success ──
  const deal1 = await mkDeal("TEST-INVSEC-1")
  const offer1 = await mkOffer(deal1)
  const { error: acc1Err } = await broker.rpc("accept_offer", { p_offer_id: offer1.id })
  check("(1) fixture: accept_offer creates a real pending invoice", !acc1Err, acc1Err?.message)
  const { data: inv1 } = await svc.from("invoices").select("*").eq("deal_id", deal1).single()
  check("(1) fixture invoice is pending", inv1?.status === "pending", inv1?.status)

  const { error: anon1Err } = await anonClient.rpc("mark_invoice_paid", { p_invoice_id: inv1.id })
  check("(1) anonymous caller rejected from mark_invoice_paid, specifically not-authenticated",
    !!anon1Err?.message?.toLowerCase().includes("not authenticated"), anon1Err?.message)
  const { data: inv1AfterAnon } = await svc.from("invoices").select("status, paid_at").eq("id", inv1.id).single()
  check("(1) invoice unchanged after the anonymous attempt",
    inv1AfterAnon?.status === "pending" && inv1AfterAnon?.paid_at === null, JSON.stringify(inv1AfterAnon))

  const { error: crossA1Err } = await lenderA.rpc("mark_invoice_paid", { p_invoice_id: inv1.id })
  check("(1) cross-lender (Lender A, real session) rejected from Lender B's invoice",
    !!crossA1Err?.message?.toLowerCase().includes("not your invoice"), crossA1Err?.message)
  const { data: inv1AfterCross } = await svc.from("invoices").select("status, paid_at").eq("id", inv1.id).single()
  check("(1) invoice unchanged after the cross-lender attempt",
    inv1AfterCross?.status === "pending" && inv1AfterCross?.paid_at === null, JSON.stringify(inv1AfterCross))

  const { data: paid1, error: correct1Err } = await lenderB.rpc("mark_invoice_paid", { p_invoice_id: inv1.id })
  check("(1) the correct lender (owner) CAN still mark it paid", !correct1Err && paid1?.status === "paid", correct1Err?.message)

  // ── (2) cancel_invoice — same shape, proves the ADMIN fallback this time ──
  const deal2 = await mkDeal("TEST-INVSEC-2")
  const offer2 = await mkOffer(deal2)
  await broker.rpc("accept_offer", { p_offer_id: offer2.id })
  const { data: inv2 } = await svc.from("invoices").select("*").eq("deal_id", deal2).single()
  check("(2) fixture invoice is pending", inv2?.status === "pending", inv2?.status)

  const { error: anon2Err } = await anonClient.rpc("cancel_invoice", { p_invoice_id: inv2.id, p_reason: "x" })
  check("(2) anonymous caller rejected from cancel_invoice, specifically not-authenticated",
    !!anon2Err?.message?.toLowerCase().includes("not authenticated"), anon2Err?.message)
  const { data: inv2AfterAnon } = await svc.from("invoices").select("status, cancelled_at").eq("id", inv2.id).single()
  check("(2) invoice unchanged after the anonymous attempt",
    inv2AfterAnon?.status === "pending" && inv2AfterAnon?.cancelled_at === null, JSON.stringify(inv2AfterAnon))

  const { error: crossA2Err } = await lenderA.rpc("cancel_invoice", { p_invoice_id: inv2.id, p_reason: "x" })
  check("(2) cross-lender rejected from cancel_invoice",
    !!crossA2Err?.message?.toLowerCase().includes("not your invoice"), crossA2Err?.message)
  const { data: inv2AfterCross } = await svc.from("invoices").select("status, cancelled_at").eq("id", inv2.id).single()
  check("(2) invoice unchanged after the cross-lender attempt",
    inv2AfterCross?.status === "pending" && inv2AfterCross?.cancelled_at === null, JSON.stringify(inv2AfterCross))

  const { data: cancelled2, error: admin2Err } = await admin.rpc("cancel_invoice", { p_invoice_id: inv2.id, p_reason: "smoke test" })
  check("(2) an admin CAN still cancel a lender's invoice (the existing is_admin() fallback)",
    !admin2Err && cancelled2?.status === "cancelled", admin2Err?.message)

  // ── (3) update_invoice — same shape; success doesn't consume a terminal status ──
  const deal3 = await mkDeal("TEST-INVSEC-3")
  const offer3 = await mkOffer(deal3)
  await broker.rpc("accept_offer", { p_offer_id: offer3.id })
  const { data: inv3 } = await svc.from("invoices").select("*").eq("deal_id", deal3).single()
  check("(3) fixture invoice is pending", inv3?.status === "pending", inv3?.status)

  const { error: anon3Err } = await anonClient.rpc("update_invoice", { p_invoice_id: inv3.id, p_loan_amount: 999999 })
  check("(3) anonymous caller rejected from update_invoice, specifically not-authenticated",
    !!anon3Err?.message?.toLowerCase().includes("not authenticated"), anon3Err?.message)
  const { data: inv3AfterAnon } = await svc.from("invoices").select("loan_amount, amount").eq("id", inv3.id).single()
  check("(3) invoice unchanged after the anonymous attempt",
    Number(inv3AfterAnon?.loan_amount) === Number(inv3.loan_amount) && Number(inv3AfterAnon?.amount) === Number(inv3.amount),
    JSON.stringify(inv3AfterAnon))

  const { error: crossA3Err } = await lenderA.rpc("update_invoice", { p_invoice_id: inv3.id, p_loan_amount: 888888 })
  check("(3) cross-lender rejected from update_invoice",
    !!crossA3Err?.message?.toLowerCase().includes("not your invoice"), crossA3Err?.message)
  const { data: inv3AfterCross } = await svc.from("invoices").select("loan_amount, amount").eq("id", inv3.id).single()
  check("(3) invoice unchanged after the cross-lender attempt",
    Number(inv3AfterCross?.loan_amount) === Number(inv3.loan_amount) && Number(inv3AfterCross?.amount) === Number(inv3.amount),
    JSON.stringify(inv3AfterCross))

  const { data: updated3, error: correct3Err } = await lenderB.rpc("update_invoice", { p_invoice_id: inv3.id, p_loan_amount: 450000 })
  check("(3) the correct lender CAN still update it", !correct3Err && Number(updated3?.loan_amount) === 450000, correct3Err?.message)

  // ── (4) switch_offer — BROKER-owned (not lender-owned); confirmed no is_admin() fallback exists in
  // this function today, so no admin-success case is asserted here. ──
  const deal4 = await mkDeal("TEST-INVSEC-4")
  const offer4 = await mkOffer(deal4)
  await broker.rpc("accept_offer", { p_offer_id: offer4.id })
  const { data: inv4 } = await svc.from("invoices").select("id, status").eq("deal_id", deal4).single()
  check("(4) fixture invoice is pending (unpaid, switchable)", inv4?.status === "pending", inv4?.status)

  const { error: anon4Err } = await anonClient.rpc("switch_offer", { p_deal_id: deal4 })
  check("(4) anonymous caller rejected from switch_offer, specifically not-authenticated",
    !!anon4Err?.message?.toLowerCase().includes("not authenticated"), anon4Err?.message)
  const { data: deal4AfterAnon } = await svc.from("deals").select("status, accepted_offer_id").eq("id", deal4).single()
  const { data: inv4AfterAnon } = await svc.from("invoices").select("id").eq("deal_id", deal4)
  check("(4) deal/offer/invoice unchanged after the anonymous attempt",
    deal4AfterAnon?.status === "confirmed" && deal4AfterAnon?.accepted_offer_id === offer4.id && (inv4AfterAnon?.length ?? 0) === 1,
    JSON.stringify({ deal4AfterAnon, invCount: inv4AfterAnon?.length }))

  const { error: crossBrokerErr } = await brokerX.rpc("switch_offer", { p_deal_id: deal4 })
  check("(4) a different (non-owning) broker rejected from switch_offer",
    !!crossBrokerErr?.message?.toLowerCase().includes("not your deal"), crossBrokerErr?.message)
  const { data: deal4AfterCross } = await svc.from("deals").select("status, accepted_offer_id").eq("id", deal4).single()
  check("(4) deal unchanged after the cross-broker attempt",
    deal4AfterCross?.status === "confirmed" && deal4AfterCross?.accepted_offer_id === offer4.id, JSON.stringify(deal4AfterCross))

  const { error: correct4Err } = await broker.rpc("switch_offer", { p_deal_id: deal4 })
  check("(4) the correct (owning) broker CAN still switch", !correct4Err, correct4Err?.message)
  // Migration 86 (2026-09-04) changed switch_offer's BUSINESS effect: initiating a switch no longer
  // deletes the invoice or clears accepted_offer_id — the accepted offer/invoice are left untouched
  // until a replacement is actually accepted (see smoke-switch.mjs for the full new-behavior coverage).
  // This smoke only re-proves the ownership/auth guards from migration 84 still hold with that new body.
  const { data: deal4AfterSwitch } = await svc.from("deals").select("status, accepted_offer_id").eq("id", deal4).single()
  check("(4) switch reverts the deal to 'offer_received' but LEAVES accepted_offer_id pointing at the accepted offer (migration 86)",
    deal4AfterSwitch?.status === "offer_received" && deal4AfterSwitch?.accepted_offer_id === offer4.id,
    JSON.stringify(deal4AfterSwitch))
  const { data: offer4AfterSwitch } = await svc.from("offers").select("status").eq("id", offer4.id).single()
  check("(4) switch does NOT touch the accepted offer's status (migration 86)", offer4AfterSwitch?.status === "accepted", offer4AfterSwitch?.status)
  const { data: inv4AfterSwitch } = await svc.from("invoices").select("id, status").eq("deal_id", deal4)
  check("(4) switch does NOT delete or void the invoice (migration 86 — preserved until a replacement is accepted)",
    (inv4AfterSwitch?.length ?? 0) === 1 && inv4AfterSwitch[0].status === "pending", JSON.stringify(inv4AfterSwitch))

  // ── (5) accept_offer — BROKER-owned; confirmed no is_admin() fallback exists here either. This is the
  // function that CREATES the invoice and reveals identities, so it's the highest-severity of the 5. ──
  const deal5 = await mkDeal("TEST-INVSEC-5")
  const offer5 = await mkOffer(deal5)
  check("(5) fixture offer is pending", offer5?.status === "pending", offer5?.status)

  const { error: anon5Err } = await anonClient.rpc("accept_offer", { p_offer_id: offer5.id })
  check("(5) anonymous caller rejected from accept_offer, specifically not-authenticated",
    !!anon5Err?.message?.toLowerCase().includes("not authenticated"), anon5Err?.message)
  const { data: offer5AfterAnon } = await svc.from("offers").select("status").eq("id", offer5.id).single()
  const { data: deal5AfterAnon } = await svc.from("deals").select("status, accepted_offer_id").eq("id", deal5).single()
  const { data: inv5AfterAnon } = await svc.from("invoices").select("id").eq("deal_id", deal5)
  check("(5) offer/deal/invoice unchanged after the anonymous attempt — no invoice was ever created",
    offer5AfterAnon?.status === "pending" && deal5AfterAnon?.status === "submitted" &&
      deal5AfterAnon?.accepted_offer_id === null && (inv5AfterAnon?.length ?? 0) === 0,
    JSON.stringify({ offer5AfterAnon, deal5AfterAnon, invCount: inv5AfterAnon?.length }))

  const { error: crossBroker5Err } = await brokerX.rpc("accept_offer", { p_offer_id: offer5.id })
  check("(5) a different (non-owning) broker rejected from accept_offer",
    !!crossBroker5Err?.message?.toLowerCase().includes("not your deal"), crossBroker5Err?.message)
  const { data: offer5AfterCross } = await svc.from("offers").select("status").eq("id", offer5.id).single()
  check("(5) offer unchanged after the cross-broker attempt", offer5AfterCross?.status === "pending", offer5AfterCross?.status)

  const { data: accepted5, error: correct5Err } = await broker.rpc("accept_offer", { p_offer_id: offer5.id })
  check("(5) the correct (owning) broker CAN still accept", !correct5Err && accepted5?.status === "accepted", correct5Err?.message)
  const { data: inv5 } = await svc.from("invoices").select("id, status").eq("deal_id", deal5).single()
  check("(5) accept_offer created the invoice as normal", inv5?.status === "pending", JSON.stringify(inv5))

  // ── next_invoice_number(): hardening-only, no ownership concept. Every accept_offer success above
  // already re-proves its internal call from within accept_offer still works; this proves it's no
  // longer directly callable by an anonymous client. ──
  const { error: anonSeqErr } = await anonClient.rpc("next_invoice_number")
  check("anonymous caller cannot call next_invoice_number directly", !!anonSeqErr, anonSeqErr?.message)

  // ── Cleanup ──
  const { data: cleanupDeals } = await svc.from("deals").select("id").like("deal_number", "TEST-INVSEC-%")
  for (const d of cleanupDeals ?? []) {
    await svc.from("surveys").delete().eq("deal_id", d.id)
    await svc.from("invoices").delete().eq("deal_id", d.id)
  }
  await svc.from("deals").delete().like("deal_number", "TEST-INVSEC-%")
  await svc.auth.admin.deleteUser(lenderAId)
  await svc.auth.admin.deleteUser(brokerXId)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
