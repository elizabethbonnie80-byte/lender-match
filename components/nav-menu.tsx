'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NavUnreadDot } from '@/components/nav-unread-dot'
import { useT } from '@/components/i18n-provider'

export type NavMenuItem = {
  href: string
  label: string
  /** Unread count for the pip; 0 or omitted renders nothing. */
  unread?: number
}

/** A titled block of links. Omit `label` for the ungrouped links that lead the list. */
export type NavMenuSection = {
  key: string
  label?: string
  items: NavMenuItem[]
}

/**
 * The compact navigation menu each portal header falls back to when its horizontal bar does not fit
 * (client 2026-08-05: "it seems that the header is gone. It no longer says submitted offers, deals,
 * invoices etc. at the top").
 *
 * ⚠️ The bug it fixes was not a broken nav — it was `hidden xl:flex` on the lender's `<nav>` with
 * **nothing behind it**. Below 1280px the seven links were still in the DOM and simply invisible, so a
 * lender on a 1280-or-narrower screen had no way to reach Submitted Offers, Invoices or Messages at all.
 * Every portal had the same shape of hole: broker below 768px, and admin never hid its bar but had no
 * `overflow-x-auto` either, so it squashed instead.
 *
 * The rule this encodes: **a responsive breakpoint may only ever move navigation, never remove it.** The
 * caller passes the SAME hidden-below class to `triggerClassName` that its `<nav>` uses to appear
 * (`xl:hidden` against `hidden xl:flex`), so the two are exact complements and no width can fall through
 * the gap between them.
 *
 * Deliberately a Sheet and not a DropdownMenu: admin has 15 destinations in 3 groups, which overflows a
 * dropdown on a short viewport, and the sheet scrolls. It follows the in-repo precedent in
 * `components/deal-filters-sidepanel.tsx`.
 *
 * The bell is NOT duplicated in here — it owns a Realtime channel keyed by a fixed topic, so a second
 * mounted instance would collide with the header's. The pips come from the same `useUnread()` store the
 * bar uses.
 */
export function NavMenu({
  sections,
  triggerClassName,
}: {
  sections: NavMenuSection[]
  /** Must be the exact complement of the sibling `<nav>`'s breakpoint, e.g. `xl:hidden`. */
  triggerClassName?: string
}) {
  const t = useT('common')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className={triggerClassName} aria-label={t('menu')}>
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 flex flex-col gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t('menu')}</SheetTitle>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto p-3">
          {sections.map((section) => (
            <div key={section.key} className="mb-3 last:mb-0">
              {section.label && (
                <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  // Closing on click is manual: these are client-side navigations, so the sheet would
                  // otherwise stay open over the page the user just asked for.
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    pathname === item.href
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:text-primary hover:bg-muted'
                  }`}
                >
                  {item.label}
                  <NavUnreadDot count={item.unread ?? 0} inline />
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
