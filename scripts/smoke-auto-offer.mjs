/**
 * Smoke for the Round 3 Phase 3 auto-offer engine (migration 47).
 *
 * The client's confirmed trigger rule: an auto-offer fires at SUBMIT only when the deal matches EVERY
 * parameter of the linked saved filter AND all 4 note sections are empty AND "No lender exceptions
 * required" is checked. Guardrails: never on a blocked brokerage, never twice from the same lender on
 * one deal, never past the optional end date / while inactive.
 *
 * Each negative case matters more than the positive one, so they assert NO offer exists (not just that
 * no error was raised) — send_auto_offers never raises, it simply sends nothing.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-auto-offer.mjs
 */
import { service, signIn, idByEmail, attachDealDocuments } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")

  const created = []      // deal ids
  let filterId = null
  let autoOfferId = null
  // Only ONE auto-offer per lender ever fires on a deal, so any OTHER active auto-offer this lender
  // owns (e.g. the seed-phase3-qa fixture) would win by created_at and mask this run. Park them for
  // the duration and restore them in the finally block.
  const { data: parked } = await svc.from("auto_offers")
    .update({ is_active: false }).eq("lender_id", lenderId).eq("is_active", true).select("id")

  /** ISO date n days from today, for the min_closing_days gate. */
  const daysOut = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

  /** A draft that satisfies the auto-offer gate by default (no notes, exceptions box checked). */
  async function makeDraft(overrides = {}) {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 400000, property_value: 500000, ltv: 80,
      mortgage_product: "5_year_fixed", province: "ontario",
      // Relative, not a fixed date: the min_closing_days gate (B-33) compares against current_date, so a
      // hardcoded 2026-12-01 would start failing the happy path once that date is inside the window.
      transaction_type: "prime", closing_date: daysOut(90),
      no_lender_exceptions_required: true,
      ...overrides,
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    created.push(d.id)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Auto", borrower_last_name: "Offer", property_address: "1 Auto St",
    })
    await attachDealDocuments(broker, d.id)
    return d.id
  }
  const submit = (id) => broker.rpc("submit_deal", { p_deal_id: id })
  const autoOffersOn = async (id) =>
    (await svc.from("offers").select("id, is_auto, auto_offer_id, rate, commission_bps, lender_fee_pct")
      .eq("deal_id", id).eq("lender_id", lenderId)).data ?? []

  try {
    // ── Setup: a saved filter the deals above match, + a standing auto-offer on it ──
    const { data: f, error: fe } = await lender.from("saved_filters").insert({
      lender_id: lenderId, name: "Auto smoke filter", is_active: true,
      province: "ontario", mortgage_product: "5_year_fixed", transaction_type: "prime",
      loan_amount_max: 600000,
    }).select("id").single()
    if (fe) throw new Error(`saved_filters insert: ${fe.message}`)
    filterId = f.id

    const { data: a, error: ae } = await lender.from("auto_offers").insert({
      lender_id: lenderId, saved_filter_id: filterId, name: "Standard 5yr fixed",
      mortgage_product: "5_year_fixed", rate: 4.89, rate_lock_days: 120, commission_bps: 45,
      commitment_turn_time_days: 3, doc_review_turn_time_days: 2, lender_fee_pct: 0.5,
    }).select("id").single()
    if (ae) throw new Error(`auto_offers insert: ${ae.message}`)
    autoOfferId = a.id

    // ── 1. Happy path: matching deal, no notes, exceptions box checked ──
    const d1 = await makeDraft()
    const { error: s1 } = await submit(d1)
    check("submit_deal succeeds with a standing auto-offer", !s1, s1?.message)
    const offers1 = await autoOffersOn(d1)
    check("auto-offer sent on a fully matching deal", offers1.length === 1, `${offers1.length} offer(s)`)
    check("offer carries the auto-offer terms", Number(offers1[0]?.rate) === 4.89 && offers1[0]?.commission_bps === 45)
    check("offer is flagged is_auto + linked to its auto_offer", offers1[0]?.is_auto === true && offers1[0]?.auto_offer_id === autoOfferId)
    check("display-only Lender Fee % carried over", Number(offers1[0]?.lender_fee_pct) === 0.5)
    const { data: after1 } = await svc.from("deals").select("status").eq("id", d1).single()
    check("deal moved to offer_received", after1?.status === "offer_received", after1?.status)
    const { data: counters } = await svc.from("auto_offers").select("sent_count, last_sent_at").eq("id", autoOfferId).single()
    check("auto_offer counters stamped", counters?.sent_count === 1 && !!counters?.last_sent_at)

    // The broker is notified exactly as for a manual offer, with no lender identity in the body.
    const { data: notif } = await svc.from("notifications")
      .select("type, body").eq("deal_id", d1).eq("recipient_id", brokerId)
    check("broker got the new_offer notification", (notif ?? []).some((n) => n.type === "new_offer"))
    check("notification body leaks no lender identity", !(notif ?? []).some((n) => /lender@|Test Lender/i.test(n.body)))

    // The lender should NOT also get a filter_match ping for a deal that left their New Deals feed.
    const { data: fm } = await svc.from("notifications")
      .select("type").eq("deal_id", d1).eq("recipient_id", lenderId).eq("type", "filter_match")
    check("no redundant filter_match for the auto-bidding lender", (fm ?? []).length === 0)

    // ── 2. A non-empty note blocks the send ──
    const d2 = await makeDraft({ credit_notes: "Bruised credit, needs an exception." })
    await submit(d2)
    check("no auto-offer when a note section is filled", (await autoOffersOn(d2)).length === 0)

    // ── 3. "No lender exceptions required" unchecked blocks the send ──
    const d3 = await makeDraft({ no_lender_exceptions_required: false })
    await submit(d3)
    check("no auto-offer when the no-exceptions box is unchecked", (await autoOffersOn(d3)).length === 0)

    // ── 4. A deal outside the filter (wrong province) does not trigger ──
    const d4 = await makeDraft({ province: "alberta" })
    await submit(d4)
    check("no auto-offer when the deal misses a filter parameter", (await autoOffersOn(d4)).length === 0)

    // ── 5. Inactive auto-offer / expired end date ──
    await svc.from("auto_offers").update({ is_active: false }).eq("id", autoOfferId)
    const d5 = await makeDraft()
    await submit(d5)
    check("no auto-offer while the auto-offer is inactive", (await autoOffersOn(d5)).length === 0)

    await svc.from("auto_offers").update({ is_active: true, end_date: "2026-07-01" }).eq("id", autoOfferId)
    const d6 = await makeDraft()
    await submit(d6)
    check("no auto-offer past the optional end date", (await autoOffersOn(d6)).length === 0)
    await svc.from("auto_offers").update({ end_date: null }).eq("id", autoOfferId)

    // ── 5b. The lender-level MASTER switch (E-11, migration 64) ──
    // Independent of the per-row is_active above: master off must stop a fully active auto-offer, and
    // turning it back on must resume WITHOUT the lender having to re-enable anything. That second half
    // is the whole reason this is a separate column rather than a bulk flip of is_active.
    const { data: defaultOn } = await svc.from("profiles").select("auto_offers_enabled").eq("id", lenderId).single()
    check("auto_offers_enabled defaults to true", defaultOn?.auto_offers_enabled === true,
      String(defaultOn?.auto_offers_enabled) + "  ← a false default would silently stop every existing auto-offer")

    await lender.from("profiles").update({ auto_offers_enabled: false }).eq("id", lenderId)
    const { data: afterSelfUpdate } = await svc.from("profiles").select("auto_offers_enabled").eq("id", lenderId).single()
    // RLS with no matching policy is a silent no-op, so assert the VALUE, not the absence of an error.
    check("the lender can turn their own master switch off", afterSelfUpdate?.auto_offers_enabled === false,
      String(afterSelfUpdate?.auto_offers_enabled))

    const dMasterOff = await makeDraft()
    await submit(dMasterOff)
    check("no auto-offer while the master switch is off", (await autoOffersOn(dMasterOff)).length === 0)

    const { data: stillActive } = await svc.from("auto_offers").select("is_active").eq("id", autoOfferId).single()
    check("master off does NOT touch the per-offer is_active", stillActive?.is_active === true,
      "per-offer pause state must survive a master toggle")

    await lender.from("profiles").update({ auto_offers_enabled: true }).eq("id", lenderId)
    const dMasterOn = await makeDraft()
    await submit(dMasterOn)
    check("auto-offer resumes when the master switch goes back on", (await autoOffersOn(dMasterOn)).length === 1)

    // ── 6. Blocked brokerage (lender blocked the broker's brokerage) ──
    await svc.from("lender_blocked_brokerages").insert({ lender_id: lenderId, brokerage_id: bp.brokerage_id })
    const d7 = await makeDraft()
    await submit(d7)
    check("no auto-offer on a blocked brokerage's deal", (await autoOffersOn(d7)).length === 0)
    await svc.from("lender_blocked_brokerages").delete().eq("lender_id", lenderId).eq("brokerage_id", bp.brokerage_id)

    // ── 7. Never a second offer from the same lender on one deal ──
    const { data: a2 } = await lender.from("auto_offers").insert({
      lender_id: lenderId, saved_filter_id: filterId, name: "Second standard offer",
      mortgage_product: "3_year_fixed", rate: 5.25, rate_lock_days: 90, commission_bps: 30,
    }).select("id").single()
    const d8 = await makeDraft()
    await submit(d8)
    check("two matching auto-offers still send only one", (await autoOffersOn(d8)).length === 1)
    await svc.from("auto_offers").delete().eq("id", a2.id)

    // ── 8. Daily digest: one notification summarising the last 24 h ──
    await svc.from("notifications").delete().eq("recipient_id", lenderId).eq("type", "auto_offer_sent")
    const { error: de } = await svc.rpc("job_auto_offer_digest")
    check("job_auto_offer_digest runs", !de, de?.message)
    const { data: digest } = await svc.from("notifications")
      .select("body").eq("recipient_id", lenderId).eq("type", "auto_offer_sent")
    check("lender got one digest notification", (digest ?? []).length === 1, `${digest?.length ?? 0}`)
    check("digest names the deals it sent on", /DEAL-2026-/.test(digest?.[0]?.body ?? ""), digest?.[0]?.body)

    // ── 9. min_closing_days (client 2026-07-28, B-33): enough lead time before closing ──
    // The default is 30, so assert the boundary in BOTH directions rather than trusting the fixture's
    // closing date to happen to be far enough out.
    const { data: aoDefault } = await svc.from("auto_offers").select("min_closing_days").eq("id", autoOfferId).single()
    check("min_closing_days defaults to 30", aoDefault?.min_closing_days === 30, String(aoDefault?.min_closing_days))

    const dSoon = await makeDraft({ closing_date: daysOut(10) })
    await submit(dSoon)
    check("no auto-offer when closing is inside the minimum", (await autoOffersOn(dSoon)).length === 0)

    const dFar = await makeDraft({ closing_date: daysOut(31) })
    await submit(dFar)
    check("auto-offer sent when closing is beyond the minimum", (await autoOffersOn(dFar)).length === 1)

    // A prequal has no closing date at all, so it cannot be "too soon" — it must NOT be swallowed by the
    // gate (this is the null-drops-the-row bug migration 54 had to undo for the max filters).
    const dPrequal = await makeDraft({ closing_date: null, prequal: true })
    await svc.from("deal_identities").update({ property_address: null }).eq("deal_id", dPrequal)
    const { error: pe } = await submit(dPrequal)
    check("prequal with no closing date submits", !pe, pe?.message)
    check("auto-offer still sent on a prequal (no closing date)", (await autoOffersOn(dPrequal)).length === 1)

    // A lender who needs more lead time sets their own minimum.
    await svc.from("auto_offers").update({ min_closing_days: 60 }).eq("id", autoOfferId)
    const dOwnMin = await makeDraft({ closing_date: daysOut(45) })
    await submit(dOwnMin)
    check("a lender's own higher minimum is respected", (await autoOffersOn(dOwnMin)).length === 0)
    await svc.from("auto_offers").update({ min_closing_days: 30 }).eq("id", autoOfferId)

    // ── 10. RLS: an auto-offer is private to its lender ──
    const { data: seenByBroker } = await broker.from("auto_offers").select("id").eq("id", autoOfferId)
    check("a broker cannot read a lender's auto-offers", (seenByBroker ?? []).length === 0)
    const admin = await signIn("admin@loanlink.test")
    const { data: seenByAdmin } = await admin.from("auto_offers").select("id").eq("id", autoOfferId)
    check("an admin can read auto-offers (oversight)", (seenByAdmin ?? []).length === 1)
  } finally {
    for (const id of created) {
      await svc.from("invoices").delete().eq("deal_id", id)
      await svc.from("deal_identities").delete().eq("deal_id", id)
      await svc.from("deals").delete().eq("id", id)
    }
    if (autoOfferId) await svc.from("auto_offers").delete().eq("id", autoOfferId)
    if (filterId) await svc.from("saved_filters").delete().eq("id", filterId)
    for (const p of parked ?? []) await svc.from("auto_offers").update({ is_active: true }).eq("id", p.id)
    await svc.from("notifications").delete().eq("recipient_id", lenderId).eq("type", "auto_offer_sent")
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
