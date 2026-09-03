/**
 * Smoke for bilateral blocking (security invariant #2): a broker who blocks a lender's institution —
 * or a lender who blocks a brokerage — must not see each other's open deals (lender_can_see_deal
 * excludes blocked pairs). Uses the seeded broker open deal (DEAL-2026-88) + real broker/lender
 * sessions, and self-cleans the block rows it creates.
 *   node scripts/seed-users.mjs && node scripts/seed-maturing.mjs && node scripts/smoke-blocking.mjs
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "Test1234!"
const DEAL = "DEAL-2026-88"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
function svc() {
  return createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } })
}
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}
const has = (rows, num) => (rows ?? []).some((r) => r.deal_number === num)
async function lenderSees(lender) {
  const { data } = await lender.rpc("open_deals_for_lender", {})
  return has(data, DEAL)
}

async function main() {
  const s = svc()
  const { data: list } = await s.auth.admin.listUsers()
  const brokerId = list.users.find((u) => u.email === "broker@loanlink.test")?.id
  const lenderId = list.users.find((u) => u.email === "lender@loanlink.test")?.id
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: lp } = await s.from("profiles").select("lender_institution_id").eq("id", lenderId).single()
  const { data: bp } = await s.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const institutionId = lp.lender_institution_id
  const brokerageId = bp.brokerage_id

  // Clean any pre-existing block between these two so the run is deterministic.
  await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId).eq("institution_id", institutionId)
  await s.from("lender_blocked_brokerages").delete().eq("lender_id", lenderId).eq("brokerage_id", brokerageId)

  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")

  check(`baseline: lender sees the broker's open deal (${DEAL})`, await lenderSees(lender), "run seed-maturing first")

  // ── A) Broker blocks the lender's institution → hidden from that lender ──
  // Round 4 (2026-09-03): blocking now goes through block_lender_institution() — direct inserts are
  // RLS-denied (see the negative check below) so the cap can't be bypassed from the client.
  const { error: aErr } = await broker.rpc("block_lender_institution", { p_institution_id: institutionId })
  check("broker can block an institution (via block_lender_institution RPC)", !aErr, aErr?.message)
  check("blocked-by-broker: the deal is hidden from the lender", !(await lenderSees(lender)))
  await broker.from("broker_blocked_institutions").delete().eq("institution_id", institutionId)
  check("after broker unblock: the deal is visible again", await lenderSees(lender))

  // A direct client-side insert must now be rejected (RLS has no INSERT policy on this table any
  // more — block_lender_institution() is the only path, so the 5-per-broker cap can't be bypassed).
  const { error: directInsert } = await broker
    .from("broker_blocked_institutions")
    .insert({ broker_id: brokerId, institution_id: institutionId })
  check("a direct insert bypassing the RPC is RLS-denied", !!directInsert)

  // ── B) Lender blocks the brokerage → hidden from the lender ──
  const { error: bErr } = await lender
    .from("lender_blocked_brokerages")
    .insert({ lender_id: lenderId, brokerage_id: brokerageId })
  check("lender can block a brokerage (RLS with_check)", !bErr, bErr?.message)
  check("blocked-by-lender: the deal is hidden from the lender", !(await lenderSees(lender)))
  await lender.from("lender_blocked_brokerages").delete().eq("brokerage_id", brokerageId)
  check("after lender unblock: the deal is visible again", await lenderSees(lender))

  // A lender cannot forge a block for someone else either (no INSERT policy at all any more).
  const { error: forge } = await lender
    .from("broker_blocked_institutions")
    .insert({ broker_id: brokerId, institution_id: institutionId })
  check("a lender cannot create a broker's block row (RLS denies)", !!forge)
  await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId).eq("institution_id", institutionId)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
