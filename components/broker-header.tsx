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
  { key: 'createDeal', href: '/create-deal' },
  { key: 'dealRoom', href: '/deal-room' },
  { key: 'messages', href: '/messages' },
] as const

/** Folded into a "Help" dropdown in the compact tier. */
const SECONDARY = [
  { key: 'faq', href: '/faq' },
  { key: 'contact', href: '/contact' },
] as const

const NAV = [...PRIMARY, ...SECONDARY]

/**
 * Same three tiers as the lender header (client 2026-08-05, follow-up to G-1) — see that file for the
 * full reasoning and the Tailwind-literal warning. This header needs the least room of the three:
 *
 *   ≥ 1100px   logo + wordmark · 5 flat links (px-3) · language + bell + settings + sign out
 *   768–1099   logo + wordmark · 3 flat links (px-2) + "Help ▾" · bell + one overflow trigger
 *   < 768      hamburger sheet
 *
 * ⚠️ Measured in FRENCH, the binding locale: full = logo 183 + links 522 + right cluster 296 + padding
 * and gaps 96 = **1097**; compact = 183 + 401 + 84 + 96 = **764**. The old `md` (768) showed the full bar
 * from 768 up, where it needed 1097 — so between 768 and 1097 the broker bar had been **overflowing**,
 * the same latent defect the lender had at 1280.
 *
 * The hamburger stays at `md` here rather than `lg`: the compact tier genuinely fits at 768, and moving it
 * to 1024 would hide a bar that works.
 *
 * ⚠️ `min-[1100px]` is spelled out literally at every use. Interpolating it into a template kills the
 * class — Tailwind only scans for literal strings.
 */
export function BrokerHeader() {
  const t = useT('brokerNav')
  const tc = useT('common')
  const pathname = usePathname()
  const router = useRouter()
  const unread = useUnread('broker')

  // E-7: Deal Room is the broker's deal surface (new offer / expiring / expired / survey due);
  // Messages uses the real thread unread rather than notifications, so it clears on reading.
  const navUnread: Partial<Record<(typeof NAV)[number]['key'], number>> = {
    dealRoom: unread.deals,
    messages: unread.messages,
  }

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  const itemCls = (active: boolean) =>
    `relative px-2 min-[1100px]:px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
      active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:text-primary hover:bg-muted'
    }`

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-16">
          {/* Below md the bar has no room at all, so the same links move into a sheet (G-1). */}
          <NavMenu
            triggerClassName="md:hidden flex-shrink-0"
            sections={[
              {
                key: 'broker',
                items: NAV.map((item) => ({
                  href: item.href,
                  label: t(item.key),
                  unread: navUnread[item.key],
                })),
              },
            ]}
          />

          <Link href="/deal-room" className="text-xl font-bold text-primary flex-shrink-0">
            <BrandMark />
          </Link>

          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
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
                className={`hidden min-[1100px]:inline-flex ${itemCls(pathname === item.href)}`}
              >
                {t(item.key)}
              </Link>
            ))}

            {/* Compact tier: the same two behind one dropdown. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={`min-[1100px]:hidden inline-flex items-center gap-1 outline-none ${itemCls(
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

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <span className="hidden min-[1100px]:flex items-center gap-2">
              <LocaleSwitcher triggerClassName="w-28 h-8 text-xs" />
            </span>

            {/* Mounted exactly once — see the lender header on why the bell is never duplicated. */}
            <NotificationBell role="broker" unreadCount={unread.total} />

            <span className="hidden min-[1100px]:flex items-center gap-2">
              <Link href="/settings">
                <Button variant="ghost" size="icon" title={tc('settings')}>
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
              <Button variant="ghost" size="icon" title={tc('signOut')} onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </span>

            <HeaderOverflowMenu
              settingsHref="/settings"
              onSignOut={signOut}
              triggerClassName="min-[1100px]:hidden"
            />
          </div>
        </div>
      </div>
    </header>
  )
}
