// LenderMatch — invoice PDF edge function.
//
// Renders the platform-fee invoice as a PDF, stores it in the private `invoices` Storage bucket
// (migration 20), stamps `invoices.pdf_path`, and returns a short-lived signed download URL.
//
// Why an edge function (not the client): PDF generation + Storage writes stay server-side (repo
// convention). Authorization is enforced by RLS — the invoice is fetched with the CALLER's JWT, so
// `invoices_lender` guarantees only that invoice's lender (or an admin) can generate/download it;
// the upload + pdf_path stamp then run with the service role.
//
// Runs locally as soon as `supabase start` serves supabase/functions/ (edge_runtime, config.toml).
// Deploy:  supabase functions deploy invoice-pdf   (SUPABASE_* secrets are injected automatically)

import { createClient } from "npm:@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const BUCKET = "invoices"
// Mirrors lib/brand.ts (can't import it — this is a separate Deno bundle). Round 3 rebrand: keep in sync.
const BRAND = "LenderMatch™"

// Round 3 — the LenderMatch node logo (public/favicon-96x96.png), inlined as base64 so this Deno
// bundle stays self-contained (no filesystem/network read at render time). Drawn in the PDF header
// next to the BRAND text; keep in sync with public/lendermatch-logo.png if the logo ever changes.
const LOGO_PNG_B64 =
  "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"
const LOGO_BYTES = Uint8Array.from(atob(LOGO_PNG_B64), (c) => c.charCodeAt(0))

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

type Deal = { deal_number: string | null; city: string | null; province: string | null }
type TaxLine = { label: string; rate: number; amount: number }
type Invoice = {
  id: string
  invoice_number: string
  loan_amount: number
  term_years: number | null
  mortgage_product: string
  platform_bps: number
  amount: number
  broker_name: string
  client_name: string
  document_name: string | null
  closing_date: string
  due_date: string
  status: string
  deals: Deal | Deal[] | null
  // Admin Invoice Management (2026-09-04)
  subtotal: number
  discount_amount: number
  discount_reason: string | null
  tax_lines: TaxLine[] | null
  tax_total: number
  description: string | null
  billing_reference: string | null
  notes: string | null
  payment_instructions: string | null
  revision_number: number
}

const money = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 })

