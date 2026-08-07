/**
 * Smoke for the document name-match submit gate (client 2026-08-07, H-1, migration 65).
 *
 * The client uploaded random images to both document slots and was still able to create the deal —
 * correctly, because Round 3 Phase 3 specced the AI name-match as advisory. It now blocks. This smoke
 * pins the THREE-state rule, because two of the three states must keep passing and it would be easy to
 * "tighten" the gate into an outage:
 *
 *   name_matches = false            → REFUSED, and the message names which document to replace
 *   name_matches = true + variance  → ALLOWED (the client's own migration-46 rule: same person under a
 *                                     preferred name; both names then print on the invoice)
 *   name_matches IS NULL            → ALLOWED (unchecked / AI unavailable — fail-open, or an Anthropic
 *                                     outage would halt every submission on the platform)
 *
 * The flags are written with the service role because that is who writes them in production (the
 * `match-document-name` edge function stamps them after reading the file).
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-doc-name-gate.mjs
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
  if (!brokerId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  const broker = await signIn("broker@loanlink.test")

  const created = []

  /** A draft that is submittable in every respect except whatever the test does to its documents. */
  async function makeDraft() {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 480000, property_value: 600000, ltv: 80,
      mortgage_product: "5_year_fixed", province: "ontario", transaction_type: "prime",
      city: "Guelph", closing_date: new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10),
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    created.push(d.id)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Nadia", borrower_last_name: "Okonkwo",
      property_address: "18 Elmwood Cres",
    })
    await attachDealDocuments(broker, d.id)
    return d.id
  }

  /** Stamp a name-check outcome the way the edge function does. */
  async function stamp(dealId, kind, { matches, variance = false, name = null }) {
    const { error } = await svc.from("deal_documents").update({
      name_matches: matches, name_variance: variance, extracted_name: name,
      checked_at: new Date().toISOString(),
    }).eq("deal_id", dealId).eq("kind", kind)
    if (error) throw new Error(`stamp ${kind}: ${error.message}`)
  }

  const submit = async (dealId) => (await broker.rpc("submit_deal", { p_deal_id: dealId })).error

  try {
    // ── 1. Unchecked documents still submit (fail-open is deliberate, see the header) ──
    const unchecked = await makeDraft()
    check("submit ALLOWED with unchecked documents (fail-open)", !(await submit(unchecked)))

    // ── 2. A mismatched photo ID blocks, and says which document ──
    const badId = await makeDraft()
    await stamp(badId, "photo_id", { matches: false, name: "Gregory Vance" })
    const idErr = await submit(badId)
    check("submit REFUSED: photo ID is a different person", !!idErr, idErr?.message)
    check("the refusal names the photo ID", /photo id/i.test(idErr?.message ?? ""), idErr?.message)

    // ── 3. A mismatched consent form blocks too, and names THAT document ──
    const badConsent = await makeDraft()
    await stamp(badConsent, "consent", { matches: false, name: "Gregory Vance" })
    const consentErr = await submit(badConsent)
    check("submit REFUSED: consent form is a different person", !!consentErr, consentErr?.message)
    check("the refusal names the consent form", /consent form/i.test(consentErr?.message ?? ""), consentErr?.message)

    // ── 4. Replacing the bad document unblocks it (the broker's recourse is re-upload) ──
    await stamp(badId, "photo_id", { matches: true, name: "Nadia Okonkwo" })
    check("submit ALLOWED once the document matches", !(await submit(badId)))

    // ── 5. A preferred-name variance must NOT block (client rule, migration 46) ──
    const variance = await makeDraft()
    await stamp(variance, "photo_id", { matches: true, variance: true, name: "Nadine Okonkwo" })
    const varErr = await submit(variance)
    check("submit ALLOWED on a preferred-name variance", !varErr, varErr?.message)
    const { data: vRow } = await svc.from("deals").select("status").eq("id", variance).single()
    check("the variance deal really did submit", vRow?.status === "submitted", vRow?.status)

    // ── 6. Both documents mismatched → still one clear refusal, photo ID named first ──
    const bothBad = await makeDraft()
    await stamp(bothBad, "photo_id", { matches: false, name: "A B" })
    await stamp(bothBad, "consent", { matches: false, name: "C D" })
    const bothErr = await submit(bothBad)
    check("submit REFUSED when both documents mismatch", !!bothErr, bothErr?.message)
    check("photo ID is the one named", /photo id/i.test(bothErr?.message ?? ""), bothErr?.message)
  } finally {
    for (const id of created) await svc.from("deals").delete().eq("id", id)
  }

  console.log(failures === 0 ? "\nAll document name-gate checks passed." : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
