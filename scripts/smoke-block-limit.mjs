/**
 * Smoke for the Round 4 (2026-09-03) 5-per-broker lender-institution block cap + audit trail:
 *   - block_lender_institution() lets a broker reach exactly 5, and refuses a 6th (BLOCK_LIMIT_REACHED)
 *   - unblocking frees a slot immediately
 *   - a race-safety check: two simultaneous block attempts at 4/5 must yield exactly one success
 *   - re-blocking an already-blocked institution at 5/5 is a harmless no-op, not a rejection
 *   - broker_block_audit records every block/unblock, admin can read it, broker/lender cannot
 *   - deleting the referenced lender institution does not fail (audit trigger fallback) and does not
 *     erase the historical event — it keeps its snapshot name and original id
 * Creates one temporary lender institution (there are only 5 seeded — Merix/RMG/RFA/TD/Radius — so a
 * 6th is needed to exercise the over-the-cap path) and self-cleans everything it touches.
 *   node scripts/seed-users.mjs && node scripts/smoke-block-limit.mjs
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
const TEMP_INSTITUTION = "Smoke Test Institution (block-limit)"

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

async function main() {
  const s = svc()
  const { data: list } = await s.auth.admin.listUsers()
  const brokerId = list.users.find((u) => u.email === "broker@loanlink.test")?.id
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")

  // Ensure a clean slate: no pre-existing blocks/audit rows for this broker, and no leftover temp
  // institution from a prior interrupted run.
  await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId)
  await s.from("broker_block_audit").delete().eq("broker_id", brokerId)
  await s.from("lender_institutions").delete().eq("name", TEMP_INSTITUTION)
  const { data: tempInst, error: tempErr } = await s
    .from("lender_institutions")
    .insert({ name: TEMP_INSTITUTION, is_active: true })
    .select("id")
    .single()
  if (tempErr) throw new Error(`create temp institution: ${tempErr.message}`)

  const { data: institutions } = await s
    .from("lender_institutions")
    .select("id, name")
    .eq("is_active", true)
    .order("name")
  check("at least 6 active institutions available to exercise the cap", institutions.length >= 6, `found ${institutions.length}`)
  const ids = institutions.map((i) => i.id)

  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const admin = await clientFor("admin@loanlink.test")

  // ── Happy path: block exactly 5 ──
  for (let i = 0; i < 5; i++) {
    const { error } = await broker.rpc("block_lender_institution", { p_institution_id: ids[i] })
    check(`block #${i + 1}/5 succeeds`, !error, error?.message)
  }
  const { data: after5 } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  check("broker has exactly 5 active blocks", (after5 ?? []).length === 5, `found ${after5?.length}`)

  // ── 6th is refused ──
  const { error: sixthErr } = await broker.rpc("block_lender_institution", { p_institution_id: ids[5] })
  check("a 6th block is refused", !!sixthErr && sixthErr.message.includes("BLOCK_LIMIT_REACHED"), sixthErr?.message)
  const { data: still5 } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  check("still exactly 5 after the refused 6th (nothing snuck in)", (still5 ?? []).length === 5)

  // A raw client insert (bypassing the RPC) must also be refused by RLS — the cap can't be beaten by
  // going straight to the table.
  const { error: directErr } = await broker
    .from("broker_blocked_institutions")
    .insert({ broker_id: brokerId, institution_id: ids[5] })
  check("a direct insert bypassing the RPC is RLS-denied", !!directErr)

  // Re-blocking an institution already in the 5 must be a harmless no-op, not a limit violation —
  // a stale UI / retried request re-"blocking" ids[0] while at 5/5 must not be rejected.
  const { error: reblockErr } = await broker.rpc("block_lender_institution", { p_institution_id: ids[0] })
  check("re-blocking an already-blocked institution at 5/5 succeeds (no-op)", !reblockErr, reblockErr?.message)
  const { data: stillJust5 } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  check("still exactly 5 after the idempotent re-block (no duplicate row)", (stillJust5 ?? []).length === 5, `found ${stillJust5?.length}`)
  const { data: ids0AuditRows } = await s
    .from("broker_block_audit")
    .select("id")
    .eq("broker_id", brokerId)
    .eq("institution_id", ids[0])
    .eq("action", "blocked")
  check("the idempotent re-block did not create a duplicate audit event", (ids0AuditRows ?? []).length === 1, `found ${ids0AuditRows?.length}`)

  // ── Unblock frees a slot ──
  const { error: unblockErr } = await broker.from("broker_blocked_institutions").delete().eq("institution_id", ids[0])
  check("unblock succeeds", !unblockErr, unblockErr?.message)
  const { error: sixthNowErr } = await broker.rpc("block_lender_institution", { p_institution_id: ids[5] })
  check("after unblocking one, the 6th can now be added", !sixthNowErr, sixthNowErr?.message)

  // ── Race safety: back to 4, fire two simultaneous block attempts at 4/5 ──
  await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId).eq("institution_id", ids[5])
  const { data: at4 } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  check("at exactly 4 before the race", (at4 ?? []).length === 4, `found ${at4?.length}`)

  const [raceA, raceB] = await Promise.all([
    broker.rpc("block_lender_institution", { p_institution_id: ids[0] }),
    broker.rpc("block_lender_institution", { p_institution_id: ids[5] }),
  ])
  const raceSuccesses = [raceA, raceB].filter((r) => !r.error).length
  const raceLimitHits = [raceA, raceB].filter((r) => r.error?.message.includes("BLOCK_LIMIT_REACHED")).length
  check("exactly one of two simultaneous block attempts at 4/5 succeeds", raceSuccesses === 1, `succeeded=${raceSuccesses}`)
  check("the other is rejected with BLOCK_LIMIT_REACHED, not a silent overshoot", raceLimitHits === 1, `limitHits=${raceLimitHits}`)
  const { data: after5b } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  check("still exactly 5 after the race (no overshoot to 6)", (after5b ?? []).length === 5, `found ${after5b?.length}`)

  // ── Audit trail ──
  const { data: adminActivity, error: adminActivityErr } = await admin.rpc("admin_block_activity")
  check("admin can read admin_block_activity", !adminActivityErr, adminActivityErr?.message)
  const brokerEvents = (adminActivity?.events ?? []).filter((e) => e.broker_id === brokerId)
  const blockedEvents = brokerEvents.filter((e) => e.action === "blocked").length
  const unblockedEvents = brokerEvents.filter((e) => e.action === "unblocked").length
  check("audit recorded at least 6 'blocked' events for this run", blockedEvents >= 6, `found ${blockedEvents}`)
  check("audit recorded at least 2 'unblocked' events for this run", unblockedEvents >= 2, `found ${unblockedEvents}`)
  const summaryRow = (adminActivity?.summary ?? []).find((r) => r.broker_id === brokerId)
  check("admin summary shows this broker at 5 currently blocked", summaryRow?.blocked_count === 5, `found ${summaryRow?.blocked_count}`)

  const { data: brokerAuditRead, error: brokerAuditErr } = await broker.from("broker_block_audit").select("id").eq("broker_id", brokerId)
  check("a broker cannot read the audit table directly (RLS denies)", !brokerAuditErr && (brokerAuditRead ?? []).length === 0)
  const { data: lenderAuditRead, error: lenderAuditErr } = await lender.from("broker_block_audit").select("id")
  check("a lender cannot read the audit table directly (RLS denies)", !lenderAuditErr && (lenderAuditRead ?? []).length === 0)

  // ── Audit durability: deleting a CURRENTLY BLOCKED institution must not fail, and must not erase
  // its history. This has to actually go through the CASCADE path (deleting lender_institutions ->
  // ON DELETE CASCADE removes the broker_blocked_institutions row -> fires the same audit trigger)
  // to exercise the bug that was found: a live name lookup inside the trigger finds nothing at that
  // exact moment (the parent row is already gone from this transaction's perspective), which is what
  // migration 78's fallback exists to survive. Manually deleting the block row first would skip the
  // cascade entirely and prove nothing, so this section first FORCES the temp institution into a
  // known "currently blocked" state (the race above left it non-deterministic) before deleting it.
  const { data: blockedNow } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId)
  if (!(blockedNow ?? []).some((r) => r.institution_id === tempInst.id)) {
    // Free a slot (harmless no-op if ids[0] isn't currently the one blocked) and take it.
    await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId).eq("institution_id", ids[0])
    const { error: forceBlockErr } = await broker.rpc("block_lender_institution", { p_institution_id: tempInst.id })
    check("test setup: the temp institution can be (re-)blocked before the durability check", !forceBlockErr, forceBlockErr?.message)
  }
  const { data: nowBlocked } = await s.from("broker_blocked_institutions").select("institution_id").eq("broker_id", brokerId).eq("institution_id", tempInst.id)
  check("test setup: the temp institution is confirmed currently blocked", (nowBlocked ?? []).length === 1)

  const { data: beforeDelete } = await s
    .from("broker_block_audit")
    .select("id")
    .eq("broker_id", brokerId)
    .eq("institution_name", TEMP_INSTITUTION)
  check("audit history for the temp institution exists before it's deleted", (beforeDelete ?? []).length > 0, `found ${beforeDelete?.length}`)

  // No manual pre-delete of the block row here — deleting the institution must cascade into it.
  const { error: deleteInstErr } = await s.from("lender_institutions").delete().eq("id", tempInst.id)
  check("deleting a currently-blocked institution succeeds (the audit trigger does not block it)", !deleteInstErr, deleteInstErr?.message)

  const { data: adminActivityAfterDelete, error: afterDeleteErr } = await admin.rpc("admin_block_activity")
  check("admin_block_activity still succeeds after the institution is deleted", !afterDeleteErr, afterDeleteErr?.message)
  const survivingEvent = (adminActivityAfterDelete?.events ?? []).find(
    (e) => e.broker_id === brokerId && e.institution_name === TEMP_INSTITUTION,
  )
  check("the historical event for the deleted institution still appears, by name", !!survivingEvent)
  check("its institution_id still holds the original id (no FK, never nulled/cascaded away)", survivingEvent?.institution_id === tempInst.id)

  // ── Cleanup ──
  await s.from("broker_blocked_institutions").delete().eq("broker_id", brokerId)
  await s.from("broker_block_audit").delete().eq("broker_id", brokerId)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
