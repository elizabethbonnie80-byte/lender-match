import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type NotificationType = Database["public"]["Enums"]["notification_type"]

export type NotificationItem = {
  id: string
  type: NotificationType
  body: string
  dealId: string | null
  offerId: string | null
  isRead: boolean
  createdAt: string
}

/** notification_type → the `notificationCenter` i18n key for its display label. */
export const NOTIFICATION_TYPE_KEY: Record<NotificationType, string> = {
  new_offer: "typeNewOffer",
  offer_accepted: "typeOfferAccepted",
  offer_switched: "typeOfferSwitched",
  message_received: "typeMessageReceived",
  deal_expiring: "typeDealExpiring",
  deal_expired: "typeDealExpired",
  filter_match: "typeFilterMatch",
  survey_pending: "typeSurveyPending",
  lender_approved: "typeLenderApproved",
  lender_rejected: "typeLenderRejected",
  auto_offer_sent: "typeAutoOfferSent",
  prequal_converted: "typePrequalConverted",
}

export type NotificationRole = "broker" | "lender" | "admin"

/** Where clicking a notification should navigate, given the viewer's role. Null = no destination
 *  (just mark it read). Types are inherently recipient-scoped (e.g. `offer_accepted` only ever
 *  reaches a lender), so only `message_received` needs a role branch. */
export function notificationHref(n: Pick<NotificationItem, "type" | "dealId">, role: NotificationRole): string | null {
  if (role === "admin") return null
  switch (n.type) {
    case "message_received":
      return role === "lender" ? "/lender/messages" : "/messages"
    case "new_offer":
    case "deal_expiring":
    case "deal_expired":
    case "survey_pending":
      return n.dealId ? `/deal-detail/${n.dealId}` : "/deal-room"
    case "filter_match":
      return "/lender/new-deals"
    case "offer_accepted":
    case "offer_switched":
    // The daily auto-offer digest: the offers it lists stay editable in Submitted Offers.
    case "auto_offer_sent":
    // A prequal the lender bid on went live — their carried-over offer lives in Submitted Offers.
    case "prequal_converted":
      return "/lender/submitted-offers"
    case "lender_approved":
    case "lender_rejected":
      return "/lender/settings"
    default:
      return null
  }
}

/** The current user's notifications, newest first (RLS: recipient only). */
export async function listNotifications(supabase: DB, limit = 20, offset = 0): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, body, deal_id, offer_id, is_read, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    body: n.body,
    dealId: n.deal_id,
    offerId: n.offer_id,
    isRead: n.is_read,
    createdAt: n.created_at,
  }))
}

/**
 * Count of the current user's unread notifications — an EXACT server-side count, optionally narrowed
 * to a set of types.
 *
 * ⚠️ Do not go back to deriving this from `listNotifications`. That was the E-7 bug (client 2026-07-30):
 * the bell counted unread inside the newest 20 rows it had fetched, so a user with 30 unread was shown
 * a smaller number — on the very badge that is supposed to tell them how much they have missed.
 */
export async function unreadNotificationCount(supabase: DB, types?: readonly NotificationType[]): Promise<number> {
  let q = supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false)
  if (types && types.length > 0) q = q.in("type", [...types])
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Which notification types put an unread dot on which nav item (E-7), per role.
 *
 * The client asked for a dot where there is "something new to look at", and `message_received` is
 * deliberately absent from all of these: the Messages dot uses the real per-thread unread count
 * instead, which self-clears via `mark_chat_read` when the thread is opened.
 *
 * ⚠️ The lender's dot belongs to **New Deals**, not Submitted Offers, and that is a correction —
 * client 2026-07-30 follow-up (F-1): "there is a permanent red notification dot where it says
 * submitted offers … it's fine to have one for new deals or messages, but we don't need that
 * elsewhere." Two separate mistakes made it look permanent:
 *
 *  1. `auto_offer_sent` is the DAILY digest cron. Any lender with a live auto-offer got a fresh unread
 *     row every morning, so the dot re-lit itself every day for the life of the account — the exact
 *     "permanent" she reported. A recurring, scheduled notification type must never feed a nav dot;
 *     the dot's job is "something new happened", and a daily heartbeat carries no such information.
 *  2. `filter_match` was pointed at the wrong page. It means "a new deal matched your filter", which
 *     lives on New Deals — `notificationHref` has always routed it to `/lender/new-deals`. So the dot
 *     and the click destination disagreed: it lit up Submitted Offers over a deal that was not there.
 *
 * `filter_match` alone is therefore the honest lender signal, and it lands on the page it points to.
 * The remaining lender types (offer accepted/switched, digest, prequal converted) still reach the bell,
 * the notifications page and the banner — they just no longer brand a nav item permanently red.
 *
 * The broker list is unchanged: every type in it fires once per deal event, never on a schedule.
 *
 * Admin has no deal surface in its nav, hence the empty list.
 */
export const DEAL_SURFACE_TYPES: Record<NotificationRole, readonly NotificationType[]> = {
  broker: ["new_offer", "deal_expiring", "deal_expired", "survey_pending"],
  lender: ["filter_match"],
  admin: [],
}

/** Mark one notification read (RLS: notifications_mark_read, recipient only). */
export async function markNotificationRead(supabase: DB, id: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id)
  if (error) throw new Error(error.message)
}

/** Mark every unread notification of the current user read. */
export async function markAllNotificationsRead(supabase: DB) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("is_read", false)
  if (error) throw new Error(error.message)
}

// ── Notification preferences (the profile toggles that notify() honours) ────────

/** The per-user notification toggles, keyed by their `profiles` column names. */
export type NotificationPrefKey =
  | "notify_new_offer"
  | "notify_offer_accepted"
  | "notify_message"
  | "notify_deal_expiring"
  | "notify_filter_match"
  | "notify_inapp_enabled"
  | "notify_email_enabled"

export type NotificationPrefs = Record<NotificationPrefKey, boolean>

const PREF_KEYS: NotificationPrefKey[] = [
  "notify_new_offer",
  "notify_offer_accepted",
  "notify_message",
  "notify_deal_expiring",
  "notify_filter_match",
  "notify_inapp_enabled",
  "notify_email_enabled",
]

/** Read the current user's notification toggles (RLS: own profile). */
export async function getNotificationPrefs(supabase: DB): Promise<NotificationPrefs> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const { data, error } = await supabase
    .from("profiles")
    .select(PREF_KEYS.join(", "))
    .eq("id", user.id)
    .single()
  if (error) throw new Error(error.message)
  const row = data as unknown as NotificationPrefs
  return Object.fromEntries(PREF_KEYS.map((k) => [k, row[k] ?? true])) as NotificationPrefs
}

/** Toggle one notification preference on the current user's profile. */
export async function updateNotificationPref(supabase: DB, key: NotificationPrefKey, value: boolean) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const patch = { [key]: value } as Database["public"]["Tables"]["profiles"]["Update"]
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id)
  if (error) throw new Error(error.message)
}
