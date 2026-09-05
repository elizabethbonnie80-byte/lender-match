import { BRAND } from "./brand"

/**
 * The canonical "LenderMatch default" invoice presentation — what a brand-new, never-customized
 * Invoice Settings row produces. These are NOT arbitrary; each one is lifted directly from the
 * invoice-pdf edge function's own hardcoded fallback (supabase/functions/invoice-pdf/index.ts),
 * which is what every invoice used before Admin Invoice Management (migration 87) existed at all:
 *
 *   - headerText / footerText: the literal strings that function falls back to when
 *     settings.header_text / settings.footer_text is null (`title`/`footerText` there).
 *   - defaultDescription: deliberately `null`, NOT a static string. The original, pre-Invoice-
 *     Settings description was always computed PER INVOICE from the deal number
 *     (`Platform fee — Deal ${dealNumber}`) — there was never a single fixed default text to
 *     restore. Leaving this null is what correctly reproduces that per-invoice behavior again;
 *     inventing a static replacement here would be less faithful to "the original default", not
 *     more.
 *   - defaultPaymentInstructions: `null` — this field didn't exist before this feature, so there
 *     is no historical text to restore.
 *   - defaultTaxLines: `[]` — no invoice ever had a tax line before this feature existed.
 *
 * Used by the "Reset to LenderMatch Default" action on /admin/invoice-settings. Kept as one
 * shared constant (rather than re-typing these strings in the page) so the UI's reset button and
 * this documented rationale can't quietly drift apart — the PDF function's own literals remain
 * the single source of truth; this just mirrors them the same way BRAND itself is already mirrored
 * into that separate Deno bundle.
 */
export const LENDERMATCH_DEFAULT_INVOICE_SETTINGS: {
  headerText: string | null
  defaultDescription: string | null
  footerText: string | null
  defaultPaymentInstructions: string | null
  defaultTaxLines: { label: string; rate: number }[]
} = {
  headerText: "Platform Fee Invoice",
  defaultDescription: null,
  footerText: `${BRAND} • Commission and platform fees are quoted in basis points (bps).`,
  defaultPaymentInstructions: null,
  defaultTaxLines: [],
}
