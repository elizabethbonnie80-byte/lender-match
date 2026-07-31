'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, X } from 'lucide-react'
import { useUnread } from '@/hooks/use-unread'
import { useT } from '@/components/i18n-provider'
import type { NotificationRole } from '@/lib/queries/notifications'

const STORAGE_KEY = 'll_unread_banner_dismissed'

const HREF: Record<NotificationRole, string> = {
  broker: '/notifications',
  lender: '/lender/notifications',
  admin: '/admin/notifications',
}

/**
 * "You have N unread notifications" on the role's landing page (E-7, client 2026-07-30).
 *
 * She asked for a **modal popup** on login. This is the deliberate substitute, and the reasoning is
 * recorded in `docs/client-revisions-2026-07-30.md`: the app already mounts one non-dismissable modal
 * (the legal re-agreement gate), and a second blocking dialog on every sign-in teaches people to close
 * dialogs without reading them — which is the opposite of the goal. A banner in the content flow is
 * impossible to miss on arrival and costs nothing to walk past.
 *
 * Dismissal is per browser session AND per count: we store the number that was showing when it was
 * closed, so walking away from 3 keeps it hidden at 3 but brings it back at 4. That is what stops it
 * being either nagging or useless.
 */
export function UnreadBanner({ role }: { role: NotificationRole }) {
  const t = useT('notificationCenter')
  const { total, ready } = useUnread(role)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)

  // sessionStorage is read after mount so the server and the first client render agree.
  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    setDismissedAt(raw === null ? 0 : Number(raw) || 0)
  }, [])

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, String(total))
    setDismissedAt(total)
  }

  if (!ready || total === 0 || dismissedAt === null || total <= dismissedAt) return null

  return (
    <div className="flex items-center gap-3 mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <Bell className="h-4 w-4 text-primary shrink-0" />
      <p className="text-sm text-foreground">
        {total === 1 ? t('bannerOne') : t('bannerMany', { count: total })}
      </p>
      <Link
        href={HREF[role]}
        className="text-sm font-medium text-primary hover:underline whitespace-nowrap ml-auto"
      >
        {t('bannerCta')}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        title={t('bannerDismiss')}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">{t('bannerDismiss')}</span>
      </button>
    </div>
  )
}
