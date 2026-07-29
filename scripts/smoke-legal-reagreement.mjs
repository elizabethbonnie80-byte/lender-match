/**
 * Smoke for the legal re-agreement prompt (client revision A-3; migration 61).
 *
 * The prompt itself is a modal (components/legal-reagreement-gate.tsx); what matters at the data layer is
 * that pending_legal_documents() goes non-empty exactly when an admin publishes a new version, empty once
 * the user accepts, and that the acceptance log cannot be forged or rewritten.
 *
 *   node scripts/seed-users.mjs && node scripts/seed-admin.mjs && node scripts/smoke-legal-reagreement.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { service, signIn, idByEmail, URL, ANON } from "./_demo-lib.mjs"

const svc = service()
let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

/** Fresh unauthenticated client, for the sign-up path (signIn() is for existing accounts). */
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false } })

async function deleteUserByEmail(email) {
  const { data } = await svc.auth.admin.listUsers()
  const u = data?.users.find((x) => x.email === email)
  if (u) await svc.auth.admin.deleteUser(u.id)
}

const newDocs = []
/** Terms rows this smoke unpublished, to be put back exactly as found. */
const restorePublished = []

async function main() {
  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const admin = await signIn("admin@loanlink.test")
  const brokerId = await idByEmail(svc, "broker@loanlink.test")

  const pendingFor = async (client) => (await client.rpc("pending_legal_documents")).data ?? []

  // ── Baseline ────────────────────────────────────────────────────────────────
  // Deliberately NOT asserting "starts empty": on a freshly reset local DB the migrations replay before
  // the seed runs, so the backfill has no users to backfill and the seeded accounts predate the seeded
  // legal documents. That is a legitimate state — and precisely the one the feature exists for. So bring
  // all three users up to date first, then test the cycle from a known baseline.
  for (const [who, client] of [["broker", broker], ["lender", lender], ["admin", admin]]) {
    const { error } = await client.rpc("accept_published_legal_documents")
    if (error) throw new Error(`baseline accept (${who}): ${error.message}`)
  }
  check("broker is up to date after accepting", (await pendingFor(broker)).length === 0,
    JSON.stringify(await pendingFor(broker)))
  const { count: logged } = await svc
    .from("legal_acceptances").select("id", { count: "exact", head: true }).eq("user_id", brokerId)
  check("the acceptance was logged", (logged ?? 0) > 0, `${logged} rows`)

  // ── Publishing a new version makes it pending for everyone ──────────────────
  // Take whatever terms rows are published right now and stand them down, remembering them so cleanup
  // restores exactly this state. Deliberately not assuming there is exactly one: smoke-admin exercises
  // the legal editor earlier in the suite, so the ambient count is not ours to depend on.
  const { data: publishedTerms } = await svc
    .from("legal_documents").select("id").eq("type", "terms_and_conditions").eq("is_published", true)
  restorePublished.push(...(publishedTerms ?? []).map((r) => r.id))
  if (restorePublished.length > 0) {
    await svc.from("legal_documents").update({ is_published: false }).in("id", restorePublished)
  }
  const { data: v99, error: pubErr } = await svc.from("legal_documents").insert({
    type: "terms_and_conditions", version: "99.0-smoke", content: "<p>Updated smoke terms.</p>",
    is_published: true,
  }).select("id, version").single()
  if (pubErr) throw new Error(`publish: ${pubErr.message}`)
  newDocs.push(v99.id)

  const brokerPending = await pendingFor(broker)
  check("the new version is pending for the broker", brokerPending.length === 1, JSON.stringify(brokerPending))
  check("it names the version the admin published", brokerPending[0]?.version === "99.0-smoke", brokerPending[0]?.version)
  check("the new version is pending for the lender too", (await pendingFor(lender)).length === 1)
  check("and for the admin", (await pendingFor(admin)).length === 1)

  // The privacy policy was NOT republished, so it must not be dragged into the prompt.
  check("only the changed document is pending",
    brokerPending.every((d) => d.doc_type === "terms_and_conditions"),
    JSON.stringify(brokerPending.map((d) => d.doc_type)))

  // ── Accepting clears it, and only for the accepting user ────────────────────
  const { data: n, error: accErr } = await broker.rpc("accept_published_legal_documents")
  check("broker accepts", !accErr, accErr?.message ?? `${n} row(s) written`)
  check("nothing pending for the broker afterwards", (await pendingFor(broker)).length === 0)
  check("the lender is still behind (acceptance is per user)", (await pendingFor(lender)).length === 1)

  // Idempotent, and it must not backdate or overwrite the original agreement.
  const { data: firstAt } = await svc
    .from("legal_acceptances").select("accepted_at").eq("user_id", brokerId).eq("legal_document_id", v99.id).single()
  const { data: n2 } = await broker.rpc("accept_published_legal_documents")
  check("re-accepting writes nothing", n2 === 0, `${n2} row(s)`)
  const { data: againAt } = await svc
    .from("legal_acceptances").select("accepted_at").eq("user_id", brokerId).eq("legal_document_id", v99.id).single()
  check("the original acceptance timestamp is preserved", firstAt.accepted_at === againAt.accepted_at)

  // ── The log is append-only and private ─────────────────────────────────────
  const { error: forgeErr } = await lender.from("legal_acceptances").insert({
    user_id: brokerId, legal_document_id: v99.id, doc_type: "terms_and_conditions", doc_version: "forged",
  })
  check("a user cannot record an acceptance for someone else", !!forgeErr, forgeErr?.message ?? "INSERT SUCCEEDED — leak")

  const { data: lenderReads } = await lender
    .from("legal_acceptances").select("id").eq("user_id", brokerId)
  check("a user cannot read another user's acceptances", (lenderReads ?? []).length === 0, `${lenderReads?.length ?? 0} rows`)

  const { data: adminReads } = await admin
    .from("legal_acceptances").select("id").eq("user_id", brokerId)
  check("an admin can read acceptances (oversight)", (adminReads ?? []).length > 0, `${adminReads?.length ?? 0} rows`)

  // With RLS on and no UPDATE/DELETE policy, the statement does not error — it simply matches no rows.
  // So assert the DATA, not the absence of an error: a "successful" no-op is the correct outcome, and
  // checking err alone would have reported a false failure here.
  await broker.from("legal_acceptances").update({ doc_version: "tampered" }).eq("user_id", brokerId)
  const { data: afterUpd } = await svc
    .from("legal_acceptances").select("doc_version").eq("user_id", brokerId).eq("legal_document_id", v99.id).single()
  check("nobody can amend an acceptance", afterUpd?.doc_version === "99.0-smoke", `version is now "${afterUpd?.doc_version}"`)

  await broker.from("legal_acceptances").delete().eq("user_id", brokerId).eq("legal_document_id", v99.id)
  const { count: stillThere } = await svc.from("legal_acceptances")
    .select("id", { count: "exact", head: true }).eq("user_id", brokerId).eq("legal_document_id", v99.id)
  check("nobody can erase an acceptance", (stillThere ?? 0) === 1, `${stillThere} row(s) left`)

  // ── A brand-new sign-up must NOT be prompted for terms it just ticked ───────
  // handle_new_user records the acceptance (migration 61) precisely so this cannot happen. Note this is
  // only true when a published document exists at sign-up time — which is the case here, since v99 is
  // live by now.
  const SIGNUP_EMAIL = "legalgate.broker@loanlink.test"
  await deleteUserByEmail(SIGNUP_EMAIL)
  const { data: brokerages } = await svc.from("brokerages").select("id").limit(1)
  const { data: signUp, error: suErr } = await anonClient().auth.signUp({
    email: SIGNUP_EMAIL,
    password: "Test1234!",
    options: {
      data: {
        role: "broker", first_name: "Gate", last_name: "Signup",
        brokerage_id: brokerages?.[0]?.id, tos_accepted: true, tos_version: "v1",
      },
    },
  })
  check("a new broker signs up", !suErr, suErr?.message)
  const newUserId = signUp?.user?.id
  const { count: signupRows } = await svc
    .from("legal_acceptances").select("id", { count: "exact", head: true }).eq("user_id", newUserId)
  check("the sign-up trigger logged the acceptance", (signupRows ?? 0) > 0, `${signupRows} rows`)
  const fresh = await signIn(SIGNUP_EMAIL)
  check("a brand-new user is NOT prompted to re-agree", (await pendingFor(fresh)).length === 0,
    JSON.stringify(await pendingFor(fresh)))
  await deleteUserByEmail(SIGNUP_EMAIL)

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  return failures === 0 ? 0 : 1
}

async function cleanup() {
  // Drop the smoke version (acceptances first — they FK to it), then republish exactly what was live.
  if (newDocs.length > 0) {
    await svc.from("legal_acceptances").delete().in("legal_document_id", newDocs)
    await svc.from("legal_documents").delete().in("id", newDocs)
  }
  if (restorePublished.length > 0) {
    await svc.from("legal_documents").update({ is_published: true }).in("id", restorePublished)
  }
}

main()
  .then(async (code) => { await cleanup(); process.exit(code) })
  .catch(async (e) => { console.error(e); await cleanup(); process.exit(1) })
