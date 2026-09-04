/**
 * Smoke for broker↔lender messaging: send_deal_message, the my_chat_threads inbox (deal context,
 * per-deal lender ordinals, unread), read-tracking, anti-contact block, and participant-only RLS.
 *   node scripts/seed-users.mjs && node scripts/smoke-messages.mjs
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
async function idByName(t, n) { return (await svc.from(t).select("id").eq("name", n).single()).data?.id }
async function freshApprovedLender(email, inst) {
  const { data: list } = await svc.auth.admin.listUsers()
  const ex = list?.users.find((u) => u.email === email)
  if (ex) await svc.auth.admin.deleteUser(ex.id)
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role: "lender", first_name: "Lee", last_name: "Two", lender_institution_id: await idByName("lender_institutions", inst), tos_accepted: true, tos_version: "v1" },
  })
  if (error) throw new Error(`create ${email}: ${error.message}`)
  await svc.from("profiles").update({ is_approved: true, pending_approval: false }).eq("id", data.user.id)
  return data.user.id
}
const threadFor = async (c, dealNumber) =>
  ((await c.rpc("my_chat_threads")).data ?? []).filter((t) => t.deal_number === dealNumber)

async function main() {
  const broker = await clientFor("broker@loanlink.test")
  const lender = await clientFor("lender@loanlink.test")
  const { data: { user: brokerUser } } = await broker.auth.getUser()
  const { data: bp } = await broker.from("profiles").select("brokerage_id").eq("id", brokerUser.id).single()

  await svc.from("deals").delete().eq("deal_number", "TEST-MSG-1")
  const { data: deal } = await svc.from("deals").insert({
    broker_id: brokerUser.id, brokerage_id: bp.brokerage_id, deal_number: "TEST-MSG-1", status: "submitted",
    province: "ontario", loan_amount: 400000, submitted_at: new Date().toISOString(),
  }).select("id").single()

  const l2 = await freshApprovedLender("msg.lender2@loanlink.test", "RFA")
  const lender2 = await clientFor("msg.lender2@loanlink.test")

  // 1. Lender initiates a thread.
  const { error: sendErr } = await lender.rpc("send_deal_message", { p_deal_id: deal.id, p_content: "Hi, interested in this deal." })
  check("lender can send a first message (creates thread)", !sendErr, sendErr?.message)

  // 2. Broker inbox shows the thread with deal context + unread.
  let bThreads = await threadFor(broker, "TEST-MSG-1")
  check("broker inbox shows the thread", bThreads.length === 1)
  check("thread carries the deal number + i_am_broker", bThreads[0]?.deal_number === "TEST-MSG-1" && bThreads[0]?.i_am_broker === true)
  check("broker sees it as unread", bThreads[0]?.unread === 1, String(bThreads[0]?.unread))
  check("last message preview is present", bThreads[0]?.last_content === "Hi, interested in this deal.")

  // 3. Broker reads the message (participant RLS) and replies.
  const chatId = bThreads[0].chat_id
  const { data: chatRow } = await broker.from("deal_chats").select("lender_id").eq("id", chatId).single()
  const { error: replyErr } = await broker.rpc("send_deal_message", { p_deal_id: deal.id, p_content: "Thanks — tell me more.", p_lender_id: chatRow.lender_id })
  check("broker can reply to the lender's thread", !replyErr, replyErr?.message)
  const { data: msgs } = await broker.from("messages").select("content, sender_role").eq("chat_id", chatId).order("created_at")
  check("thread has both messages in order", msgs?.length === 2 && msgs[0].sender_role === "lender" && msgs[1].sender_role === "broker")

  // 4. Lender sees the reply as unread, counterparty = Broker (ordinal 1).
  const lThreads = await threadFor(lender, "TEST-MSG-1")
  check("lender inbox shows their thread (not broker)", lThreads.length === 1 && lThreads[0].i_am_broker === false)
  check("lender ordinal is 1 (single broker thread)", lThreads[0]?.counterparty_ordinal === 1)
  check("lender sees the broker reply as unread", lThreads[0]?.unread === 1)

  // 5. A second lender messages the same deal → broker gets a distinct thread (ordinal 2).
  await lender2.rpc("send_deal_message", { p_deal_id: deal.id, p_content: "Also interested." })
  bThreads = await threadFor(broker, "TEST-MSG-1")
  const ordinals = bThreads.map((t) => t.counterparty_ordinal).sort()
  check("broker now has two threads on the deal", bThreads.length === 2)
  check("the two lender threads have distinct ordinals 1 and 2", ordinals[0] === 1 && ordinals[1] === 2, ordinals.join(","))

  // 6. Round 4 (Option 2): anti-contact FLAGS a message with a phone number rather than rejecting the
  // write — the RPC call succeeds, but the row is marked is_invalid and must never reach the recipient.
  const { data: badResult, error: badErr } = await lender.rpc("send_deal_message", {
    p_deal_id: deal.id, p_content: "Call me at 416-555-0199",
  })
  check("a message with a phone number is accepted but flagged invalid", !badErr && badResult?.[0]?.is_invalid === true, badErr?.message)
  check("the RPC returns a block_reason describing what was flagged", !!badResult?.[0]?.block_reason)
  const { data: recipientPeek } = await broker
    .from("messages").select("id").eq("chat_id", chatId).eq("content", "Call me at 416-555-0199")
  check("the flagged message cannot be read by the recipient (broker)", (recipientPeek?.length ?? 0) === 0)

  // 7. mark_chat_read clears the broker's unread for that thread.
  await broker.rpc("mark_chat_read", { p_chat_id: chatId })
  bThreads = await threadFor(broker, "TEST-MSG-1")
  const t1 = bThreads.find((t) => t.chat_id === chatId)
  check("mark_chat_read clears unread", t1?.unread === 0, String(t1?.unread))

  // 8. Participant-only RLS: lender2 cannot read lender1's chat messages.
  const { data: peek } = await lender2.from("messages").select("id").eq("chat_id", chatId)
  check("a non-participant lender cannot read the thread", (peek?.length ?? 0) === 0)

  await svc.from("deals").delete().eq("deal_number", "TEST-MSG-1")
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
