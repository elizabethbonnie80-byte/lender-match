'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical, Settings, LogOut, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { locales, LOCALE_LABEL, LOCALE_COOKIE } from '@/lib/i18n/config'
import { useLocale, useT } from '@/components/i18n-provider'

/**
 * The header's right-hand controls (language · settings · sign out) folded behind one trigger, for the
 * widths where the expanded row does not fit beside a full navigation bar.
 *
 * Client 2026-08-05, follow-up to G-1: the hamburger was appearing at 1280px, which is still a desktop.
 * Keeping the whole nav visible down to tablet needs ~150px back, and this is where it is: the expanded
 * cluster costs 248px (language 112 + bell 40 + settings 36 + sign out 36 + gaps) against 84px for
 * bell + this trigger. Measured, not estimated — see `docs/client-revisions-2026-08-05.md`.
 *
 * ⚠️ The **notification bell stays outside this menu** and is never duplicated into it. It owns a
 * Realtime subscription on a fixed topic, and a second mounted instance silently receives nothing — that
 * was F-1 bug (d), and G-1 already had to avoid the same trap in `NavMenu`.
 *
 * The language picker is rendered as menu ITEMS rather than by nesting `LocaleSwitcher`'s `Select` inside
 * this dropdown: two overlapping poppers fight over focus, and Radix's menu already gives keyboard
 * navigation and a checked state for free. The cookie write is identical to `LocaleSwitcher`'s, so both
 * paths behave the same.
 */
export function HeaderOverflowMenu({
  settingsHref,
  onSignOut,
  triggerClassName,
}: {
  settingsHref: string
  onSignOut: () => void
  /** Must be the exact complement of the expanded cluster's breakpoint, e.g. `min-[1300px]:hidden`. */
  triggerClassName?: string
}) {
  const t = useT('common')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const pickLocale = (value: string) => {
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`
    startTransition(() => router.refresh())
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={triggerClassName} aria-label={t('more')}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('language')}
        </DropdownMenuLabel>
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            disabled={pending}
            onSelect={() => pickLocale(l)}
            className="cursor-pointer focus:[&_svg]:!text-accent-foreground"
          >
            {/* A fixed-width slot so the labels stay aligned whether or not the check is drawn. */}
            <span className="w-4 inline-flex justify-center">
              {l === locale && <Check className="h-4 w-4" />}
            </span>
            {LOCALE_LABEL[l]}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="cursor-pointer focus:[&_svg]:!text-accent-foreground">
          <Link href={settingsHref}>
            <Settings className="h-4 w-4" />
            {t('settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onSignOut}
          className="cursor-pointer focus:[&_svg]:!text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
