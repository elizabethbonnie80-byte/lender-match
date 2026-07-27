// Single source of truth for brand identity. Kept OUT of the i18n catalogs on purpose: the brand is a
// proper noun, identical in every locale, so one constant beats duplicating it in en.json + fr.json.
// Translated strings that embed the brand use a `{brand}` placeholder and interpolate BRAND (see the
// footer copy), so the brand stays centralized even inside translated text.
//
// Round 3 (approved 2026-07-13) rebrand "Loan Link → LenderMatch™" — DONE (Phase 2, 2026-07-17). The
// headers render BRAND as text (no image logo is wired; public/placeholder-logo.* is unused), so this
// single flip propagates the wordmark everywhere the app references BRAND (headers, footer, and any
// translated copy that embeds {brand}). The invoice-pdf edge fn's BRAND and the confirmation.html Auth
// email template are synced by hand (edge fns / email templates can't import from the Next app).
// COPYRIGHT_HOLDER (the founders) does NOT change with the rebrand.

export const BRAND = "LenderMatch™"
/**
 * The legal entity, for contract copy — NOT the wordmark. The client's platform-fee clause (revision
 * 2026-07-23 A-10) names "LenderMatch Inc." exactly: no ™, and "Inc.". Interpolated as `{entity}` so
 * contract text stays verbatim while the brand stays centralized here.
 */
export const LEGAL_ENTITY = "LenderMatch Inc."
export const COPYRIGHT_HOLDER = "Elizabeth Iginla and Bonnie Casault" // footer © line (the founders)
export const SUPPORT_EMAIL = "support@lendermatch.ca"
export const DOMAIN = "lendermatch.ca"
