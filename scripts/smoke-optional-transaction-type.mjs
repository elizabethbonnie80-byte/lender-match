/**
 * Smoke for E-5 (client 2026-07-30, migration 63) — Transaction Type is optional on Create Deal, and a
 * deal left untyped must reach lenders of ALL THREE types instead of being filtered out.
 *
 *   "if the broker doesn't select a transaction type … the transaction type filter doesn't apply, so
 *    that the deal runs through all 3 lender types and isn't filtered out by transaction type alone"
 *
 * Two independent predicates had to change, and this asserts both — the second is the one that would
 * otherwise have shipped as a silent regression:
 *
 *   1. saved_filter_matches — a NULL deal value compared with `=` yields NULL, which inside an AND
 *      chain reads as FALSE. The deal simply vanished from every lender who had set a type.
 *   2. match_percentage — the criterion was gated on the FILTER's value alone, so a null deal took the
 *      ELSE branch: 18 points (the heaviest weight in the engine) charged to the denominator and none
 *      earned, plus a red "Transaction Type" chip. Visible but ranked last is not what was asked for,
 *      and only the scoring assertions below catch it — the visibility ones all pass without this fix.
 *
 * Every assertion has a typed control beside it, so a change that made the filter match EVERYTHING
 * (the opposite failure) fails too.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-optional-transaction-type.mjs
 */
import { service, signIn, idByEmail, upsertSubmittedDeal } from "./_demo-lib.mjs"

const svc = service()
let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

const DEALS = {
  none: "DEAL-2026-9631",     // transaction_type NULL — the case the client asked for
  prime: "DEAL-2026-9632",    // control: matches the filter's type
  private: "DEAL-2026-9633",  // control: contradicts it, must stay excluded
}
const FILTER_NAME = "SMOKE-E5-PRIME"

/** Matches filter F on all 11 weighted criteria → the criteria sum to 100 for easy arithmetic. */
const baseFields = {
  loan_amount: 600000, closing_date: "2026-12-01",
  province: "ontario", mortgage_product: "5_year_fixed",
  ltv: 70, primary_credit_score: 700, amortization_years: 25, mortgage_position: "first",
  purpose: "purchase", dwelling_type: "detached", occupancy: "owner_occupied", property_value: 600000,
}

const dealIds = {}
let filterId = null
let parkedIds = []

