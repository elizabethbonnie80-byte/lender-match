"use client"

import Link from "next/link"
import { useT } from "@/components/i18n-provider"
import { BRAND, COPYRIGHT_HOLDER, SUPPORT_EMAIL } from "@/lib/brand"

/**
 * Shared site footer. Originally copy-pasted into ~13 pages, then centralized here, then REMOVED at the
 * client's request (commit 9ce897d) — and restored on 2026-07-28 (A-2), verbatim from their reply:
 *
 *   "The full footer restored please that should be consistent throughout the site. We'd like it to
 *    read: ©LenderMatch™ Inc. (and the current year). Patent Pending. Links to the TOS and privacy
 *    policy as well as the support@lendermatch.ca email."
 *
 * So: one © line carrying the company (not the founders — see COPYRIGHT_HOLDER) plus "Patent Pending",
 * and exactly three links. The old "Regulatory Disclosures" link is not restored: it pointed at `#` and
 * they did not ask for it.
 *
 * "Consistent throughout the site" is why this takes no `variant` and no per-portal props any more, and
 * why it is mounted ONCE in the root layout instead of page by page — the previous version had to be
 * pasted into 13 pages and still missed the rest of them.
 */
export function SiteFooter({ className = "mt-12" }: { className?: string }) {
  const t = useT("footer")
  return (
    <footer className={`bg-foreground text-background py-6 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-center md:text-left">
            <p className="font-bold text-lg">{BRAND}</p>
            <p className="text-sm opacity-70">
              {t("rights", { year: new Date().getFullYear(), holder: COPYRIGHT_HOLDER })}
            </p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link href="/legal/terms" className="opacity-70 hover:opacity-100 transition-opacity">
              {t("terms")}
            </Link>
            <Link href="/legal/privacy" className="opacity-70 hover:opacity-100 transition-opacity">
              {t("privacy")}
            </Link>
            {/* A real mailto, not a page link — they asked for the address itself in the footer.
                No "Contact Us" link: their list was TOS, privacy policy and this address. */}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="opacity-70 hover:opacity-100 transition-opacity">
              {SUPPORT_EMAIL}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
