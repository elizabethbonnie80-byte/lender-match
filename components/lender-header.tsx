'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notification-bell'
import { NavUnreadDot } from '@/components/nav-unread-dot'
import { NavMenu } from '@/components/nav-menu'
import { useUnread } from '@/hooks/use-unread'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { useT } from '@/components/i18n-provider'
import { BrandMark } from '@/components/brand-mark'

const NAV = [
  { key: 'newDeals', href: '/lender/new-deals' },
  { key: 'submittedOffers', href: '/lender/submitted-offers' },
  { key: 'maturingDeals', href: '/lender/maturing-deals' },
  { key: 'messages', href: '/lender/messages' },
  { key: 'invoices', href: '/lender/invoices' },
  { key: 'faq', href: '/lender/faq' },
  { key: 'contact', href: '/lender/contact' },
] as const

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

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-16">
          {/* Below xl the bar is hidden, so the same links move into the sheet — see NavMenu for why a
              breakpoint may never remove navigation outright (client 2026-08-05). */}
          <NavMenu
            triggerClassName="xl:hidden shrink-0"
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

          <nav className="hidden xl:flex items-center justify-center gap-0.5 flex-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  pathname === item.href
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:text-primary hover:bg-muted'
                }`}
              >
                {t(item.key)}
                <NavUnreadDot count={navUnread[item.key] ?? 0} />
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <LocaleSwitcher triggerClassName="w-28 h-8 text-xs" />
            <NotificationBell role="lender" unreadCount={unread.total} />
            <Link href="/lender/settings">
              <Button variant="ghost" size="icon" title={tc('settings')}>
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" title={tc('signOut')} onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