async function renderInvoicePdf(inv: Invoice, settings: { header_text: string | null; footer_text: string | null }): Promise<Uint8Array> {
  const deal = Array.isArray(inv.deals) ? inv.deals[0] : inv.deals
  const doc = await PDFDocument.create()
  let page = doc.addPage([612, 792]) // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logoPng = await doc.embedPng(LOGO_BYTES)
  const ink = rgb(0.1, 0.12, 0.16)
  const muted = rgb(0.42, 0.45, 0.5)
  const brand = rgb(0.145, 0.388, 0.922) // #2563eb
  let y = 740
  const L = 56
  const TOP = 740
  const BOTTOM_MARGIN = 60 // keeps the footer clear even if a page break lands right above it

  const text = (s: string, x: number, yy: number, size = 11, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color })

  // Basic text wrapping for admin/lender-configurable free text (description, notes, payment
  // instructions, header/footer text) — greedy word-wrap, not a typesetting engine. A single word
  // wider than maxWidth (e.g. an unbroken URL) is left as its own line rather than broken mid-word;
  // proportional to what a fee invoice needs, not a general-purpose text layout system.
  function wrapText(s: string, maxWidth: number, size: number, f = font): string[] {
    const words = s.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ""
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w
      if (current && f.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current)
        current = w
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
    return lines.length ? lines : [""]
  }

  // For single-line fields living inside a fixed-width column (a meta row's value, a breakdown-box
  // label) where wrapping would require re-flowing the whole row/box layout — truncates with an
  // ellipsis instead. Still guarantees the content never overflows the printable width.
  function truncateToWidth(s: string, maxWidth: number, size: number, f = font): string {
    if (f.widthOfTextAtSize(s, size) <= maxWidth) return s
    let out = s
    while (out.length > 1 && f.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1)
    return `${out}…`
  }

  // Starts a fresh page when the next `needed` points of content wouldn't clear the bottom margin —
  // "handle that safely rather than clipping", not silently running text off the printable page.
  function ensureSpace(needed: number) {
    if (y - needed < BOTTOM_MARGIN) {
      page = doc.addPage([612, 792])
      y = TOP
    }
  }

  // Wraps `s` to `maxWidth` and draws it as however many lines it takes, page-breaking mid-paragraph
  // if needed. Advances `y` by the full block height.
  function drawWrapped(s: string, x: number, maxWidth: number, size: number, f = font, color = ink, lineHeight = size + 4) {
    for (const line of wrapText(s, maxWidth, size, f)) {
      ensureSpace(lineHeight)
      text(line, x, y, size, f, color)
      y -= lineHeight
    }
  }

  // Header — logo icon + brand wordmark (Round 3)
  const logoSize = 30
  const textX = L + logoSize + 10
  page.drawImage(logoPng, { x: L, y: y - 7, width: logoSize, height: logoSize })
  text(BRAND, textX, y, 22, bold, brand)
  // Admin Invoice Management (2026-09-04): the title wording is configurable via Invoice Settings
  // (header_text); falls back to the pre-existing hardcoded title when nothing is configured. Wrapped
  // (capped at 2 lines — this sits beside the wordmark, not a full paragraph) so a long custom title
  // can't run leftward into the brand text.
  const title = settings.header_text || "Platform Fee Invoice"
  const brandWidth = bold.widthOfTextAtSize(BRAND, 22)
  const titleMaxWidth = Math.max(612 - L - (textX + brandWidth + 20), 120)
  const titleLines = wrapText(title, titleMaxWidth, 12, bold).slice(0, 2)
  titleLines.forEach((line, i) => {
    text(line, 612 - L - bold.widthOfTextAtSize(line, 12), y + 4 - i * 13, 12, bold, muted)
  })
  // E-9 (client 2026-07-30): "Please remove 'Anonymous mortgage marketplace' from Invoices." The 9pt
  // tagline used to sit here, on its own line under the wordmark. Dropping it also drops that line's
  // 16pt, so the rule below moves up to keep the header from ending in a band of empty space — it still
  // clears the 30pt logo (drawn from y-7) by a comfortable margin. Extra 13pt only when the title
  // actually wrapped to a second line.
  y -= 34 + (titleLines.length > 1 ? 13 : 0)
  page.drawLine({ start: { x: L, y }, end: { x: 612 - L, y }, thickness: 1, color: rgb(0.9, 0.91, 0.93) })
  y -= 28

  // Meta (two columns). Truncates the value rather than wrapping — this is a fixed two-column layout,
  // and a genuinely long value (a borrower name, a billing reference) is rare enough that truncation is
  // the proportional fix; the full text is never lost, since the PDF isn't the record of truth.
  const ROW_VALUE_MAX_WIDTH = 612 - L - 16 - (L + 130)
  const row = (label: string, value: string) => {
    ensureSpace(22)
    text(label, L, y, 9, font, muted)
    text(truncateToWidth(value, ROW_VALUE_MAX_WIDTH, 11, bold), L + 130, y, 11, bold)
    y -= 22
  }
  // Admin Invoice Management (2026-09-04): a small "Revised" marker next to the invoice number rather
  // than a separate row — this is a fee invoice, not a legal amendment notice, so it stays understated.
  row(
    "Invoice #",
    inv.revision_number > 1 ? `${inv.invoice_number}   (Revised — rev. ${inv.revision_number})` : inv.invoice_number,
  )
  row("Deal", deal?.deal_number ?? "—")
  // ⚠️ The issue date is the invoice's `created_at`, NOT the render date. This function re-renders and
  // upserts the stored PDF on EVERY view, so `new Date()` here meant the same invoice showed a different
  // issue date each time anyone opened it — and an admin opening one would silently rewrite the file the
  // lender had already downloaded. Found while wiring the admin View action (client 2026-08-05).
  row("Issue date", String(inv.created_at).slice(0, 10))
  row("Closing date", inv.closing_date)
  row("Due date", inv.due_date)
  row("Status", inv.status.toUpperCase())
  if (inv.billing_reference) row("Billing ref.", inv.billing_reference)
  y -= 6
  page.drawLine({ start: { x: L, y }, end: { x: 612 - L, y }, thickness: 1, color: rgb(0.9, 0.91, 0.93) })
  y -= 28

  // Parties + deal facts
  row("Borrower", inv.client_name || "—")
  // Round 3 Phase 3: on a preferred-name variance, show the name as printed on the ID so the lender
  // can reconcile the identity against the borrower name entered on the deal.
  if (inv.document_name && inv.document_name !== inv.client_name) {
    row("Name on document", inv.document_name)
  }
  row("Broker", inv.broker_name || "—")
  const loc = [deal?.city, deal?.province].filter(Boolean).join(", ")
  row("Property", loc || "—")
  row("Product", inv.mortgage_product.replaceAll("_", " "))
  row("Term (years)", inv.term_years != null ? String(inv.term_years) : "—")
  row("Loan amount", money(inv.loan_amount))
  row("Platform rate", `${inv.platform_bps} bps`)
  y -= 6

  // Admin Invoice Management (2026-09-04): the editable line-item description, right above the fee
  // breakdown it describes. Falls back to the same implicit description every pre-migration invoice
  // had, so an old/never-edited invoice reads exactly as it always did.
  const description = inv.description || `Platform fee — Deal ${deal?.deal_number ?? inv.invoice_number}`
  drawWrapped(description, L, 612 - 2 * L, 10, font, ink, 14)
  y -= 6

  // Fee breakdown — subtotal, discount, each tax line, then the grand total. Amounts are read straight
  // off the row (already server-computed and CHECK-constrained; this function never recomputes them).
  const taxLines = Array.isArray(inv.tax_lines) ? inv.tax_lines : []
  const hasDiscount = inv.discount_amount > 0
  const breakdownRows = 1 + (hasDiscount ? 1 : 0) + taxLines.length // subtotal + discount? + tax lines
  const boxPad = 14
  const boxHeight = boxPad * 2 + breakdownRows * 18 + 30 // +30 for the total line + divider
  // The box is drawn as one unit — if it doesn't fit, the WHOLE box (not a jagged split mid-row) moves
  // to a fresh page. A handful of tax lines is the realistic case; this keeps the layout simple and
  // never clips a row.
  ensureSpace(boxHeight + 20)
  const boxY = y - boxHeight
  page.drawRectangle({ x: L, y: boxY, width: 612 - 2 * L, height: boxHeight, color: rgb(0.97, 0.98, 1) })

  // Labels here are truncated, not wrapped — a breakdown row is a fixed-height line in a box whose
  // height was already computed from a known row count; wrapping a label would invalidate that count.
  const LINE_LABEL_MAX_WIDTH = 300
  let by = boxY + boxHeight - boxPad - 2
  const lineRow = (label: string, value: string, opts?: { muted?: boolean }) => {
    text(truncateToWidth(label, LINE_LABEL_MAX_WIDTH, 10, font), L + 16, by, 10, font, opts?.muted ? muted : ink)
    const w = font.widthOfTextAtSize(value, 10)
    text(value, 612 - L - 16 - w, by, 10, font, opts?.muted ? muted : ink)
    by -= 18
  }
  lineRow("Subtotal", money(inv.subtotal))
  if (hasDiscount) {
    lineRow(
      inv.discount_reason ? `Discount (${inv.discount_reason})` : "Discount",
      `-${money(inv.discount_amount)}`,
    )
  }
  for (const t of taxLines) {
    lineRow(`${t.label} (${t.rate}%)`, money(t.amount), { muted: true })
  }
  by -= 6
  page.drawLine({ start: { x: L + 16, y: by + 12 }, end: { x: 612 - L - 16, y: by + 12 }, thickness: 1, color: rgb(0.85, 0.87, 0.92) })
  text("Total due", L + 16, by, 12, bold, brand)
  const totalStr = money(inv.amount)
  text(totalStr, 612 - L - 16 - bold.widthOfTextAtSize(totalStr, 14), by - 2, 14, bold, brand)

  y = boxY - 20

  // Notes / payment instructions — admin-editable free text, shown only when set. Each is a heading
  // line plus a wrapped body, so a long instruction wraps within the page instead of running off it.
  const contentWidth = 612 - 2 * L
  if (inv.payment_instructions) {
    ensureSpace(14)
    text("Payment instructions", L, y, 9, font, muted)
    y -= 14
    drawWrapped(inv.payment_instructions, L, contentWidth, 10, font, ink, 14)
    y -= 6
  }
  if (inv.notes) {
    ensureSpace(14)
    text("Notes", L, y, 9, font, muted)
    y -= 14
    drawWrapped(inv.notes, L, contentWidth, 10, font, ink, 14)
    y -= 6
  }

  // Footer — configurable via Invoice Settings (footer_text); falls back to the original fixed line.
  // Wrapped and capped at 3 lines (proportional — this is a footer, not a legal appendix), anchored so
  // the LAST line sits where the original single-line footer always did.
  const footerText = settings.footer_text || `${BRAND} • Commission and platform fees are quoted in basis points (bps).`
  const footerLines = wrapText(footerText, contentWidth, 8, font).slice(0, 3)
  ensureSpace(footerLines.length * 10 + 20)
  let fy = 48 + (footerLines.length - 1) * 10
  for (const line of footerLines) {
    text(line, L, fy, 8, font, muted)
    fy -= 10
  }

  return await doc.save()
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })
  try {
    const authHeader = req.headers.get("Authorization") ?? ""
    if (!authHeader) return json(401, { error: "missing authorization" })
    const { invoiceId } = await req.json().catch(() => ({}))
    if (!invoiceId) return json(400, { error: "invoiceId is required" })

    // Fetch with the CALLER's JWT so RLS (invoices_lender) gates access to their own invoice only.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: inv, error } = await asUser
      .from("invoices")
      .select(
        "id, invoice_number, loan_amount, term_years, mortgage_product, platform_bps, amount, broker_name, client_name, document_name, closing_date, due_date, status, created_at, subtotal, discount_amount, discount_reason, tax_lines, tax_total, description, billing_reference, notes, payment_instructions, revision_number, deals(deal_number, city, province)",
      )
      .eq("id", invoiceId)
      .single()
    if (error || !inv) return json(404, { error: "invoice not found or not permitted" })

    // Service role from here on: Storage writes need it, and invoice_settings is admin-only RLS (the
    // caller here is often just the invoice's own lender, not an admin) — reading it server-side to
    // apply header_text/footer_text to the PDF doesn't expose the settings table to the client.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: settings } = await admin
      .from("invoice_settings")
      .select("header_text, footer_text")
      .eq("id", 1)
      .maybeSingle()

    const pdfBytes = await renderInvoicePdf(inv as unknown as Invoice, settings ?? { header_text: null, footer_text: null })

    // Upload + stamp pdf_path with the service role (bypasses Storage RLS; private bucket).
    const path = `${inv.id}.pdf`
    const up = await admin.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    })
    if (up.error) return json(500, { error: `upload failed: ${up.error.message}` })
    await admin.from("invoices").update({ pdf_path: path }).eq("id", inv.id)

    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 120)
    if (signed.error || !signed.data) return json(500, { error: "could not sign the download URL" })
    // The runtime's SUPABASE_URL is the INTERNAL docker host (http://kong:8000), so the signed URL it
    // builds isn't reachable from the browser/host. The token signs the path (not the host), so return
    // the path + query and let the client prepend its own public NEXT_PUBLIC_SUPABASE_URL.
    const u = new URL(signed.data.signedUrl)
    return json(200, { signedPath: u.pathname + u.search, path })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