async function main() {
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const lender = await signIn("lender@loanlink.test")

  // best_match_for takes the MAX across every active filter, so park the seeded ones for the duration
  // (restored in the finally) — otherwise another filter could supply the score we are asserting.
  const { data: preexisting } = await svc
    .from("saved_filters").select("id").eq("lender_id", lenderId).eq("is_active", true)
  parkedIds = (preexisting ?? []).map((r) => r.id)
  if (parkedIds.length) await svc.from("saved_filters").update({ is_active: false }).in("id", parkedIds)

  // Filter F — all 11 weighted criteria set: 18+14+14+12+10+8+6+6+4+4+4 = 100.
  const { data: f, error: fe } = await svc.from("saved_filters").insert({
    lender_id: lenderId, name: FILTER_NAME, is_active: true,
    transaction_type: "prime", province: "ontario", mortgage_product: "5_year_fixed",
    ltv_min: 60, ltv_max: 80, credit_score_min: 680, amortization_min: 20, amortization_max: 30,
    mortgage_position: "first", purpose: "purchase", dwelling_type: "detached",
    occupancy: "owner_occupied", property_value_min: 400000, property_value_max: 1000000,
  }).select("id").single()
  if (fe) throw new Error(`filter: ${fe.message}`)
  filterId = f.id

  for (const [key, dealNumber] of Object.entries(DEALS)) {
    dealIds[key] = await upsertSubmittedDeal(svc, {
      dealNumber, brokerId, brokerageId: bp.brokerage_id, createdAt: new Date().toISOString(),
      fields: { ...baseFields, transaction_type: key === "none" ? null : key },
      client: { first: "Opt", last: key, address: `${dealNumber} Test Rd` },
    })
  }

  // Guard the premise: if the column had been NOT NULL this smoke would be meaningless.
  const { data: stored } = await svc.from("deals").select("transaction_type").eq("id", dealIds.none).single()
  check("an untyped deal can be stored at all", stored?.transaction_type === null, String(stored?.transaction_type))

  // ── 1. Scoring: the criterion must DROP OUT, not score zero ────────────────────────────────────
  const score = async (id) => {
    const { data, error } = await lender.rpc("best_match_for", { p_lender: lenderId, p_deal_id: id })
    if (error) throw new Error(`best_match_for: ${error.message}`)
    const r = Array.isArray(data) ? data[0] : data
    return { pct: r?.pct, fails: r?.fails ?? [] }
  }

  const sNone = await score(dealIds.none)
  const sPrime = await score(dealIds.prime)
  const sPrivate = await score(dealIds.private)

  // The whole point: 100, not 82. 82 would mean the 18-point weight was charged as a miss.
  check("untyped deal scores 100% (criterion skipped, not failed)", sNone.pct === 100,
    `${sNone.pct}%` + (sNone.pct === 82 ? "  ← charged the 18-pt weight as a miss" : ""))
  check("untyped deal shows no 'Transaction Type' miss chip",
    !sNone.fails.includes("Transaction Type"), JSON.stringify(sNone.fails))
  check("matching typed deal still scores 100%", sPrime.pct === 100, `${sPrime.pct}%`)
  // The control that proves the criterion still WORKS — without it, "always skip" would pass above.
  check("contradicting typed deal still loses the 18-pt weight", sPrivate.pct === 82, `${sPrivate.pct}%`)
  check("contradicting typed deal still lists the miss",
    sPrivate.fails.includes("Transaction Type"), JSON.stringify(sPrivate.fails))

  // ── 2. Visibility through a saved-filter chip (saved_filter_matches) ───────────────────────────
  const numsOf = (rows) => (rows ?? []).map((r) => r.deal_number)

  const { data: chip, error: ce } = await lender.rpc("open_deals_for_lender", { p_filter_id: filterId })
  check("open_deals_for_lender runs with the filter chip", !ce, ce?.message)
  const chipNums = numsOf(chip)
  check("untyped deal IS shown to a lender filtering on 'prime'", chipNums.includes(DEALS.none),
    chipNums.includes(DEALS.none) ? "" : "IT WAS FILTERED OUT — the null-safety fix is missing")
  check("matching typed deal is still shown", chipNums.includes(DEALS.prime))
  check("contradicting typed deal is still excluded", !chipNums.includes(DEALS.private))

  // ── 3. Same, through the ad-hoc Filters sidepanel (open_deals_filtered) ────────────────────────
  const { data: adhoc, error: ae } = await lender.rpc("open_deals_filtered", { p_transaction_type: "prime" })
  check("open_deals_filtered runs", !ae, ae?.message)
  const adhocNums = numsOf(adhoc)
  check("untyped deal IS shown through the ad-hoc panel", adhocNums.includes(DEALS.none))
  check("matching typed deal is still shown through the panel", adhocNums.includes(DEALS.prime))
  check("contradicting typed deal is still excluded by the panel", !adhocNums.includes(DEALS.private))

  // ── 4. An unfiltered feed is unaffected ────────────────────────────────────────────────────────
  const { data: all } = await lender.rpc("open_deals_for_lender", {})
  const allNums = numsOf(all)
  check("all three deals appear when no filter is applied",
    Object.values(DEALS).every((n) => allNums.includes(n)),
    Object.values(DEALS).filter((n) => !allNums.includes(n)).join(", ") || "all present")

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  return failures === 0 ? 0 : 1
}

async function cleanup() {
  const ids = Object.values(dealIds).filter(Boolean)
  if (ids.length) {
    await svc.from("surveys").delete().in("deal_id", ids)
    await svc.from("invoices").delete().in("deal_id", ids)
    await svc.from("deals").delete().in("id", ids)
  }
  if (filterId) await svc.from("saved_filters").delete().eq("id", filterId)
  if (parkedIds.length) await svc.from("saved_filters").update({ is_active: true }).in("id", parkedIds)
}

main()
  .then(async (code) => { await cleanup(); process.exit(code) })
  .catch(async (e) => { console.error(e); await cleanup(); process.exit(1) })
