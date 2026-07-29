/**
 * Smoke for the closing-survey flow: the cron job creates a survey + survey_pending notification for
 * a confirmed deal at its closing date; the broker lists and submits it (Q0 gates the rest); the
 * satisfaction requirement + broker-only gate are enforced.
 *   node scripts/seed-users.mjs && node scripts/smoke-offers.mjs && node scripts/smoke-surveys.mjs
 * (smoke-offers leaves a confirmed deal owned by broker@loanlink.test.)
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

async function main() {
  // A confirmed deal owned by the broker (smoke-offers leaves one).
  const { data: deal } = await svc
    .from("deals")
    .select("id, deal_number, broker_id, status")
    .not("accepted_offer_id", "is", null)
    .in("status", ["confirmed", "funded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!deal) {
    console.log("SKIP  no confirmed deal found — run smoke-offers.mjs first.")
    process.exit(0)
  }

  // Reset to a state the survey job will pick up: confirmed, closing in the past, no survey yet.
  await svc.from("surveys").delete().eq("deal_id", deal.id)
  await svc.from("deals").update({ status: "confirmed", closing_date: "2020-01-01" }).eq("id", deal.id)

  // 1. The cron job creates the survey + notification and funds the deal.
  const { error: jobErr } = await svc.rpc("job_trigger_closing_surveys")
  check("survey job runs", !jobErr, jobErr?.message)
  const { data: survey } = await svc
    .from("surveys")
    .select("id, deal_id, broker_id, lender_id, offer_id, lender_institution_id, is_completed")
    .eq("deal_id", deal.id)
    .maybeSingle()
  check("job created a survey for the deal", !!survey && survey.broker_id === deal.broker_id)
  check("survey carries lender + offer context", !!survey?.lender_id && !!survey?.offer_id && !!survey?.lender_institution_id)
  const { data: notif } = await svc
    .from("notifications")
    .select("id")
    .eq("deal_id", deal.id)
    .eq("type", "survey_pending")
  check("broker got a survey_pending notification", (notif?.length ?? 0) >= 1)
  const { data: dealAfter } = await svc.from("deals").select("status").eq("id", deal.id).single()
  check("deal is now funded", dealAfter?.status === "funded")

  // 2. Broker lists the pending survey (RLS surveys_broker) with lender institution name.
  const brokerEmail = (await svc.auth.admin.listUsers()).data?.users.find((u) => u.id === deal.broker_id)?.email
  const broker = await clientFor(brokerEmail)
  const { data: brokerView } = await broker
    .from("surveys")
    .select("id, is_completed, lender_institutions!surveys_lender_institution_id_fkey(name)")
    .eq("deal_id", deal.id)
    .single()
  check("broker sees their pending survey", !!brokerView && brokerView.is_completed === false)
  const inst = Array.isArray(brokerView?.lender_institutions) ? brokerView.lender_institutions[0] : brokerView?.lender_institutions
  check("survey exposes the (revealed) lender institution", !!inst?.name, inst?.name)

  // 3. A non-broker (lender) cannot submit the survey.
  const lender = await clientFor("lender@loanlink.test")
  const { error: lErr } = await lender.rpc("submit_survey", { p_survey_id: survey.id, p_closed_with_lender: true, p_satisfaction: 5 })
  check("a non-broker cannot submit the survey", !!lErr, lErr ? "(blocked)" : "submit unexpectedly succeeded")

  // 4. Satisfaction is required when the deal closed with the lender.
  const { error: vErr } = await broker.rpc("submit_survey", { p_survey_id: survey.id, p_closed_with_lender: true })
  check("satisfaction is required on the closed path", !!vErr, vErr ? "(rejected)" : "missing satisfaction accepted")

  // 5. Broker submits the completed survey (closed path).
  const { error: sErr } = await broker.rpc("submit_survey", {
    p_survey_id: survey.id,
    p_closed_with_lender: true,
    p_commitment_on_time: true,
    p_doc_review_on_time: false,
    p_funded_on_time: true,
    p_satisfaction: 4,
    p_comments: "Doc review dragged on but the lender was responsive.",
  })
  check("broker submits the survey", !sErr, sErr?.message)
  const { data: done } = await svc.from("surveys").select("*").eq("id", survey.id).single()
  check("survey is completed with the answers", done?.is_completed === true && done?.satisfaction === 4 && done?.closed_with_lender === true && done?.doc_review_on_time === false && !!done?.completed_at)
  // Client 2026-07-28 (B-3): free-text comments, admin-only.
  check("comments are stored on the closed path", done?.comments === "Doc review dragged on but the lender was responsive.", done?.comments)

  // 6. It can't be submitted twice.
  const { error: dErr } = await broker.rpc("submit_survey", { p_survey_id: survey.id, p_closed_with_lender: true, p_satisfaction: 1 })
  check("a completed survey cannot be resubmitted", !!dErr, dErr ? "(blocked)" : "resubmit unexpectedly succeeded")

  // 7. Q0 = false path (reset, then answer "did not close"): only the reason is recorded.
  await svc.from("surveys").update({ is_completed: false, satisfaction: null, closed_with_lender: null, completed_at: null, comments: null }).eq("id", survey.id)
  const { error: nErr } = await broker.rpc("submit_survey", {
    p_survey_id: survey.id,
    p_closed_with_lender: false,
    p_not_closed_reason: "Borrower went with another lender.",
  })
  check("broker submits the not-closed path", !nErr, nErr?.message)
  const { data: notClosed } = await svc.from("surveys").select("*").eq("id", survey.id).single()
  check("not-closed survey records only the reason", notClosed?.closed_with_lender === false && notClosed?.satisfaction === null && notClosed?.not_closed_reason === "Borrower went with another lender.")
  // Omitting p_comments must leave it null, not empty string — the report renders a dash on null.
  check("omitted comments stay null", notClosed?.comments === null, String(notClosed?.comments))

  // 8. Comments are admin-readable and never lender-readable (the lender is the one being rated).
  const { data: adminSees } = await (await clientFor("admin@loanlink.test"))
    .from("surveys").select("comments").eq("id", survey.id).maybeSingle()
  check("an admin can read survey comments", adminSees !== null, adminSees === null ? "no row" : "row visible")
  const { data: lenderSees } = await lender.from("surveys").select("comments").eq("id", survey.id)
  check("a lender cannot read the survey row", (lenderSees ?? []).length === 0, `${lenderSees?.length ?? 0} row(s)`)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
