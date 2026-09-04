/**
 * Smoke for Round 4 (2026-09-04) admin user management + broker enforcement:
 *   - Option 2: a broker's blocked chat message is flagged (is_invalid), never rejected, and the
 *     violation is recorded server-side unconditionally — no client pre-check is involved any more.
 *   - the recipient can never read/preview/count an invalid message.
 *   - one message with multiple contact patterns is exactly one violation.
 *   - 3 violations in a rolling 30 days -> one automatic 7-day suspension; 4th/5th don't stack another.
 *   - fresh strike cycles (2026-09-04 correction, 2nd revision): violations recorded DURING an active
 *     automatic suspension do NOT count toward the next cycle — the anchor is the EFFECTIVE END of the
 *     most recent automatic suspension (coalesce(ended_at, expires_at)), not its start. Proven end to
 *     end: suspension #1 (violations 1-3) -> 2 during-suspension violations (4-5, recorded but excluded)
 *     -> suspension #1's effective end -> 1st/2nd post-release violations do NOT re-suspend -> the 3rd
 *     fresh one creates suspension #2. Also proven: ending an automatic suspension EARLY moves the floor
 *     to that real ended_at (not the original expires_at) — 3 violations sent immediately after an early
 *     end create suspension #3 without waiting out the original 7 days. Historical violation rows are
 *     never deleted/reset by any of this.
 *   - a suspended broker cannot submit a NEW deal, but can still draft and use an existing submitted one.
 *   - a soft-deleted account is blocked from consequential RPCs even with an already-valid session
 *     (the is_currently_deleted() defense-in-depth layer — this does NOT exercise the Auth ban/session
 *     revocation itself, which lives in the delete-broker edge function and needs `pnpm functions:serve`
 *     plus a live Supabase Auth Admin API, the same "expected local red" carve-out as smoke-invoice-pdf).
 *   - non-admins cannot read broker emails/suspension/violation records or call any admin RPC here.
 *   - an UNAUTHENTICATED caller (2026-09-04 fix) cannot submit_deal even knowing a real draft's UUID.
 *
 *   Strengthened on the follow-up review (2026-09-04, same day):
 *   - the deleted-account rejections on submit_deal/send_deal_message are pinned to the SPECIFIC
 *     "deleted" message, not just "some error" — the test broker used isn't even a participant on the
 *     target deal, so an unrelated ownership/status failure could otherwise pass this check for the
 *     wrong reason.
 *   - a MANUAL suspension does not anchor or reset the automatic 3-strike cycle: 3 fresh violations
 *     still trigger a NEW automatic suspension while a manual one is independently active.
 *   - the rolling 30-day window itself: 2 synthetic violations backdated past 30 days plus 1 fresh one
 *     do NOT trigger a suspension (only the 3rd fresh violation does) — proving the old ones never count.
 *   - admin_suspend_broker rejects 0/negative days and a blank/whitespace-only reason.
 *   - admin_end_suspension rejects re-ending an already-ended suspension and ending one that has already
 *     naturally expired.
 *   - convert_prequal_to_live() (2026-09-04 fix: the same anonymous-caller NULL-bypass bug class as
 *     submit_deal, pre-existing since migration 48, found on review) cannot be called by an
 *     unauthenticated client, and a targeted prequal is left completely unconverted by the attempt.
 *   - admin_broker_directory()'s new is_auth_banned column reads the REAL auth.users.banned_until state
 *     (not a guessed/duplicated DB flag) — correctly false for a broker soft-deleted at the DB layer but
 *     never actually Auth-banned, which is the exact partial-failure state Delete Account's retry UI
 *     exists to surface.
 *
 *   Migration 83 (2026-09-04, same day — fixes a bug found on staging by manual browser testing):
 *   tg_scan_message() was a BEFORE INSERT trigger that tried to durably record admin_alerts /
 *   broker_contact_violations rows referencing NEW.id before the messages row it points at actually
 *   existed — every flagged message raised a raw FK violation instead of returning {blocked, reason},
 *   surfacing a database error straight to the broker. Fixed by splitting into a BEFORE trigger (scan +
 *   flag only) and a new AFTER INSERT trigger (durable recording, now referencing a real row). Every
 *   RPC call in this file above this point already implicitly re-proves the fix (none of them would
 *   return successfully otherwise), and the sections below add explicit coverage that was missing
 *   entirely before:
 *   - explicit `!error` assertions on the early sends, so a regression shows the exact Postgres error
 *     immediately instead of a bare FAIL several lines later.
 *   - a LENDER's contact-info attempt is blocked and logged to admin_alerts exactly like a broker's, but
 *     never creates a broker_contact_violations row or counts toward the suspension system.
 *   - an invalid message never bumps deal_chats.updated_at (in addition to the existing preview/unread
 *     assertions).
 *   - the post-acceptance exemption (migration 83's second fix, confirmed completely absent before it):
 *     once a lender's offer is accepted, identifying/contact info is permitted in THAT specific
 *     broker/lender conversation, while a different lender's thread on the SAME deal — whose offer was
 *     NOT accepted — stays fully restricted.
 *   node scripts/seed-users.mjs && node scripts/smoke-broker-enforcement.mjs
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
async function freshBroker(email, brokerageId) {
  const { data: list } = await svc.auth.admin.listUsers()
  const ex = list?.users.find((u) => u.email === email)
  if (ex) await svc.auth.admin.deleteUser(ex.id)
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: {
      role: "broker", first_name: "Temp", last_name: "Broker",
      brokerage_id: brokerageId, tos_accepted: true, tos_version: "v1",
    },
  })
  if (error) throw new Error(`create ${email}: ${error.message}`)
  return data.user.id
}

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const admin = await clientFor("admin@loanlink.test")

  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: { user: lenderUser } } = await lender.auth.getUser()
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  // Clean slate: this broker's enforcement history must be deterministic for this run.
  await svc.from("broker_contact_violations").delete().eq("broker_id", brokerUser.id)
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)
  await svc.from("deals").delete().in("deal_number", ["TEST-ENF-1"])

  const { data: submittedDeal } = await svc.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: "TEST-ENF-1", status: "submitted",
    province: "ontario", loan_amount: 350000, submitted_at: new Date().toISOString(),
  }).select("id").single()

  // Lender opens the thread so the broker has somewhere to reply. Explicit error diagnostic (2026-09-04
  // migration 83 review): if send_deal_message ever regresses to a raw DB/FK error again, this must show
  // the actual Postgres message immediately rather than a silent null result a few lines later.
  const { data: openThread, error: openThreadErr } = await lender.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "Hello, interested in this one.",
  })
  check("(0) a normal pre-acceptance message from the lender sends without error", !openThreadErr, openThreadErr?.message)
  check("(0) a normal message is NOT flagged", openThread?.[0]?.is_invalid === false)
  const { data: chatRow } = await svc
    .from("deal_chats").select("id, updated_at").eq("deal_id", submittedDeal.id).eq("lender_id", lenderUser.id).single()
  const chatId = chatRow.id

  // ── (1) & (2): recipient can never read / preview / count an invalid message ──
  const { data: r1, error: r1Err } = await broker.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "email me at broker@example.com", p_lender_id: lenderUser.id,
  })
  check("(1) send_deal_message does not return a raw RPC/DB error for a flagged message", !r1Err, r1Err?.message)
  check("broker's 1st contact-info message is flagged, not rejected", r1?.[0]?.is_invalid === true)

  const { data: lenderPeek } = await lender
    .from("messages").select("id").eq("chat_id", chatId).eq("content", "email me at broker@example.com")
  check("(1) recipient (lender) cannot SELECT the invalid message", (lenderPeek ?? []).length === 0)

  const lenderThread = ((await lender.rpc("my_chat_threads")).data ?? []).find((t) => t.chat_id === chatId)
  check("(2) invalid message is not the thread's last-message preview",
    lenderThread?.last_content !== "email me at broker@example.com")
  check("(2) invalid message does not bump the recipient's unread count", lenderThread?.unread === 0, String(lenderThread?.unread))

  // (2b) invalid messages must not bump deal_chats.updated_at (requirement 6, migration 83 review).
  const { data: chatAfterInvalid } = await svc.from("deal_chats").select("updated_at").eq("id", chatId).single()
  check("(2b) an invalid message does not update deal_chats.updated_at",
    chatAfterInvalid?.updated_at === chatRow.updated_at, `${chatRow.updated_at} -> ${chatAfterInvalid?.updated_at}`)

  // ── (3) recording is server-authoritative: this whole smoke never calls a "pre-check" of any kind —
  //     the violation exists purely because the RPC itself recorded it. ──
  const v1 = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("(3) the violation was recorded from the RPC call alone (no client pre-check exists any more)",
    (v1.data ?? []).length === 1, String(v1.data?.length))

  // ── (4) one message, several contact patterns, still exactly one violation ──
  const { data: r2, error: r2Err } = await broker.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id,
    p_content: "call 416-555-0199 or email broker@example.com or visit https://example.com",
    p_lender_id: lenderUser.id,
  })
  check("(4) send_deal_message does not return a raw RPC/DB error", !r2Err, r2Err?.message)
  check("multi-pattern message is flagged", r2?.[0]?.is_invalid === true)
  const v2 = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("(4) one message with multiple contact patterns is exactly ONE violation",
    (v2.data ?? []).length === 2, String(v2.data?.length))

  // ── (5) the 3rd violation within 30 days creates exactly one automatic 7-day suspension ──
  const { data: r3, error: r3Err } = await broker.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "text me at 6135550123", p_lender_id: lenderUser.id,
  })
  check("(5) send_deal_message does not return a raw RPC/DB error", !r3Err, r3Err?.message)
  check("3rd violation is flagged", r3?.[0]?.is_invalid === true)
  let suspensions = (await svc.from("broker_suspensions").select("*").eq("broker_id", brokerUser.id)).data
  check("(5) exactly one suspension exists after the 3rd violation", (suspensions ?? []).length === 1, String(suspensions?.length))
  const first = suspensions?.[0]
  const daysLeft = first ? (new Date(first.expires_at) - Date.now()) / 86_400_000 : 0
  check("(5) it is automatic and currently active", first?.is_automatic === true && first?.ended_at === null)
  check("(5) it expires ~7 days out", daysLeft > 6.9 && daysLeft < 7.1, String(daysLeft))

  // ── (6) 4th/5th violations during that active automatic suspension #1 are recorded but create NO
  // additional suspension. These rows are the ones the fresh-cycle correction (2026-09-04) exists to
  // exclude from the NEXT cycle's count — kept in this same flow (not a disconnected fixture) so the
  // test proves the real scenario: real suspension #1, real during-suspension violations.
  const { data: r4 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "4165550100", p_lender_id: lenderUser.id })
  const { data: r5 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "4165550101", p_lender_id: lenderUser.id })
  check("violations 4/5 sent during the active suspension are flagged", r4?.[0]?.is_invalid === true && r5?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)).data
  check("(6) violations during suspension #1 create no additional automatic suspension", (suspensions ?? []).length === 1, String(suspensions?.length))
  const v5count = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("all 5 violations so far were individually recorded", (v5count.data ?? []).length === 5, String(v5count.data?.length))

  // ── (6b) Suspension #1 ends; violations 4/5 (recorded DURING it) must NOT count toward cycle #2
  // (2026-09-04 correction: the anchor is the effective END of the most recent automatic suspension —
  // coalesce(ended_at, expires_at) — not its START). Simulated by backdating suspension #1's OWN
  // expires_at, rather than deleting it and inserting a disconnected synthetic row, so this is the same
  // suspension #1 created above and the same violations 4/5 recorded above.
  //
  // The backdated expires_at must land strictly AFTER violation 5's actual created_at (send_deal_message
  // returns the DB-inserted row directly, so this is the database's own timestamp, not the test script's
  // clock — immune to clock skew) but the check that follows must run at a real wall-clock moment
  // strictly AFTER that backdated expires_at — hence the short sleep.
  const effectiveEnd = new Date(new Date(r5[0].created_at).getTime() + 1000).toISOString()
  await svc.from("broker_suspensions").update({ expires_at: effectiveEnd }).eq("id", first.id)
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const { data: rPost1 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135551234", p_lender_id: lenderUser.id })
  check("1st violation after release is flagged", rPost1?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)).data
  check("(fresh cycle) violations 4/5 during suspension #1 do NOT count — 1st post-release violation alone does not re-suspend",
    (suspensions ?? []).length === 1, String(suspensions?.length))

  const { data: rPost2 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135551235", p_lender_id: lenderUser.id })
  check("2nd violation after release is flagged", rPost2?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)).data
  check("(fresh cycle) 2nd post-release violation (strike 2 of the new cycle) still does not re-suspend",
    (suspensions ?? []).length === 1, String(suspensions?.length))

  const { data: rPost3 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135551236", p_lender_id: lenderUser.id })
  check("3rd violation after release is flagged", rPost3?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("*").eq("broker_id", brokerUser.id).order("starts_at")).data
  check("(fresh cycle) 3rd post-release violation (strike 3 of the new cycle) creates automatic suspension #2",
    (suspensions ?? []).length === 2, String(suspensions?.length))
  const second = suspensions?.[1]
  const secondDaysLeft = second ? (new Date(second.expires_at) - Date.now()) / 86_400_000 : 0
  check("suspension #2 is automatic, freshly started, and ~7 days out from NOW",
    second?.is_automatic === true && second?.ended_at === null && secondDaysLeft > 6.9 && secondDaysLeft < 7.1, String(secondDaysLeft))

  const allViolations1 = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("all 8 violations remain permanently recorded (3 original + 2 during-suspension + 3 fresh)",
    (allViolations1.data ?? []).length === 8, String(allViolations1.data?.length))

  const { data: adminDetail1 } = await admin.rpc("admin_broker_enforcement_detail", { p_broker_id: brokerUser.id })
  check("admin sees all 8 violations and both suspensions via the enforcement detail RPC",
    adminDetail1?.violations?.length === 8 && adminDetail1?.suspensions?.length === 2,
    `violations=${adminDetail1?.violations?.length} suspensions=${adminDetail1?.suspensions?.length}`)

  // ── (6c) Manually-ended-early behavior: the new cycle must anchor on the ADMIN's actual early
  // ended_at, not suspension #2's originally-scheduled ~7-day expires_at. Proven by ending suspension #2
  // right now and showing 3 fresh violations sent immediately after (not 7 days later) create suspension
  // #3 without delay — that would be impossible if the anchor were still the unexpired expires_at.
  const { error: endEarlyErr } = await admin.rpc("admin_end_suspension", { p_suspension_id: second.id })
  check("admin can end suspension #2 early", !endEarlyErr, endEarlyErr?.message)
  const { data: endedRow } = await svc.from("broker_suspensions").select("ended_at, expires_at").eq("id", second.id).single()
  check("suspension #2's ended_at is now set and predates its original expires_at",
    !!endedRow?.ended_at && new Date(endedRow.ended_at) < new Date(endedRow.expires_at))

  const { data: r10 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135559001", p_lender_id: lenderUser.id })
  const { data: r11 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135559002", p_lender_id: lenderUser.id })
  const { data: r12 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135559003", p_lender_id: lenderUser.id })
  check("3 violations sent right after the early end are all flagged",
    [r10, r11, r12].every((r) => r?.[0]?.is_invalid === true))
  suspensions = (await svc.from("broker_suspensions").select("*").eq("broker_id", brokerUser.id).order("starts_at")).data
  check("(early-end anchor) a 3rd automatic suspension is created immediately — proving the anchor is the early ended_at, not the original 7-day expires_at",
    (suspensions ?? []).length === 3, String(suspensions?.length))

  const allViolations2 = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("all 11 violations remain permanently recorded across every cycle",
    (allViolations2.data ?? []).length === 11, String(allViolations2.data?.length))

  // ── (7) & (8): suspended -> cannot submit NEW, but drafting + existing submitted deals still work ──
  await svc.from("deals").delete().eq("deal_number", "TEST-ENF-DRAFT")
  const { data: draftDeal, error: draftErr } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft", province: "ontario", loan_amount: 200000,
  }).select("id").single()
  check("(8) a suspended broker can still create a draft", !draftErr && !!draftDeal, draftErr?.message)

  const { error: submitErr } = await broker.rpc("submit_deal", { p_deal_id: draftDeal.id })
  check("(7) a suspended broker CANNOT submit a new deal", !!submitErr, submitErr?.message)

  const { data: r6, error: msgOnExistingErr } = await broker.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "still working on your file", p_lender_id: lenderUser.id,
  })
  check("(8) a suspended broker can still message on an already-submitted deal",
    !msgOnExistingErr && r6?.[0]?.is_invalid === false, msgOnExistingErr?.message)

  // ── (9) once unsuspended, submit_deal behaves exactly as before ──
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)
  await svc.from("deals").delete().eq("deal_number", "TEST-ENF-DRAFT-2")
  const { data: draftDeal2 } = await broker.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, status: "draft", province: "ontario", loan_amount: 210000,
  }).select("id").single()
  const { error: submit2Err } = await broker.rpc("submit_deal", { p_deal_id: draftDeal2.id })
  check("(9) once unsuspended, submit_deal works normally again", !submit2Err, submit2Err?.message)

  // ── (10) a soft-deleted account is blocked from consequential RPCs even on an already-valid session ──
  const tempBrokerId = await freshBroker("enf.temp.broker@loanlink.test", bp.brokerage_id)
  const tempBroker = await clientFor("enf.temp.broker@loanlink.test") // session obtained BEFORE deletion
  const { error: draft3Err, data: tempDraft } = await tempBroker.from("deals").insert({
    broker_id: tempBrokerId, brokerage_id: bp.brokerage_id, status: "draft", province: "ontario", loan_amount: 150000,
  }).select("id").single()
  check("temp broker can draft before being deleted", !draft3Err, draft3Err?.message)

  const { error: adminDeleteErr } = await admin.rpc("admin_soft_delete_broker", { p_broker_id: tempBrokerId, p_reason: "smoke test" })
  check("admin can soft-delete a broker", !adminDeleteErr, adminDeleteErr?.message)
  const { data: deletedProfile } = await svc.from("profiles").select("is_deleted, deletion_reason").eq("id", tempBrokerId).single()
  check("is_deleted + deletion_reason are set", deletedProfile?.is_deleted === true && deletedProfile?.deletion_reason === "smoke test")

  const { error: submitAfterDeleteErr } = await tempBroker.rpc("submit_deal", { p_deal_id: tempDraft.id })
  check("(10) the SAME still-valid session cannot submit_deal after being marked deleted", !!submitAfterDeleteErr, submitAfterDeleteErr?.message)
  // Strengthened (2026-09-04 review): assert the SPECIFIC deleted-account rejection, not just "some
  // error" — tempBroker isn't even this deal's broker, so an unrelated ownership/status failure could
  // otherwise make this check pass for the wrong reason. is_currently_deleted() is checked before
  // ownership in both RPCs, so this pins the actual guard that fired.
  check("(10) the submit_deal rejection is specifically the deleted-account guard, not an unrelated failure",
    !!submitAfterDeleteErr?.message?.toLowerCase().includes("deleted"), submitAfterDeleteErr?.message)
  const { error: msgAfterDeleteErr } = await tempBroker.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "hi", p_lender_id: lenderUser.id,
  })
  check("(10) the same session cannot send_deal_message after being marked deleted", !!msgAfterDeleteErr, msgAfterDeleteErr?.message)
  // tempBroker is not a participant on submittedDeal (it belongs to the main broker) — without pinning
  // the message text, this would also pass on the ownership/visibility error the lender-path branch
  // would otherwise raise, proving nothing about is_currently_deleted() specifically.
  check("(10) the send_deal_message rejection is specifically the deleted-account guard, not an unrelated failure",
    !!msgAfterDeleteErr?.message?.toLowerCase().includes("deleted"), msgAfterDeleteErr?.message)

  const { error: selfUndeleteErr } = await tempBroker.from("profiles").update({ is_deleted: false }).eq("id", tempBrokerId)
  check("a deleted broker cannot clear their own is_deleted flag (privilege guard)", !!selfUndeleteErr)

  // ── (11) non-admins cannot read broker emails/suspension/violation records or call admin RPCs ──
  const { data: dirAsLender, error: dirErr } = await lender.rpc("admin_broker_directory")
  check("(11) a non-admin gets no broker directory data", (!dirErr && (dirAsLender ?? []).length === 0) || !!dirErr)
  const { error: detailErr } = await lender.rpc("admin_broker_enforcement_detail", { p_broker_id: brokerUser.id })
  check("(11) a non-admin cannot call admin_broker_enforcement_detail", !!detailErr)
  const { error: suspendAsLenderErr } = await lender.rpc("admin_suspend_broker", { p_broker_id: brokerUser.id, p_days: 1, p_reason: "x" })
  check("(11) a non-admin cannot call admin_suspend_broker", !!suspendAsLenderErr)
  const { error: deleteAsLenderErr } = await lender.rpc("admin_soft_delete_broker", { p_broker_id: brokerUser.id, p_reason: "x" })
  check("(11) a non-admin cannot call admin_soft_delete_broker", !!deleteAsLenderErr)
  const { data: susSelect } = await lender.from("broker_suspensions").select("id")
  check("(11) a non-admin cannot SELECT broker_suspensions directly", (susSelect ?? []).length === 0)
  const { data: violSelect } = await lender.from("broker_contact_violations").select("id")
  check("(11) a non-admin cannot SELECT broker_contact_violations directly", (violSelect ?? []).length === 0)

  const { data: dirAsAdmin, error: dirAdminErr } = await admin.rpc("admin_broker_directory")
  const brokerRow = (dirAsAdmin ?? []).find((b) => b.id === brokerUser.id)
  check("an admin CAN read the directory including email", !dirAdminErr && !!brokerRow?.email, dirAdminErr?.message)

  // is_auth_banned (2026-09-04 review, follow-up): reads the REAL Auth ban state (auth.users.banned_until),
  // not a guessed/derived DB flag. tempBroker above was only soft-deleted via the RPC directly — the
  // Auth ban itself is the delete-broker edge function's job, never invoked in this smoke (needs
  // `pnpm functions:serve` + a live Admin API, same carve-out as smoke-invoice-pdf) — so this is exactly
  // the "DB says deleted, Auth says not banned" partial-failure state the Admin Brokers UI now has to
  // detect and offer a retry for, and it must come back false here, not true.
  const tempRow = (dirAsAdmin ?? []).find((b) => b.id === tempBrokerId)
  check("(bonus) is_auth_banned correctly reads FALSE for a broker that was only soft-deleted at the DB layer, never actually Auth-banned",
    tempRow?.is_deleted === true && tempRow?.is_auth_banned === false, JSON.stringify(tempRow))

  // ── (12) an UNAUTHENTICATED caller cannot submit_deal, even knowing a real draft's UUID (2026-09-04
  // fix: submit_deal never had an explicit auth.uid() is null guard, so `d.broker_id <> auth.uid()`
  // silently no-op'd for an anon caller — three-valued NULL logic, not a raised exception). This client
  // never signs in at all — no email/password, no session — genuinely anonymous, same as anyone holding
  // only the public anon key.
  await svc.from("deals").delete().eq("deal_number", "TEST-ENF-ANON-DRAFT")
  const { data: anonTargetDraft } = await svc.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: "TEST-ENF-ANON-DRAFT",
    status: "draft", province: "ontario", loan_amount: 180000,
  }).select("id").single()

  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: anonSubmitErr } = await anonClient.rpc("submit_deal", { p_deal_id: anonTargetDraft.id })
  check("(12) an unauthenticated caller cannot submit_deal", !!anonSubmitErr, anonSubmitErr?.message)
  check("(12) the error is specifically the new auth guard, not some other failure",
    !!anonSubmitErr?.message?.toLowerCase().includes("not authenticated"), anonSubmitErr?.message)
  const { data: stillDraft } = await svc.from("deals").select("status").eq("id", anonTargetDraft.id).single()
  check("(12) the deal was NOT submitted", stillDraft?.status === "draft", stillDraft?.status)

  // ── (13) A MANUAL suspension does not anchor or reset the automatic 3-strike cycle (2026-09-04
  // review, item B). Clean slate for this sub-scenario only — the earlier sections already proved the
  // full during-suspension/no-reset history; this isolates the manual-vs-automatic interaction alone.
  await svc.from("broker_contact_violations").delete().eq("broker_id", brokerUser.id)
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)

  const { error: manualErr } = await admin.rpc("admin_suspend_broker", {
    p_broker_id: brokerUser.id, p_days: 5, p_reason: "manual suspension for smoke test",
  })
  check("(13) admin can create a manual suspension", !manualErr, manualErr?.message)
  suspensions = (await svc.from("broker_suspensions").select("*").eq("broker_id", brokerUser.id)).data
  check("(13) exactly one suspension exists and it is manual",
    (suspensions ?? []).length === 1 && suspensions[0].is_automatic === false, JSON.stringify(suspensions))

  const { data: m1 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135552001", p_lender_id: lenderUser.id })
  const { data: m2 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135552002", p_lender_id: lenderUser.id })
  const { data: m3 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135552003", p_lender_id: lenderUser.id })
  check("(13) 3 violations while only a MANUAL suspension is active are all flagged",
    [m1, m2, m3].every((r) => r?.[0]?.is_invalid === true))
  suspensions = (await svc.from("broker_suspensions").select("*").eq("broker_id", brokerUser.id).order("starts_at")).data
  check("(13) an active MANUAL suspension neither blocks a new AUTOMATIC one nor anchors/resets its strike count — 3 fresh violations still trigger it",
    (suspensions ?? []).length === 2 && suspensions.some((s) => s.is_automatic === true), JSON.stringify(suspensions))

  // ── (14) Rolling 30-day window: violations older than 30 days never count toward a NEW automatic
  // suspension (2026-09-04 review, item C). Two synthetic violations backdated past 30 days, then 3
  // fresh ones — if the old ones counted, the suspension would fire on the very FIRST fresh violation
  // (2 old + 1 fresh = 3); it must instead take all 3 fresh ones.
  await svc.from("broker_contact_violations").delete().eq("broker_id", brokerUser.id)
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)

  await svc.from("broker_contact_violations").insert([
    { broker_id: brokerUser.id, created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() },
    { broker_id: brokerUser.id, created_at: new Date(Date.now() - 35 * 86_400_000).toISOString() },
  ])
  const { data: f1 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135553001", p_lender_id: lenderUser.id })
  check("(14) 1st fresh violation is flagged", f1?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)).data
  check("(14) 2 violations older than 30 days plus 1 fresh one do NOT trigger a suspension — the old ones don't count",
    (suspensions ?? []).length === 0, String(suspensions?.length))

  await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135553002", p_lender_id: lenderUser.id })
  const { data: f3 } = await broker.rpc("send_deal_message", { p_deal_id: submittedDeal.id, p_content: "6135553003", p_lender_id: lenderUser.id })
  check("(14) 3rd fresh violation is flagged", f3?.[0]?.is_invalid === true)
  suspensions = (await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)).data
  check("(14) 3 violations WITHIN the rolling 30 days do trigger a suspension",
    (suspensions ?? []).length === 1, String(suspensions?.length))

  // ── (15) admin_suspend_broker input validation (2026-09-04 review, item D) ──
  const { error: zeroDaysErr } = await admin.rpc("admin_suspend_broker", { p_broker_id: brokerUser.id, p_days: 0, p_reason: "x" })
  check("(15) admin_suspend_broker rejects 0 days", !!zeroDaysErr, zeroDaysErr?.message)
  const { error: negDaysErr } = await admin.rpc("admin_suspend_broker", { p_broker_id: brokerUser.id, p_days: -3, p_reason: "x" })
  check("(15) admin_suspend_broker rejects negative days", !!negDaysErr, negDaysErr?.message)
  const { error: blankReasonErr } = await admin.rpc("admin_suspend_broker", { p_broker_id: brokerUser.id, p_days: 5, p_reason: "" })
  check("(15) admin_suspend_broker rejects a blank reason", !!blankReasonErr, blankReasonErr?.message)
  const { error: whitespaceReasonErr } = await admin.rpc("admin_suspend_broker", { p_broker_id: brokerUser.id, p_days: 5, p_reason: "   " })
  check("(15) admin_suspend_broker rejects a whitespace-only reason", !!whitespaceReasonErr, whitespaceReasonErr?.message)

  // ── (16) admin_end_suspension guards (2026-09-04 review, item E) ──
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)
  const { data: endTestSus } = await svc.from("broker_suspensions").insert({
    broker_id: brokerUser.id, reason: "for admin_end_suspension guard test", is_automatic: false,
    starts_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  }).select("id").single()
  const { error: firstEndErr } = await admin.rpc("admin_end_suspension", { p_suspension_id: endTestSus.id })
  check("(16) admin can end an active suspension", !firstEndErr, firstEndErr?.message)
  const { error: secondEndErr } = await admin.rpc("admin_end_suspension", { p_suspension_id: endTestSus.id })
  check("(16) admin_end_suspension rejects ending an ALREADY-ended suspension", !!secondEndErr, secondEndErr?.message)

  const { data: expiredSus } = await svc.from("broker_suspensions").insert({
    broker_id: brokerUser.id, reason: "already expired, for guard test", is_automatic: false,
    starts_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    expires_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
  }).select("id").single()
  const { error: expiredEndErr } = await admin.rpc("admin_end_suspension", { p_suspension_id: expiredSus.id })
  check("(16) admin_end_suspension rejects a suspension that has ALREADY naturally expired", !!expiredEndErr, expiredEndErr?.message)

  // ── (17) an UNAUTHENTICATED caller cannot call convert_prequal_to_live (2026-09-04 review, item F —
  // the same anonymous-bypass bug class found and fixed on submit_deal, now also fixed here). Reuses
  // the same genuinely-anonymous anonClient from check (12) — no sign-in call at all. ──
  await svc.from("deals").delete().eq("deal_number", "TEST-ENF-PREQUAL")
  const { data: prequalDeal } = await svc.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: "TEST-ENF-PREQUAL",
    status: "submitted", province: "ontario", loan_amount: 275000, prequal: true, submitted_at: new Date().toISOString(),
  }).select("id, prequal, closing_date").single()

  const { error: anonConvertErr } = await anonClient.rpc("convert_prequal_to_live", {
    p_deal_id: prequalDeal.id, p_property_address: "123 Anonymous St", p_closing_date: "2026-12-01",
  })
  check("(17) an unauthenticated caller cannot call convert_prequal_to_live", !!anonConvertErr, anonConvertErr?.message)
  check("(17) the error is specifically the new auth guard, not some other failure",
    !!anonConvertErr?.message?.toLowerCase().includes("not authenticated"), anonConvertErr?.message)
  const { data: stillPrequal } = await svc.from("deals").select("prequal, closing_date").eq("id", prequalDeal.id).single()
  check("(17) the prequal was NOT converted — prequal flag and closing date are unchanged",
    stillPrequal?.prequal === true && stillPrequal?.closing_date === null, JSON.stringify(stillPrequal))
  const { data: noIdentity } = await svc.from("deal_identities").select("property_address").eq("deal_id", prequalDeal.id).maybeSingle()
  check("(17) no property address was written for this deal", !noIdentity?.property_address, JSON.stringify(noIdentity))

  // ── (18) A LENDER's contact-info attempt is blocked too (pre-acceptance) and logged for audit, but
  // never counts toward the broker automatic-suspension system — only broker-sent violations do
  // (migration 83 review: both parties are restricted before acceptance; strikes are broker-only). ──
  await svc.from("broker_contact_violations").delete().eq("broker_id", brokerUser.id)
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)
  const alertsBefore18 = await svc.from("admin_alerts").select("id").eq("source", "chat_message")

  const { data: r18, error: r18Err } = await lender.rpc("send_deal_message", {
    p_deal_id: submittedDeal.id, p_content: "call me at 6135557890",
  })
  check("(18) send_deal_message does not return a raw RPC/DB error for a lender's flagged message", !r18Err, r18Err?.message)
  check("(18) a lender's contact-info attempt is flagged too", r18?.[0]?.is_invalid === true)

  const { data: brokerPeek18 } = await broker
    .from("messages").select("id").eq("chat_id", chatId).eq("content", "call me at 6135557890")
  check("(18) the recipient (broker) cannot SELECT the lender's flagged message", (brokerPeek18 ?? []).length === 0)

  const brokerThread18 = ((await broker.rpc("my_chat_threads")).data ?? []).find((t) => t.chat_id === chatId)
  check("(18) the lender's flagged message is neither the broker's preview nor an unread bump",
    brokerThread18?.last_content !== "call me at 6135557890" && brokerThread18?.unread === 0,
    JSON.stringify(brokerThread18))

  const alertsAfter18 = await svc.from("admin_alerts").select("id").eq("source", "chat_message")
  check("(18) the lender's attempt IS still recorded in admin_alerts for audit",
    (alertsAfter18.data?.length ?? 0) > (alertsBefore18.data?.length ?? 0))

  const violAfter18 = await svc.from("broker_contact_violations").select("id").eq("broker_id", brokerUser.id)
  check("(18) a LENDER's attempt never creates a broker_contact_violations row",
    (violAfter18.data ?? []).length === 0, String(violAfter18.data?.length))
  const susAfter18 = await svc.from("broker_suspensions").select("id").eq("broker_id", brokerUser.id)
  check("(18) a LENDER's attempt never creates or triggers a broker suspension",
    (susAfter18.data ?? []).length === 0, String(susAfter18.data?.length))

  // ── (19) Post-acceptance exemption (migration 83 — confirmed entirely missing before this fix, no
  // prior coverage anywhere in this suite). Once a lender's offer is ACCEPTED, identifying/contact
  // info becomes permitted in THAT specific broker/lender conversation — but a DIFFERENT lender's
  // thread on the SAME deal, whose offer was NOT accepted, must remain fully restricted. ──
  await svc.from("deals").delete().eq("deal_number", "TEST-ENF-ACCEPT")
  const { data: acceptDeal } = await svc.from("deals").insert({
    // accept_offer() refuses any deal with a null closing_date (the "move prequal to live" gate) — this
    // must be a fully live-shaped deal, not a bare draft/prequal, or acceptance itself would fail here.
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: "TEST-ENF-ACCEPT", status: "submitted",
    province: "ontario", loan_amount: 300000, submitted_at: new Date().toISOString(),
    closing_date: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  }).select("id").single()

  // A second, independent lender (different institution, so the one-offer-per-institution rule never
  // interferes) proves the exemption is scoped to ONE conversation, not the whole deal.
  const { data: instRow } = await svc.from("lender_institutions").select("id").eq("name", "RFA").single()
  const { data: existingUsers19 } = await svc.auth.admin.listUsers()
  const stale19 = existingUsers19?.users.find((u) => u.email === "enf.lender2@loanlink.test")
  if (stale19) await svc.auth.admin.deleteUser(stale19.id)
  const { data: newLender2, error: lender2Err } = await svc.auth.admin.createUser({
    email: "enf.lender2@loanlink.test", password: PASSWORD, email_confirm: true,
    user_metadata: {
      role: "lender", first_name: "Enf", last_name: "LenderTwo",
      lender_institution_id: instRow?.id, tos_accepted: true, tos_version: "v1",
    },
  })
  if (lender2Err) throw new Error(`create enf.lender2: ${lender2Err.message}`)
  await svc.from("profiles").update({ is_approved: true, pending_approval: false }).eq("id", newLender2.user.id)
  const lender2 = await clientFor("enf.lender2@loanlink.test")

  // Both lenders open threads with the broker on this new deal, then each makes an offer.
  await lender.rpc("send_deal_message", { p_deal_id: acceptDeal.id, p_content: "Interested — will be the accepted lender." })
  await lender2.rpc("send_deal_message", { p_deal_id: acceptDeal.id, p_content: "Interested — will NOT be accepted." })

  const { data: offerA, error: offerAErr } = await lender.rpc("make_offer", {
    p_deal_id: acceptDeal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.29,
    p_rate_lock_days: 120, p_commission_bps: 85,
  })
  check("(19) lender A can make an offer", !offerAErr && !!offerA?.id, offerAErr?.message)
  const { data: offerB, error: offerBErr } = await lender2.rpc("make_offer", {
    p_deal_id: acceptDeal.id, p_mortgage_product: "3_year_fixed", p_rate: 4.5,
    p_rate_lock_days: 120, p_commission_bps: 90,
  })
  check("(19) lender B can make an offer", !offerBErr && !!offerB?.id, offerBErr?.message)

  const { data: accepted19, error: accept19Err } = await broker.rpc("accept_offer", { p_offer_id: offerA.id })
  check("(19) broker can accept lender A's offer", !accept19Err && accepted19?.status === "accepted", accept19Err?.message)

  // Accepted lender's conversation: identifying info is now PERMITTED.
  const { data: rAccepted, error: rAcceptedErr } = await lender.rpc("send_deal_message", {
    p_deal_id: acceptDeal.id, p_content: "Great — call me at 6135551212 to finalize.",
  })
  check("(19) send_deal_message does not error post-acceptance", !rAcceptedErr, rAcceptedErr?.message)
  check("(19) identifying info IS permitted on the ACCEPTED lender's conversation", rAccepted?.[0]?.is_invalid === false)

  // The OTHER (not-accepted) lender's conversation on the SAME deal: still fully restricted.
  const { data: rOther, error: rOtherErr } = await lender2.rpc("send_deal_message", {
    p_deal_id: acceptDeal.id, p_content: "Call me at 6135553434 anyway.",
  })
  check("(19) send_deal_message does not error for the non-accepted lender", !rOtherErr, rOtherErr?.message)
  check("(19) identifying info is STILL blocked on the NON-accepted lender's conversation on the same deal",
    rOther?.[0]?.is_invalid === true)

  // The broker replying on the accepted thread can also share identifying info now.
  const { data: rBrokerAccepted, error: rBrokerAcceptedErr } = await broker.rpc("send_deal_message", {
    p_deal_id: acceptDeal.id, p_content: "Sounds good, my direct line is 6135559999.", p_lender_id: lenderUser.id,
  })
  check("(19) send_deal_message does not error for the broker on the accepted thread", !rBrokerAcceptedErr, rBrokerAcceptedErr?.message)
  check("(19) the broker can also share identifying info on the accepted conversation",
    rBrokerAccepted?.[0]?.is_invalid === false)

  await svc.from("deals").delete().eq("id", acceptDeal.id)
  await svc.auth.admin.deleteUser(newLender2.user.id)

  // ── Cleanup ──
  await svc.from("broker_contact_violations").delete().eq("broker_id", brokerUser.id)
  await svc.from("broker_suspensions").delete().eq("broker_id", brokerUser.id)
  await svc.from("deals").delete().in("deal_number", [
    "TEST-ENF-1", "TEST-ENF-DRAFT", "TEST-ENF-DRAFT-2", "TEST-ENF-ANON-DRAFT", "TEST-ENF-PREQUAL",
  ])
  await svc.from("deals").delete().eq("id", draftDeal.id)
  await svc.from("deals").delete().eq("id", tempDraft.id)
  await svc.auth.admin.deleteUser(tempBrokerId)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
