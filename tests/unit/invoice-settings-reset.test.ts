import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LENDERMATCH_DEFAULT_INVOICE_SETTINGS } from '@/lib/invoice-settings-defaults'
import { BRAND } from '@/lib/brand'
import { setInvoiceSettings } from '@/lib/queries/admin'

// Resolve relative to THIS file rather than process.cwd(), which vitest doesn't guarantee is the repo
// root (tests/unit/ -> repo root is two levels up).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * "Reset to LenderMatch Default" (Admin → Invoice Settings). The reset button itself is a pure
 * client-side form fill (no RPC call — see app/admin/invoice-settings/page.tsx's `handleReset`,
 * which only calls the local useState setters), so there is no live-DB behavior to smoke-test here.
 * What IS testable and load-bearing:
 *   1. the canonical defaults genuinely match the invoice-pdf edge function's own hardcoded
 *      fallback text — not invented wording — so a future edit to one side doesn't silently drift
 *      from the other;
 *   2. saving those defaults goes through the exact same write path as any other settings save
 *      (set_invoice_settings only), proving existing invoices are structurally unreachable from it.
 *
 * "Reset alone doesn't save" and "Reset then Save persists" are guaranteed by construction, not by
 * an executable UI test: handleReset never calls setInvoiceSettings, and setInvoiceSettings is only
 * ever invoked from the Save button's own handler — there is no code path connecting the two other
 * than the admin clicking Save afterward. This repo has no component-rendering test harness
 * (Vitest here only exercises plain functions/query-layer code, same as every other test in this
 * suite), so that wiring is verified by inspection rather than a rendered-DOM assertion.
 */

const PDF_SOURCE = readFileSync(
  join(REPO_ROOT, 'supabase/functions/invoice-pdf/index.ts'),
  'utf8',
)

describe('LENDERMATCH_DEFAULT_INVOICE_SETTINGS — fidelity to the actual PDF fallback', () => {
  it('headerText matches the literal title the PDF falls back to when nothing is configured', () => {
    expect(LENDERMATCH_DEFAULT_INVOICE_SETTINGS.headerText).toBe('Platform Fee Invoice')
    expect(PDF_SOURCE).toContain('settings.header_text || "Platform Fee Invoice"')
  })

  it('footerText matches the literal footer the PDF falls back to, built from the real BRAND constant', () => {
    const expected = `${BRAND} • Commission and platform fees are quoted in basis points (bps).`
    expect(LENDERMATCH_DEFAULT_INVOICE_SETTINGS.footerText).toBe(expected)
    // The PDF (a separate Deno bundle) can't import lib/brand.ts, so it keeps its own literal BRAND —
    // confirm that literal still matches the app's BRAND, and the surrounding fallback text is the same.
    expect(PDF_SOURCE).toContain('const BRAND = "LenderMatch™"')
    expect(BRAND).toBe('LenderMatch™')
    expect(PDF_SOURCE).toContain('Commission and platform fees are quoted in basis points (bps).')
  })

  it('defaultDescription is null, not an invented static string — the original behavior was PER-INVOICE dynamic text', () => {
    expect(LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultDescription).toBeNull()
    // Confirms the dynamic fallback this null is meant to restore still exists in the PDF function.
    expect(PDF_SOURCE).toContain('inv.description || `Platform fee — Deal ${deal?.deal_number ?? inv.invoice_number}`')
  })

  it('defaultPaymentInstructions is null — this field never existed before Admin Invoice Management', () => {
    expect(LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultPaymentInstructions).toBeNull()
  })

  it('defaultTaxLines is empty — no invoice ever had a tax line before this feature existed', () => {
    expect(LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultTaxLines).toEqual([])
  })
})

describe('setInvoiceSettings — the only write path Reset+Save can reach', () => {
  it('calls set_invoice_settings only — never an invoice-mutating RPC or the invoices table', async () => {
    const calls: { kind: 'rpc' | 'from'; name: string }[] = []
    const client = {
      rpc(name: string, _args: unknown) {
        calls.push({ kind: 'rpc', name })
        return Promise.resolve({
          data: {
            header_text: LENDERMATCH_DEFAULT_INVOICE_SETTINGS.headerText,
            default_description: LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultDescription,
            footer_text: LENDERMATCH_DEFAULT_INVOICE_SETTINGS.footerText,
            default_payment_instructions: LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultPaymentInstructions,
            default_tax_lines: LENDERMATCH_DEFAULT_INVOICE_SETTINGS.defaultTaxLines,
            updated_at: '2026-09-04T00:00:00.000Z',
          },
          error: null,
        })
      },
      from(table: string) {
        calls.push({ kind: 'from', name: table })
        throw new Error(`setInvoiceSettings must never touch a table directly (called .from("${table}"))`)
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await setInvoiceSettings(client as any, LENDERMATCH_DEFAULT_INVOICE_SETTINGS)

    expect(calls).toEqual([{ kind: 'rpc', name: 'set_invoice_settings' }])
    expect(result.defaultTaxLines).toEqual([])
    expect(result.defaultDescription).toBeNull()
  })
})
