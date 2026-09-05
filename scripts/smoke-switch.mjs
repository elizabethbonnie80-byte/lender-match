/**
 * Smoke for the offer SWITCH + VOID flow (migration 86, approved 2026-09-04 — see that migration's
 * header for the full business rationale). This REPLACES the pre-migration-86 version of this smoke,
 * which asserted the OLD behavior (switch_offer immediately deleted the invoice and flipped the
 * accepted offer to 'switched' the instant the broker clicked Switch Lender). That behavior is gone:
 *
 *   - Initiating Switch Lender (switch_offer) now touches NOTHING about the currently accepted
 *     lender: their offer stays 'accepted', deals.accepted_offer_id keeps pointing at them, and their
 *     invoice stays exactly as it was (still 'pending' if it hasn't been paid). Only the DEAL reverts
 *     to 'offer_received' (so the broker's UI shows the offers list again) and the offers that were
 *     auto-declined by the original acceptance come back to 'pending' so there's something to choose.
 *   - The actual retirement — Lender A → 'switched', their invoice → 'voided' — now happens ATOMICALLY
 *     inside accept_offer(), and only when the broker actually accepts a REPLACEMENT offer. If they
 *     never do, nothing about Lender A is ever touched.
 *   - The old invoice is preserved (voided, not deleted) for audit/accounting history — migration 85's
 *     voided_at/voided_reason/voided_by columns + 'voided' enum value.
 *
 * Covers, in order: (1) initial acceptance is unchanged · (2) initiating switch preserves the accepted
 * state · (3) the backend fields the broker UI's "Currently Accepted" branch depends on · (5) a forced
 * mid-transaction failure during replacement acceptance leaves NO partial state (real Postgres
 * rollback, not a mocked one) · (4) a real replacement acceptance performs the atomic transition ·
 * (6) the voided invoice can no longer be paid/cancelled/updated · the pre-existing switch-limit
 * (2/month) + monthly-reset regression, restructured for the new rule that switch_offer only works
 * again once a fresh acceptance exists to switch away from.
 *
 * Real broker + two lender sessions against local Supabase; uses a throwaway deal it deletes afterward.
 *   node scripts/seed-users.mjs && node scripts/smoke-switch.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, daysAgo, dateDaysAgo, upsertSubmittedDeal } from "./_demo-lib.mjs"

const DEALNUM = "DEAL-2026-901"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  // Reset the broker's monthly switch counter so this smoke is deterministic regardless of prior
  // switches (the demo seed + other runs may have used the 2-per-month allowance).
  await svc.from("profiles").update({ offer_switches_this_month: 0 }).eq("id", brokerId)

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")

  const offerStatus = async (id) => (await svc.from("offers").select("status").eq("id", id).single()).data?.status
  const dealRow = async (id) => (await svc.from("deals").select("status, accepted_offer_id").eq("id", id).single()).data
  const invoiceById = async (id) => (await svc.from("invoices").select("*").eq("id", id).single()).data
  const invoicesForOffer = async (offerId) => (await svc.from("invoices").select("id, status").eq("offer_id", offerId)).data ?? []

  try {
    const dealId = await upsertSubmittedDeal(svc, {
      dealNumber: DEALNUM, brokerId, brokerageId: bp.brokerage_id, createdAt: daysAgo(2),
      fields: { transaction_type: "prime", province: "ontario", city: "Toronto", mortgage_product: "5_year_fixed",
        purpose: "purchase", occupancy: "owner_occupied", dwelling_type: "detached", ltv: 80, loan_amount: 500000,
        property_value: 625000, amortization_years: 25, primary_credit_score: 720, closing_date: dateDaysAgo(-60) },
      client: { first: "Switch", last: "Test", address: "1 Test Rd, Toronto, ON" },
    })

    const mk = (c, rate, bps) => c.rpc("make_offer", {
      p_deal_id: dealId, p_mortgage_product: "5_year_fixed", p_rate: rate, p_rate_lock_days: 120,
      p_commission_bps: bps, p_commitment_turn_time_days: 3, p_doc_review_turn_time_days: 2, p_comments: null,
    })
    const { data: o1, error: e1 } = await mk(lender, 5.09, 40)
    const { data: o2, error: e2 } = await mk(lender2, 5.14, 45)
    check("both lenders can make an offer", !e1 && !e2 && !!o1 && !!o2, e1?.message ?? e2?.message)

    // ── (1) INITIAL ACCEPTANCE IS UNCHANGED ──────────────────────────────────────────────────────
    const { error: aErr } = await broker.rpc("accept_offer", { p_offer_id: o1.id })
    check("(1) broker accepts Lender A", !aErr, aErr?.message)
    check("(1) Lender A → 'accepted'", (await offerStatus(o1.id)) === "accepted")
    check("(1) the other offer auto-declines", (await offerStatus(o2.id)) === "declined")
    const d1 = await dealRow(dealId)
    check("(1) deal.accepted_offer_id → A", d1?.accepted_offer_id === o1.id, d1?.accepted_offer_id)
    check("(1) deal → 'confirmed' (one-step accept)", d1?.status === "confirmed", d1?.status)
    const { data: invRowsAfterAccept } = await svc.from("invoices").select("id, status").eq("deal_id", dealId)
    check("(1) exactly one invoice exists", (invRowsAfterAccept?.length ?? 0) === 1, String(invRowsAfterAccept?.length))
    const invoiceAId = invRowsAfterAccept[0].id
    check("(1) invoice A is 'pending'", invRowsAfterAccept[0].status === "pending", invRowsAfterAccept[0].status)

    // ── (2) INITIATING SWITCH PRESERVES THE CURRENT ACCEPTED STATE ───────────────────────────────
    const { error: sErr } = await broker.rpc("switch_offer", { p_deal_id: dealId })
    check("(2) broker initiates the switch", !sErr, sErr?.message)
    check("(2) Lender A REMAINS 'accepted' (not touched by initiating a switch)", (await offerStatus(o1.id)) === "accepted")
    const d2 = await dealRow(dealId)
    check("(2) deal.accepted_offer_id STILL points to A", d2?.accepted_offer_id === o1.id, d2?.accepted_offer_id)
    const invA_afterSwitch = await invoiceById(invoiceAId)
    check("(2) invoice A still exists", !!invA_afterSwitch)
    check("(2) invoice A remains 'pending'", invA_afterSwitch?.status === "pending", invA_afterSwitch?.status)
    check("(2) deal.status → 'offer_received'", d2?.status === "offer_received", d2?.status)
    check("(2) the auto-declined replacement offer returns to 'pending'", (await offerStatus(o2.id)) === "pending")

    // ── (3) BROKER UI STATE WHILE SWITCHING ──────────────────────────────────────────────────────
    // No browser/DOM exists in this smoke environment, so the frontend's actual render (a
    // "Currently Accepted" badge with no Accept button on Lender A's card, and a normal, clickable
    // Accept button on Lender B's) is not exercised here — that would need a browser-driven test.
    // What IS asserted, backed by the DB state above, is exactly the two fields
    // app/(broker)/deal-detail/[id]/page.tsx's `isCurrentlyAccepted` / accept-button branches read:
    //   isCurrentlyAccepted = offer.id === deal.acceptedOfferId && offer.status === 'accepted'
    // which is confirmed true for Lender A and confirmed false for Lender B below — i.e. the backend
    // contract the UI depends on to render non-actionable vs. selectable is proven; the DOM/click
    // behavior itself is not.
    check("(3, backend contract) Lender A is 'accepted' AND is deal.accepted_offer_id → UI would render non-actionable",
      (await offerStatus(o1.id)) === "accepted" && (await dealRow(dealId)).accepted_offer_id === o1.id)
    check("(3, backend contract) Lender B is 'pending' and is NOT deal.accepted_offer_id → UI would render it selectable",
      (await offerStatus(o2.id)) === "pending" && (await dealRow(dealId)).accepted_offer_id !== o2.id)

    // ── (5) IF REPLACEMENT ACCEPTANCE FAILS, NO PARTIAL STATE REMAINS ────────────────────────────
    // Force a REAL mid-transaction failure inside accept_offer(): it retires Lender A + voids
    // invoice A, THEN inserts the new invoice as its very last write. Pre-reserving the exact
    // invoice_number that insert will generate (via a decoy row) makes that final INSERT hit the
    // `invoices.invoice_number` unique constraint and raise — which, since a PL/pgSQL function body
    // is one transaction, rolls back everything the function did up to that point, including the
    // Lender A retirement and the invoice A void. This is a genuine Postgres rollback, not a
    // simulated one.
    const m = /^(INV-\d{8}-)(\d+)$/.exec(invA_afterSwitch.invoice_number)
    if (!m) throw new Error(`unexpected invoice_number format: ${invA_afterSwitch.invoice_number}`)
    const predictedNextNumber = `${m[1]}${Number(m[2]) + 1}`
    const { error: decoyErr } = await svc.from("invoices").insert({
      invoice_number: predictedNextNumber, deal_id: dealId, offer_id: o1.id, lender_id: lenderId,
      loan_amount: 1, mortgage_product: "5_year_fixed", platform_bps: 3, amount: 1,
      broker_name: "Decoy", client_name: "Decoy", closing_date: dateDaysAgo(-60), due_date: dateDaysAgo(-39),
    }).select("id").single()
    check("(5) fixture: decoy invoice pre-reserves the next invoice_number", !decoyErr, decoyErr?.message)

    const { error: failErr } = await broker.rpc("accept_offer", { p_offer_id: o2.id })
    check("(5) the forced collision makes accept_offer fail", !!failErr, failErr ? "rejected as expected" : "SUCCEEDED — should have failed")
    check("(5) failure is the expected unique-constraint collision, not something else",
      /duplicate key|unique constraint/i.test(failErr?.message ?? ""), failErr?.message)
    check("(5) Lender A is NOT left half-retired — still 'accepted'", (await offerStatus(o1.id)) === "accepted")
    const invA_afterFailure = await invoiceById(invoiceAId)
    check("(5) invoice A is NOT half-voided — still 'pending'", invA_afterFailure?.status === "pending", invA_afterFailure?.status)
    const d5 = await dealRow(dealId)
    check("(5) deal.accepted_offer_id unchanged (still A)", d5?.accepted_offer_id === o1.id, d5?.accepted_offer_id)
    check("(5) Lender B's offer unchanged — still 'pending', not consumed", (await offerStatus(o2.id)) === "pending")
    check("(5) no stray invoice was left behind for the failed replacement",
      (await invoicesForOffer(o2.id)).length === 0, String((await invoicesForOffer(o2.id)).length))

    await svc.from("invoices").delete().eq("invoice_number", predictedNextNumber) // remove the decoy

    // ── (4) REPLACEMENT ACCEPTANCE IS ATOMIC ─────────────────────────────────────────────────────
    const { error: rErr } = await broker.rpc("accept_offer", { p_offer_id: o2.id })
    check("(4) broker accepts the replacement (Lender B)", !rErr, rErr?.message)
    check("(4) Lender B → 'accepted'", (await offerStatus(o2.id)) === "accepted")
    check("(4) Lender A → 'switched'", (await offerStatus(o1.id)) === "switched")
    const d4 = await dealRow(dealId)
    check("(4) deal.accepted_offer_id → B", d4?.accepted_offer_id === o2.id, d4?.accepted_offer_id)
    const invA_final = await invoiceById(invoiceAId)
    check("(4) invoice A still exists (preserved, not deleted)", !!invA_final)
    check("(4) invoice A → 'voided'", invA_final?.status === "voided", invA_final?.status)
    check("(4) invoice A has voided_at", !!invA_final?.voided_at)
    check("(4) invoice A voided_reason is the expected text",
      invA_final?.voided_reason === "Superseded by lender switch", invA_final?.voided_reason)
    check("(4) invoice A voided_by is the broker", invA_final?.voided_by === brokerId, invA_final?.voided_by)
    const invBRows = await invoicesForOffer(o2.id)
    check("(4) invoice B was created", invBRows.length === 1, String(invBRows.length))
    const invoiceBId = invBRows[0]?.id
    check("(4) invoice B is 'pending'", invBRows[0]?.status === "pending", invBRows[0]?.status)
    check("(4) invoice A and invoice B are different rows", invoiceBId !== invoiceAId)

    // ── (6) VOIDED INVOICE MUTATION PROTECTION ───────────────────────────────────────────────────
    // Same owning-lender session that made offer A — mark_invoice_paid/cancel_invoice/update_invoice
    // all guard on `inv.status <> 'pending'`, and 'voided' is never 'pending', so the guard that
    // already protects a cancelled/paid invoice protects a voided one for free (migration 84 kept
    // this guard byte-for-byte; migration 86 doesn't touch these three functions at all).
    const { error: mpErr } = await lender.rpc("mark_invoice_paid", { p_invoice_id: invoiceAId })
    check("(6) mark_invoice_paid on a voided invoice is rejected, specifically 'invoice is not pending'",
      !!mpErr?.message?.toLowerCase().includes("invoice is not pending"), mpErr?.message)
    const { error: ciErr } = await lender.rpc("cancel_invoice", { p_invoice_id: invoiceAId, p_reason: "x" })
    check("(6) cancel_invoice on a voided invoice is rejected, specifically 'invoice is not pending'",
      !!ciErr?.message?.toLowerCase().includes("invoice is not pending"), ciErr?.message)
    const { error: uiErr } = await lender.rpc("update_invoice", { p_invoice_id: invoiceAId, p_loan_amount: 999999 })
    check("(6) update_invoice on a voided invoice is rejected, specifically 'invoice is not pending'",
      !!uiErr?.message?.toLowerCase().includes("invoice is not pending"), uiErr?.message)
    const invA_afterMutationAttempts = await invoiceById(invoiceAId)
    check("(6) invoice A is completely unchanged by the three rejected attempts",
      invA_afterMutationAttempts?.status === "voided" &&
        invA_afterMutationAttempts?.paid_at === null &&
        invA_afterMutationAttempts?.cancelled_at === null &&
        Number(invA_afterMutationAttempts?.loan_amount) === Number(invA_final.loan_amount) &&
        invA_afterMutationAttempts?.voided_at === invA_final.voided_at &&
        invA_afterMutationAttempts?.voided_reason === invA_final.voided_reason &&
        invA_afterMutationAttempts?.voided_by === invA_final.voided_by,
      JSON.stringify(invA_afterMutationAttempts))

    // ── Switch-limit regression (max 2/month), restructured for the new rule: switch_offer only
    // works again once there's a fresh acceptance to switch away from ('nothing to switch' otherwise
    // — d.status must be back in ('accepted','confirmed')). ──
    const counter = async () =>
      (await svc.from("profiles").select("offer_switches_this_month").eq("id", brokerId).single()).data?.offer_switches_this_month
    check("counter = 1 after the first switch", (await counter()) === 1, String(await counter()))

    const { error: s2 } = await broker.rpc("switch_offer", { p_deal_id: dealId }) // Lender B still accepted → switchable
    check("second switch of the month succeeds", !s2, s2?.message)
    check("counter = 2 after the second switch", (await counter()) === 2, String(await counter()))
    check("Lender B remains 'accepted' after the second switch is merely initiated", (await offerStatus(o2.id)) === "accepted")

    // Third switch: need a fresh acceptance to switch away from again. Lender A's old offer is
    // 'switched' (terminal in normal flow) — reset it to 'pending' via service role purely as a test
    // fixture to manufacture that state, then accept it for real through the RPC.
    await svc.from("offers").update({ status: "pending", decline_reason: null }).eq("id", o1.id)
    const { error: reAcceptErr } = await broker.rpc("accept_offer", { p_offer_id: o1.id })
    check("fixture: broker re-accepts A so there's something to switch away from again", !reAcceptErr, reAcceptErr?.message)
    const { error: s3 } = await broker.rpc("switch_offer", { p_deal_id: dealId })
    check("third switch of the month is REJECTED", !!s3 && /both switches/i.test(s3.message ?? ""), s3?.message)
    check("counter stays 2 after the rejected switch", (await counter()) === 2, String(await counter()))

    // Monthly reset job only fires on a new month (switch_month distinct from the current month), so
    // simulate the rollover, then run the real job → the counter clears and switching is allowed again.
    await svc.from("profiles").update({ switch_month: dateDaysAgo(40) }).eq("id", brokerId) // ~last month
    const { data: resetN } = await svc.rpc("job_reset_monthly_switches")
    check("reset job reports it touched ≥1 broker", (resetN ?? 0) >= 1, String(resetN))
    check("reset job zeroed the counter", (await counter()) === 0, String(await counter()))
    const { error: s4 } = await broker.rpc("switch_offer", { p_deal_id: dealId }) // deal still has A accepted
    check("switching works again after the monthly reset", !s4, s4?.message)
    check("counter = 1 after reset + switch", (await counter()) === 1, String(await counter()))
  } finally {
    // invoices/surveys FK deals with NO ACTION (they'd block the delete) — remove them first. Under
    // migration 86 a voided invoice is NOT auto-deleted, so (unlike the pre-86 version of this smoke)
    // this cleanup can no longer rely on switch_offer having emptied the table itself.
    const { data: cleanupDeal } = await svc.from("deals").select("id").eq("deal_number", DEALNUM).maybeSingle()
    if (cleanupDeal) {
      await svc.from("surveys").delete().eq("deal_id", cleanupDeal.id)
      await svc.from("invoices").delete().eq("deal_id", cleanupDeal.id)
    }
    await svc.from("deals").delete().eq("deal_number", DEALNUM) // cascade removes the offers
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
