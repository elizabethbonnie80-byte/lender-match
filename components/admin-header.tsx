'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, ChevronDown, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notification-bell'
import { NavMenu, type NavMenuSection } from '@/components/nav-menu'
import { HeaderOverflowMenu } from '@/components/header-overflow'
import { useUnread } from '@/hooks/use-unread'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { useT } from '@/components/i18n-provider'
import { BrandMark } from '@/components/brand-mark'

type NavLink = { key: string; href: string }
type NavGroup = { group: string; items: NavLink[] }
type NavEntry = NavLink | NavGroup

// Frequent actions stay top-level; the reporting + content editors are grouped so the bar stays short.
const NAV: NavEntry[] = [
  { key: 'alerts', href: '/admin/alerts' },
  { key: 'lenderApprovals', href: '/admin/lender-approvals' },
  { key: 'dealRoom', href: '/deal-room' },
  {
    group: 'reports',
    items: [
      { key: 'dealOverview', href: '/admin/deal-overview' },
      { key: 'analytics', href: '/admin/analytics' },
      { key: 'invoices', href: '/admin/invoices' },
      { key: 'surveys', href: '/admin/survey-report' },
      { key: 'penalties', href: '/admin/penalties' },
      // Client 2026-07-28 (B-17): admin-only viewer for the consent PDF + photo ID.
      { key: 'documents', href: '/admin/documents' },
    ],
  },
  {
    group: 'manage',
    items: [
      { key: 'brokers', href: '/admin/brokers' },
      { key: 'organizations', href: '/admin/organizations' },
    ],
  },
  {
    group: 'content',
    items: [
      { key: 'faqs', href: '/admin/faqs' },
      { key: 'legal', href: '/admin/legal' },
      { key: 'logos', href: '/admin/logos' },
    ],
  },
]

const linkCls = (active: boolean) =>
  `px-2 min-[1260px]:px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
    active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:text-primary hover:bg-muted'
  }`

/**
 * Same three tiers as the other two headers (client 2026-08-05, follow-up to G-1) — see
 * `lender-header.tsx` for the full reasoning and the Tailwind-literal warning.
 *
 *   ≥ 1260px   logo + wordmark + "Admin" · 3 links + 3 groups (px-3) · language + bell + settings + out
 *   1024–1259  logo + wordmark · same 6 entries (px-2) · bell + one overflow trigger
 *   < 1024     hamburger sheet
 *
 * ⚠️ Admin turned out to be the tightest of the three once the lender's secondary links were grouped,
 * because **"Approbations des prêteurs" alone is 165px** and the logo carries a 41px "Admin" suffix.
 * Measured in FRENCH: full = logo 228 + nav 698 + right cluster 236 + padding/gaps 96 = **1258**; compact
 * = logo 183 (suffix hidden) + nav 650 + right 84 + 96 = **1013**, which clears 1024 by 11px. That margin
 * is why the suffix hides in the compact tier — with it, admin would not fit and the hamburger would come
 * back on desktop.
 *
 * The bar's own entries are already grouped (Reports / Manage / Content), so unlike the other two there is
 * nothing further to fold — the savings here come from the padding, the suffix and the right cluster.
 */

export function AdminHeader() {
  const t = useT('adminNav')
  const tc = useT('common')
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  // No nav dots here — the admin nav has neither a messages nor a deal surface (E-7).
  const unread = useUnread('admin')

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  // The compact menu flattens the bar's dropdowns into titled sections — 15 destinations, so the sheet
  // scrolls rather than trying to fit them into a dropdown on a short viewport.
  const menuSections: NavMenuSection[] = [
    {
      key: 'main',
      items: NAV.filter((e): e is NavLink => !('group' in e)).map((e) => ({ href: e.href, label: t(e.key) })),
    },
    ...NAV.filter((e): e is NavGroup => 'group' in e).map((g) => ({
      key: g.group,
      label: t(g.group),
      items: g.items.map((i) => ({ href: i.href, label: t(i.key) })),
    })),
  ]

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-16">
          {/* Admin's bar never hid itself, which is the same hole in a different shape: with 6 wide
              entries and no overflow handling it squashed instead of disappearing (G-1). */}
          <NavMenu triggerClassName="lg:hidden shrink-0" sections={menuSections} />

          <Link href="/admin/lender-approvals" className="flex items-center text-xl font-bold text-primary shrink-0">
            <BrandMark />{' '}
            {/* The 41px suffix is what buys admin its 1024 fit — see the tier note above. */}
            <span className="hidden min-[1260px]:inline ml-1 text-muted-foreground font-normal text-sm">
              {t('admin')}
            </span>
          </Link>

          <nav className="hidden lg:flex items-center justify-center gap-0.5 flex-1">
            {NAV.map((entry) =>
              'group' in entry ? (
                (() => {
                  const active = entry.items.some((i) => i.href === pathname)
                  return (
                    <DropdownMenu key={entry.group}>
                      <DropdownMenuTrigger className={`${linkCls(active)} inline-flex items-center gap-1 outline-none`}>
                        {t(entry.group)}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center">
                        {entry.items.map((item) => (
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
                  )
                })()
              ) : (
                <Link key={entry.href} href={entry.href} className={linkCls(pathname === entry.href)}>
                  {t(entry.key)}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-1 ml-auto shrink-0">
            <span className="hidden min-[1260px]:flex items-center gap-1">
              <LocaleSwitcher triggerClassName="w-28 h-8 text-xs" />
            </span>

            {/* Mounted exactly once — see the lender header on why the bell is never duplicated. */}
            <NotificationBell role="admin" unreadCount={unread.total} />

            <span className="hidden min-[1260px]:flex items-center gap-1">
              <Link href="/admin/settings">
                <Button variant="ghost" size="icon" title={tc('settings')}>
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
              <Button variant="ghost" size="icon" title={tc('signOut')} onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </span>

            <HeaderOverflowMenu
              settingsHref="/admin/settings"
              onSignOut={signOut}
              triggerClassName="min-[1260px]:hidden"
            />
          </div>
        </div>
      </div>
    </header>
  )
}
