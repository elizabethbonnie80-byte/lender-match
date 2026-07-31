"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bell, Check } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { fr as frLocale } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { NotificationIcon } from "@/components/notification-icon"
import { createClient } from "@/lib/supabase/client"
import { useT, useLocale } from "@/components/i18n-provider"
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  NOTIFICATION_TYPE_KEY,
  type NotificationItem,
  type NotificationRole,
} from "@/lib/queries/notifications"

/**
 * In-app notification bell shared by all three headers. Reads the current user's notifications
 * (RLS scopes them to the recipient) and subscribes to Realtime so new ones arrive live without a
 * refresh — replacing Bubble's page-load re-fetch. `role` picks the "view all" destination and the
 * per-item click target (see `notificationHref`).
 */
export function NotificationBell({ role, unreadCount }: { role: NotificationRole; unreadCount: number }) {
  const t = useT("notificationCenter")
  const locale = useLocale()
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  // E-7: the badge is an EXACT server count supplied by the header's useUnread(). It used to be
  // `items.filter(n => !n.isRead).length` — i.e. unread within the newest 20 rows this popover had
  // loaded — so anyone past 20 unread was quietly told they had fewer than they did.
  const unread = unreadCount
  const viewAllHref = role === "lender" ? "/lender/notifications" : role === "admin" ? "/admin/notifications" : "/notifications"

  const refresh = useCallback(async () => {
    const supabase = createClient()
    try {
      setItems(await listNotifications(supabase))
    } catch {
      /* unauthenticated or transient — leave the list as-is */
    }
  }, [])

  useEffect(() => {
    void refresh()

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // getUser() is async, so the effect's cleanup can run before it resolves (React Strict Mode
    // double-mount in dev). Without this guard the stale first-mount callback still subscribes, leaving
    // two channels on the same "notifications-bell" topic — which triggers Supabase's "cannot add
    // postgres_changes callbacks after subscribe()" error. The flag makes the stale run a no-op.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return
      channel = supabase
        .channel("notifications-bell")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
          () => void refresh(),
        )
        .subscribe()
    })

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [refresh])

  const onItemClick = (n: NotificationItem) => {
    setOpen(false)
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      markNotificationRead(createClient(), n.id).catch(() => void refresh())
    }
    const href = notificationHref(n, role)
    if (href) router.push(href)
  }

  const onMarkAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })))
    try {
      await markAllNotificationsRead(createClient())
    } catch {
      void refresh()
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) void refresh() }}>
      <PopoverTrigger asChild>
        {/* E-7: deliberately larger than its neighbouring icon buttons — the client's complaint was
            that the bell is easy to ignore. The badge gets a ring in the header's own colour so it
            reads as a raised pip rather than part of the icon. */}
        <Button variant="ghost" size="icon" title={t("title")} className="relative h-10 w-10">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.2rem] h-[1.2rem] px-1 rounded-full bg-destructive text-white text-[0.7rem] font-bold flex items-center justify-center ring-2 ring-card">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[23rem] max-w-[92vw] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">{t("title")}</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAll}
              className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            >
              <Check className="h-3 w-3" /> {t("markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted transition-colors flex gap-3 ${
                      n.isRead ? "" : "bg-primary/5"
                    }`}
                  >
                    <NotificationIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t(NOTIFICATION_TYPE_KEY[n.type])}
                        </span>
                        <span className="text-[0.65rem] text-muted-foreground ml-auto shrink-0">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: locale === "fr" ? frLocale : undefined })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-snug line-clamp-2">{n.body}</p>
                    </div>
                    {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link
          href={viewAllHref}
          onClick={() => setOpen(false)}
          className="block px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted transition-colors border-t border-border"
        >
          {t("viewAll")}
        </Link>
      </PopoverContent>
    </Popover>
  )
}
