"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, Loader2 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { fr as frLocale } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NotificationIcon } from "@/components/notification-icon"
import { createClient } from "@/lib/supabase/client"
import { useT, useLocale } from "@/components/i18n-provider"
import { notifyUnreadChanged } from "@/hooks/use-unread"
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  NOTIFICATION_TYPE_KEY,
  type NotificationItem,
  type NotificationRole,
} from "@/lib/queries/notifications"

const PAGE_SIZE = 20

/** Full notification history for one role, shared by the /notifications, /lender/notifications and
 *  /admin/notifications pages. Same data + Realtime subscription pattern as the header bell. */
export function NotificationsView({ role }: { role: NotificationRole }) {
  const t = useT("notificationCenter")
  const locale = useLocale()
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [tab, setTab] = useState<"all" | "unread">("all")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const unread = items.filter((n) => !n.isRead).length
  const visible = tab === "unread" ? items.filter((n) => !n.isRead) : items

  const refresh = useCallback(async () => {
    const supabase = createClient()
    try {
      const rows = await listNotifications(supabase, PAGE_SIZE, 0)
      setItems(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return
      channel = supabase
        .channel("notifications-page")
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

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const more = await listNotifications(createClient(), PAGE_SIZE, items.length)
      setItems((prev) => [...prev, ...more])
      setHasMore(more.length === PAGE_SIZE)
    } catch {
      /* leave list as-is; the button stays visible to retry */
    } finally {
      setLoadingMore(false)
    }
  }

  const onItemClick = (n: NotificationItem) => {
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      markNotificationRead(createClient(), n.id)
        .then(notifyUnreadChanged)
        .catch(() => void refresh())
    }
    const href = notificationHref(n, role)
    if (href) router.push(href)
  }

  const onMarkAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })))
    try {
      await markAllNotificationsRead(createClient())
      notifyUnreadChanged()
    } catch {
      void refresh()
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={onMarkAll} className="shrink-0">
            <Check className="h-3.5 w-3.5" /> {t("markAllRead")}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
          <TabsTrigger value="unread">
            {t("unread")}
            {unread > 0 && <span className="ml-1 text-xs">({unread})</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground mx-auto mb-4 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <Bell className="h-10 w-10 text-destructive mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">{tab === "unread" ? t("emptyUnread") : t("empty")}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
          {visible.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onItemClick(n)}
              className={`w-full text-left px-5 py-4 hover:bg-muted transition-colors flex gap-3 ${n.isRead ? "" : "bg-primary/5"}`}
            >
              <NotificationIcon type={n.type} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">{t(NOTIFICATION_TYPE_KEY[n.type])}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: locale === "fr" ? frLocale : undefined })}
                  </span>
                </div>
                <p className="text-sm text-foreground leading-snug">{n.body}</p>
              </div>
              {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
            </button>
          ))}
        </div>
      )}

      {!loading && !loadError && tab === "all" && hasMore && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("loadMore")}
          </Button>
        </div>
      )}
    </main>
  )
}
