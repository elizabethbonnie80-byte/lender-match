/**
 * Smoke for the rating-penalty EFFECT (OQ#25, migration 23). A lender whose profiles.penalty_active
 * is true must be HIDDEN from — and unable to bid on — near-closing / near-COF deals, EXCEPT deals
 * they already offered on; clearing the flag (admin lift) makes them reappear.
 *
 * Fully self-contained & deterministic: seeds its own fixtures with closing/COF dates RELATIVE to
 * today (not the fixed seed dates), toggles penalty_active via the service role, and cleans up.
 * Thresholds under test: closing < 45 days, COF < 14 days.
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-penalty.mjs
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

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

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
async function idByEmail(email) {
  const { data } = await admin.auth.admin.listUsers()
  return data.users.find((u) => u.email === email)?.id
}
// YYYY-MM-DD, `days` from today (local clock == DB clock for local Supabase).
function dateIn(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const PREFIX = "ZPEN-"
const has = (rows, num) => (rows ?? []).some((r) => r.deal_number === num)

async function cleanup() {
  // Surveys FK deals with NO ACTION (they'd block the delete), so drop them first.
  const { data: zpen } = await admin.from("deals").select("id").like("deal_number", `${PREFIX}%`)
  const ids = (zpen ?? []).map((r) => r.id)
  if (ids.length) await admin.from("surveys").delete().in("deal_id", ids)
  await admin.from("deals").delete().like("deal_number", `${PREFIX}%`)
}

async function main() {
  const brokerId = await idByEmail("broker@loanlink.test")
  const lenderId = await idByEmail("lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (scripts/seed-users.mjs).")
  const { data: bp } = await admin.from("profiles").select("brokerage_id").eq("id", brokerId).single()

  await cleanup() // idempotent

  const base = {
    broker_id: brokerId,
    brokerage_id: bp.brokerage_id,
    status: "submitted",
    transaction_type: "prime",
    province: "ontario",
    city: "Toronto",
    mortgage_product: "5_year_fixed",
    purpose: "purchase",
    occupancy: "owner_occupied",
    dwelling_type: "detached",
    mortgage_position: "first",
    ltv: 70,
    loan_amount: 500000,
    property_value: 700000,
    amortization_years: 25,
    primary_credit_score: 730,
  }
  // Fixtures (dates relative to today):
  const NEAR = `${PREFIX}NEAR-CLOSE`  // closing +10d           → hidden when penalized
  const FAR = `${PREFIX}FAR`          // closing +100d          → always visible
  const COF = `${PREFIX}NEAR-COF`     // closing +100d, COF +7d → hidden when penalized (COF < 14d)
  const OFFERED = `${PREFIX}OFFERED`  // closing +10d, offered  → out of the feed (migration 34), reachable via Submitted Offers

  const { error: iErr } = await admin.from("deals").insert([
    { ...base, deal_number: NEAR, closing_date: dateIn(10) },
    { ...base, deal_number: FAR, closing_date: dateIn(100) },
    { ...base, deal_number: COF, closing_date: dateIn(100), cof_date: dateIn(7) },
    { ...base, deal_number: OFFERED, closing_date: dateIn(10) },
  ])
  if (iErr) throw new Error(`fixture insert: ${iErr.message}`)

  const lender = await clientFor("lender@loanlink.test")

  // The lender makes an offer on OFFERED while NOT penalized → establishes the exemption.
  const { data: offeredDeal } = await admin.from("deals").select("id").eq("deal_number", OFFERED).single()
  const { error: oErr } = await lender.rpc("make_offer", {
    p_deal_id: offeredDeal.id,
    p_mortgage_product: "5_year_fixed",
    p_rate: 4.99,
    p_rate_lock_days: 120,
    p_commission_bps: 30,
  })
  check("lender can offer on a near-closing deal while NOT penalized", !oErr, oErr?.message)

  // Baseline (penalty OFF): every fixture is visible in the open feed.
  await admin.from("profiles").update({ penalty_active: false }).eq("id", lenderId)
  let { data: feed } = await lender.rpc("open_deals_for_lender", {})
  check("baseline: near-closing deal visible", has(feed, NEAR))
  check("baseline: near-COF deal visible", has(feed, COF))
  check("baseline: far deal visible", has(feed, FAR))
  check("baseline: offered deal is excluded from the feed (moved to Submitted Offers)", !has(feed, OFFERED))

  // Penalize the lender.
  await admin.from("profiles").update({ penalty_active: true }).eq("id", lenderId)
  ;({ data: feed } = await lender.rpc("open_deals_for_lender", {}))
  check("penalized: near-closing deal HIDDEN", !has(feed, NEAR))
  check("penalized: near-COF deal HIDDEN", !has(feed, COF))
  check("penalized: far deal still visible", has(feed, FAR))
  // Offered-on deals leave the discovery feed (migration 34), but the penalty exemption keeps the deal
  // REACHABLE for the lender (Submitted Offers path) — verify via a direct deals SELECT, not the feed.
  const { data: offeredRow } = await lender.from("deals").select("id").eq("id", offeredDeal.id).maybeSingle()
  check("penalized: already-offered near deal still reachable (exemption)", !!offeredRow)

  // Effect also flows through the ad-hoc filtered feed (open_deals_filtered) and maturing feed.
  const { data: filtered } = await lender.rpc("open_deals_filtered", { p_province: "ontario" })
  check("penalized: near-closing hidden in filtered feed too", !has(filtered, NEAR))
  check("penalized: far deal present in filtered feed", has(filtered, FAR))
  const { data: maturing } = await lender.rpc("maturing_deals_for_lender", {})
  check("penalized: near-closing hidden in maturing feed too", !has(maturing, NEAR))

  // A penalized lender cannot bid on a hidden near-closing deal (make_offer re-checks visibility).
  const { data: nearDeal } = await admin.from("deals").select("id").eq("deal_number", NEAR).single()
  const { error: blockErr } = await lender.rpc("make_offer", {
    p_deal_id: nearDeal.id,
    p_mortgage_product: "5_year_fixed",
    p_rate: 4.99,
    p_rate_lock_days: 120,
    p_commission_bps: 30,
  })
  check("penalized: make_offer on a hidden near-closing deal is blocked", !!blockErr,
    blockErr ? "raised: " + blockErr.message : "NO error — offer went through")

  // Admin console: admin_lender_ratings() reflects the penalty; a non-admin gets no rows.
  const adminSession = await clientFor("admin@loanlink.test")
  const { data: ratings } = await adminSession.rpc("admin_lender_ratings")
  const lenderRow = (ratings ?? []).find((r) => r.lender_id === lenderId)
  check("admin sees the lender in admin_lender_ratings with penalty_active", !!lenderRow && lenderRow.penalty_active === true)
  const { data: lenderRatings } = await lender.rpc("admin_lender_ratings")
  check("a non-admin (lender) gets no rows from admin_lender_ratings", (lenderRatings?.length ?? 0) === 0)

  // Admin lifts the penalty → the hidden deals reappear.
  await admin.from("profiles").update({ penalty_active: false }).eq("id", lenderId)
  ;({ data: feed } = await lender.rpc("open_deals_for_lender", {}))
  check("penalty lifted: near-closing deal visible again", has(feed, NEAR))
  check("penalty lifted: near-COF deal visible again", has(feed, COF))

  // --- Rating penalty COMPUTATION (job_apply_rating_penalties) ---
  // Client 2026-07-28 (B-4), verbatim: "include both of the 2 turn-time questions, and if either one of
  // those two questions gets 4 no's within the last 10 surveys, the penalty would apply." This replaced
  // the original avg(satisfaction) < 3 over 5 rule (migration 59).
  //
  // 14 dedicated deals: the newest 10 are the window, the oldest 4 exist only to prove they fall OUT of
  // it. completed_at is set explicitly so the ordering is deterministic against any seeded history.
  const SURV_N = 14
  const survDeals = []
  for (let i = 1; i <= SURV_N; i++) {
    const { data: dRow, error: sdErr } = await admin.from("deals")
      .insert({ ...base, deal_number: `${PREFIX}SURV-${i}`, status: "confirmed", closing_date: dateIn(-5) })
      .select("id").single()
    if (sdErr) throw new Error(`survey deal ${i}: ${sdErr.message}`)
    survDeals.push(dRow.id)
  }

  /**
   * Write one survey per deal. `commitments` / `docReviews` are arrays of booleans, newest FIRST — index
   * 0 becomes the most recent survey, so index >= 10 is outside the window the rule looks at.
   */
  const setTurnTimes = (commitments, docReviews) => admin.from("surveys").upsert(
    survDeals.map((id, idx) => ({
      deal_id: id, broker_id: brokerId, lender_id: lenderId, closed_with_lender: true,
      commitment_on_time: commitments[idx] ?? true,
      doc_review_on_time: docReviews[idx] ?? true,
      satisfaction: 4, // deliberately GOOD: proves the trigger no longer reads satisfaction at all
      is_completed: true,
      completed_at: new Date(Date.now() - idx * 3600_000).toISOString(),
    })), { onConflict: "deal_id" })
  const penaltyOf = async () =>
    (await admin.from("profiles").select("penalty_active").eq("id", lenderId).single()).data?.penalty_active
  const nos = (count) => Array.from({ length: SURV_N }, (_, i) => i >= count) // first `count` are false

  await admin.from("profiles").update({ penalty_active: false }).eq("id", lenderId)

  // 4 late commitments in the window → penalty, even with satisfaction 4/5 throughout.
  const { error: sErr } = await setTurnTimes(nos(4), nos(0))
  check("turn-time survey insert ok", !sErr, sErr?.message)
  await admin.rpc("job_apply_rating_penalties")
  check("computation: 4 late commitments in the last 10 → penalty SET", (await penaltyOf()) === true)

  // 3 late commitments → below the threshold.
  await setTurnTimes(nos(3), nos(0))
  await admin.rpc("job_apply_rating_penalties")
  check("computation boundary: 3 late commitments → penalty CLEARED", (await penaltyOf()) === false)

  // The other question triggers on its own.
  await setTurnTimes(nos(0), nos(4))
  await admin.rpc("job_apply_rating_penalties")
  check("computation: 4 late doc reviews in the last 10 → penalty SET", (await penaltyOf()) === true)

  // The two counts are INDEPENDENT: 3 of each is 6 late answers but neither question reaches 4. This is
  // the case the client's wording ("either one of those two questions gets 4 no's") settles.
  await setTurnTimes(nos(3), nos(3))
  await admin.rpc("job_apply_rating_penalties")
  check("computation: 3 + 3 across both questions → NOT penalized", (await penaltyOf()) === false)

  // The window really is 10: put the 4 late commitments on the OLDEST four surveys (indices 10-13).
  const oldestFourLate = Array.from({ length: SURV_N }, (_, i) => i < 10)
  await setTurnTimes(oldestFourLate, nos(0))
  await admin.rpc("job_apply_rating_penalties")
  check("computation: 4 late answers OUTSIDE the last 10 → NOT penalized", (await penaltyOf()) === false)

  // A not-closed survey carries no turn-time answers and must not consume a slot in the window.
  await setTurnTimes(nos(4), nos(0))
  await admin.from("surveys")
    .update({ closed_with_lender: false, commitment_on_time: null, doc_review_on_time: null, satisfaction: null })
    .eq("deal_id", survDeals[0])
  await admin.rpc("job_apply_rating_penalties")
  check("computation: a not-closed survey is skipped, so only 3 late remain → NOT penalized",
    (await penaltyOf()) === false)

  await cleanup()
  await admin.from("profiles").update({ penalty_active: false }).eq("id", lenderId)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  try { await cleanup() } catch {}
  console.error(e)
  process.exit(1)
})
