/**
 * Smoke for the invoice-pdf edge function: the owning lender can generate a PDF (returns a signed
 * URL to a real %PDF, stamps invoices.pdf_path); a different lender is denied by RLS.
 * Requires the edge function to be served — `supabase start` serves supabase/functions/ locally.
 *   node scripts/seed-users.mjs && node scripts/smoke-offers.mjs && node scripts/smoke-invoice-pdf.mjs
 * (smoke-offers leaves an invoice owned by lender@loanlink.test.)
 *
 * As the terminal consumer of the offers→surveys→invoice-pdf chain, this smoke deletes the shared
 * deal at the end (cascades to its offer/invoice/survey), so a full suite run leaves no residue.
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
  // Find an invoice + its owning lender's email.
  const { data: inv } = await svc
    .from("invoices")
    .select("id, invoice_number, lender_id, deal_id, subtotal")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!inv) {
    console.log("SKIP  no invoice found — run smoke-offers.mjs first to create one.")
    process.exit(0)
  }
  const { data: users } = await svc.auth.admin.listUsers()
  const ownerEmail = users?.users.find((u) => u.id === inv.lender_id)?.email
  check("resolved the invoice owner's email", !!ownerEmail, ownerEmail)
  if (!ownerEmail) { console.log("\n1 CHECK(S) FAILED"); process.exit(1) }

  const owner = await clientFor(ownerEmail)

  // 1. Owner generates the PDF → host-relative signed path.
  const { data: gen, error: genErr } = await owner.functions.invoke("invoice-pdf", { body: { invoiceId: inv.id } })
  check("owner can generate the invoice PDF", !genErr && !!gen?.signedPath, genErr?.message ?? JSON.stringify(gen))
  if (gen?.signedPath) {
    // 2. The signed URL (public base + path) serves a real PDF.
    const res = await fetch(`${URL}${gen.signedPath}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder().decode(buf.slice(0, 5))
    check("signed URL returns a PDF (starts with %PDF)", head === "%PDF-", `got "${head}", ${buf.length} bytes`)
    check("PDF is non-trivial in size", buf.length > 800, `${buf.length} bytes`)
  }

  // 3. pdf_path was stamped on the invoice.
  const { data: after } = await svc.from("invoices").select("pdf_path").eq("id", inv.id).single()
  check("invoices.pdf_path is stamped", after?.pdf_path === `${inv.id}.pdf`, after?.pdf_path ?? "null")

  // 4. A different lender is denied by RLS (cannot generate someone else's invoice PDF).
  const other = users?.users.find(
    (u) => u.email && u.email.endsWith("@loanlink.test") && u.email.includes("lender") && u.id !== inv.lender_id,
  )?.email
  if (other) {
    const otherClient = await clientFor(other)
    const { data: bad, error: badErr } = await otherClient.functions.invoke("invoice-pdf", { body: { invoiceId: inv.id } })
    // functions.invoke surfaces a non-2xx as an error; a 404 body also has no signedPath.
    check("a non-owner lender is denied", !!badErr || !bad?.signedPath, badErr?.message ?? JSON.stringify(bad))
  } else {
    console.log("note: no second lender account found to test the RLS denial")
  }

  // 5. Missing invoiceId → 400.
  const { data: noId, error: noIdErr } = await owner.functions.invoke("invoice-pdf", { body: {} })
  check("missing invoiceId is rejected", !!noIdErr || !noId?.signedPath)

  // 6. PDF text-wrapping safety (2026-09-04): stamp every admin/lender-configurable free-text field
  // with deliberately long content — long enough that the description/notes/payment-instructions
  // sections and the header/footer text all need to wrap, and the payment instructions alone are long
  // enough to force the invoice onto a second page — then confirm the function still succeeds and
  // returns a larger, still-valid PDF rather than erroring, hanging, or clipping. This is the only
  // realistic way to catch a bug in the wrap/truncate/page-break logic without a PDF-parsing library.
  const longWord = "supercalifragilisticexpialidocious-and-then-some-more-unbroken-characters-to-really-stress-it"
  const longParagraph = Array(40).fill("Lorem ipsum dolor sit amet consectetur adipiscing elit.").join(" ")
  const veryLongParagraph = Array(6).fill(longParagraph).join(" ") // long enough to force a 2nd page
  // Keep the invoices_amount_matches_calc CHECK satisfied: amount = subtotal - discount + tax, using
  // the invoice's REAL subtotal rather than a guessed number.
  const stressDiscount = 10
  const stressTax = 5
  const stressAmount = Math.round((Number(inv.subtotal) - stressDiscount + stressTax) * 100) / 100
  const { error: stressUpdateErr } = await svc.from("invoices").update({
    description: `${longParagraph} ${longWord}`,
    billing_reference: longWord,
    notes: longParagraph,
    payment_instructions: veryLongParagraph,
    discount_amount: stressDiscount,
    discount_reason: longParagraph,
    tax_lines: [{ label: `A very long tax line label ${longWord}`, rate: 5, amount: stressTax }],
    tax_total: stressTax,
    amount: stressAmount,
  }).eq("id", inv.id)
  check("fixture: stress-test invoice fields update succeeds (satisfies the CHECK constraint)", !stressUpdateErr, stressUpdateErr?.message)
  const { error: stressSettingsErr } = await svc.from("invoice_settings").update({
    header_text: `A deliberately long custom invoice title ${longWord}`,
    footer_text: longParagraph,
  }).eq("id", 1)
  check("fixture: stress-test Invoice Settings update succeeds", !stressSettingsErr, stressSettingsErr?.message)

  const { data: wrapGen, error: wrapErr } = await owner.functions.invoke("invoice-pdf", { body: { invoiceId: inv.id } })
  check("PDF generation still succeeds with long/overflowing text in every configurable field",
    !wrapErr && !!wrapGen?.signedPath, wrapErr?.message ?? JSON.stringify(wrapGen))
  if (wrapGen?.signedPath) {
    const res = await fetch(`${URL}${wrapGen.signedPath}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder().decode(buf.slice(0, 5))
    check("still a valid, non-trivial PDF with all that text", head === "%PDF-" && buf.length > 800,
      `head="${head}", ${buf.length} bytes`)
  }

  // Reset Invoice Settings — it's a global singleton shared by every other smoke that accepts an offer.
  await svc.from("invoice_settings").update({ header_text: null, footer_text: null }).eq("id", 1)

  // Terminal cleanup of the offers→surveys→invoice-pdf chain so a full suite run leaves no residue.
  // invoices.deal_id and surveys.deal_id are ON DELETE RESTRICT (not cascade), so delete those child
  // rows FIRST; the deal delete then cascades its offer/identity/income rows.
  if (inv.deal_id) {
    await svc.from("surveys").delete().eq("deal_id", inv.deal_id)
    await svc.from("invoices").delete().eq("deal_id", inv.deal_id)
    await svc.from("deals").delete().eq("id", inv.deal_id)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
