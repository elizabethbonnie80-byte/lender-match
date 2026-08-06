'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notification-bell'
import { NavUnreadDot } from '@/components/nav-unread-dot'
import { NavMenu } from '@/components/nav-menu'
import { HeaderOverflowMenu } from '@/components/header-overflow'
import { useUnread } from '@/hooks/use-unread'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { useT } from '@/components/i18n-provider'
import { BrandMark } from '@/components/brand-mark'

/** The links that always stay flat in the bar. */
const PRIMARY = [
  { key: 'newDeals', href: '/lender/new-deals' },
  { key: 'submittedOffers', href: '/lender/submitted-offers' },
  { key: 'maturingDeals', href: '/lender/maturing-deals' },
  { key: 'messages', href: '/lender/messages' },
  { key: 'invoices', href: '/lender/invoices' },
] as const

/** Folded into a "Help" dropdown in the compact tier — the two least-used destinations. */
const SECONDARY = [
  { key: 'faq', href: '/lender/faq' },
  { key: 'contact', href: '/lender/contact' },
] as const

const NAV = [...PRIMARY, ...SECONDARY]

/**
 * Three tiers, client 2026-08-05 (follow-up to G-1: "el menú de hamburguesa sale en < 1280 y eso sigue
 * siendo desktop"). The header keeps its full layout wherever that fits, compacts in between, and only
 * becomes a sheet on tablet and below.
 *
 *   ≥ 1300px   logo + wordmark · 7 flat links (px-3) · language + bell + settings + sign out
 *   1024–1299  logo + wordmark · 5 flat links (px-2) + "Help ▾" · bell + one overflow trigger
 *   < 1024     hamburger sheet
 *
 * ⚠️ **1300 is measured, not chosen, and the binding locale is FRENCH** — the seven flat links are 768px
 * in FR against 680px in EN. Full layout = logo 183 + links 768 + right cluster 248 + padding/gaps 96 =
 * **1295**. Compact = logo 183 + links 629 + right 84 + 96 = **992**, so it clears 1024 with headroom.
 *
 * Consequence worth knowing: the previous `xl` (1280) was not conservative, it was **insufficient** — in
 * French the bar had been quietly overflowing its `overflow-x-auto` all along.
 *
 * ⚠️ Do not refactor `min-[1300px]` into a constant and interpolate it. Tailwind scans for **literal**
 * class strings, so `${BP}:px-3` produces no CSS at all and the tier silently stops working. Every
 * occurrence below is spelled out for that reason. The measurements live in
 * `docs/client-revisions-2026-08-05.md`.
 */
export function LenderHeader() {
  const t = useT('lenderNav')
  const tc = useT('common')
  const pathname = usePathname()
  const router = useRouter()
  const unread = useUnread('lender')

  // E-7 + the 2026-07-30 follow-up (F-1): which nav items carry an unread dot. New Deals carries it
  // (unread `filter_match` — a new deal matched a saved filter), NOT Submitted Offers: the daily
  // auto-offer digest kept re-lighting that one every morning, so it read as permanent. See
  // DEAL_SURFACE_TYPES for the full reasoning. Messages uses the real thread unread.
  const navUnread: Partial<Record<(typeof NAV)[number]['key'], number>> = {
    newDeals: unread.deals,
    messages: unread.messages,
  }

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  const stateCls = (active: boolean) =>
    active
      ? 'bg-primary/10 text-primary font-medium'
      : 'text-foreground hover:text-primary hover:bg-muted'

  const itemCls = (active: boolean) =>
    `relative px-2 min-[1300px]:px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${stateCls(active)}`

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-16">
          {/* Below lg there is no room for a bar at all, so the same links move into a sheet — a
              breakpoint may never remove navigation outright (G-1). */}
          <NavMenu
            triggerClassName="lg:hidden shrink-0"
            sections={[
              {
                key: 'lender',
                items: NAV.map((item) => ({
                  href: item.href,
                  label: t(item.key),
                  unread: navUnread[item.key],
                })),
              },
            ]}
          />

          <Link href="/lender/new-deals" className="text-xl font-bold text-primary shrink-0">
            <BrandMark />
          </Link>

          <nav className="hidden lg:flex items-center justify-center gap-0.5 flex-1">
            {PRIMARY.map((item) => (
              <Link key={item.href} href={item.href} className={itemCls(pathname === item.href)}>
                {t(item.key)}
                <NavUnreadDot count={navUnread[item.key] ?? 0} />
              </Link>
            ))}

            {/* Full tier: the secondary links sit flat like the rest. */}
            {SECONDARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`hidden min-[1300px]:inline-flex ${itemCls(pathname === item.href)}`}
              >
                {t(item.key)}
              </Link>
            ))}

            {/* Compact tier: the same two behind one dropdown — the pattern the admin bar already uses. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={`min-[1300px]:hidden inline-flex items-center gap-1 outline-none ${itemCls(
                  SECONDARY.some((s) => s.href === pathname),
                )}`}
              >
                {tc('help')}
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                {SECONDARY.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={`cursor-pointer ${pathname === item.href ? 'text-primary font-medium' : ''}`}
                    >
                      {t(item.key)}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Full tier: language expanded, exactly as before. */}
            <span className="hidden min-[1300px]:flex items-center gap-2">
              <LocaleSwitcher triggerClassName="w-28 h-8 text-xs" />
            </span>

            {/* The bell is OUTSIDE both tiers and mounted exactly once — it owns a fixed-topic Realtime
                channel, and a duplicate silently receives nothing (F-1 bug (d)). */}
            <NotificationBell role="lender" unreadCount={unread.total} />

            <span className="hidden min-[1300px]:flex items-center gap-2">
              <Link href="/lender/settings">
                <Button variant="ghost" size="icon" title={tc('settings')}>
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
              <Button variant="ghost" size="icon" title={tc('signOut')} onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </span>

            {/* Compact tier: language + settings + sign out folded behind one trigger. */}
            <HeaderOverflowMenu
              settingsHref="/lender/settings"
              onSignOut={signOut}
              triggerClassName="min-[1300px]:hidden"
            />
          </div>
        </div>
      </div>
    </header>
  )
}
