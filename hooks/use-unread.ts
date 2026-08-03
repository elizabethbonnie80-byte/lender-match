'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { listThreads } from '@/lib/queries/messages'
import {
  DEAL_SURFACE_TYPES,
  unreadNotificationCount,
  type NotificationRole,
} from '@/lib/queries/notifications'

export type UnreadCounts = {
  /** Every unread notification — an exact server count, not a count of what happens to be loaded. */
  total: number
  /** Unread notifications belonging to the role's dotted nav item (broker Deal Room / lender New Deals). */
  deals: number
  /** Unread MESSAGES (not notifications) across every thread the user is in. */
  messages: number
  ready: boolean
}

const EMPTY: UnreadCounts = { total: 0, deals: 0, messages: 0, ready: false }

/**
 * ONE store for the whole app — not one per `useUnread()` caller.
 *
 * ⚠️ This is a real fix, not tidying (F-1, client 2026-08-02). The hook is mounted at least twice on a
 * landing page: once in the header (bell + nav dots) and once in `UnreadBanner`. Per-instance state meant
 * per-instance Realtime channels, and both called `supabase.channel('notifications-unread')` — the SAME
 * topic. Two subscriptions on one topic: one receives the events and the other silently never does.
 * Observed on staging as the banner announcing "1 unread notification" beside a bell with no badge and a
 * nav item with no dot, from a single inserted row.
 *
 * Giving each instance a unique topic would have stopped the events from being lost, but it would leave
 * two independent fetchers that only usually agree — and two numbers on one screen disagreeing is the
 * exact class of thing the client reported. Sharing the state removes the disagreement by construction,
 * and halves the queries per navigation while it is at it.
 */
let counts: UnreadCounts = EMPTY
let storeRole: NotificationRole | null = null
const subscribers = new Set<() => void>()

/** The single Realtime channel, reference-counted across mounted consumers. */
let channel: RealtimeChannel | null = null
let channelUserId: string | null = null
let channelRefs = 0

function publish(next: UnreadCounts) {
  counts = next
  for (const notify of subscribers) notify()
}

/** Re-count from the server and publish to every consumer. */
async function refresh() {
  const role = storeRole
  if (!role) return
  const supabase = createClient()
  try {
    const [total, deals, threads] = await Promise.all([
      unreadNotificationCount(supabase),
      DEAL_SURFACE_TYPES[role].length > 0
        ? unreadNotificationCount(supabase, DEAL_SURFACE_TYPES[role])
        : Promise.resolve(0),
      role !== 'admin' ? listThreads(supabase) : Promise.resolve([]),
    ])
    // A role switch mid-flight would publish the previous user's numbers.
    if (storeRole !== role) return
    publish({
      total,
      deals,
      messages: threads.reduce((sum, t) => sum + t.unread, 0),
      ready: true,
    })
  } catch {
    /* unauthenticated or transient — keep whatever we last had rather than flashing zeros */
  }
}

/**
 * Tell the store to re-count NOW. Call it right after a write that changes read state — mark one
 * notification read, mark all read, mark a chat read.
 *
 * ⚠️ This is NOT redundant with the Realtime subscription, and removing it silently breaks the client's
 * F-1 request ("it should also go away once they review the new notifications"). Realtime delivers the
 * INSERTs but **not** the `is_read` UPDATEs: `notifications` has REPLICA IDENTITY DEFAULT, so on an UPDATE
 * the old tuple carries only the primary key and the subscription's `recipient_id=eq.<uid>` filter has
 * nothing to match, so the event is dropped. Measured on both local and staging (both `relreplident = 'd'`)
 * — inserting a row lit the badge live, while "Mark all read" left the badge, the nav dot and the banner
 * showing the old count against a database that already said 0, until the next navigation or reload.
 *
 * The server-side alternative (`alter table notifications replica identity full`) would also work and is
 * deliberately not used: it writes the entire previous row into the WAL on every UPDATE of the app's
 * busiest table, purely to broadcast an event back to the tab that caused it. Read state is only ever
 * written by the user's own client, so a local call is both sufficient and exact. The one thing it does not
 * cover is a SECOND tab open on the same account — that tab still corrects itself on its next navigation,
 * which is the same guarantee it had before.
 */
export function notifyUnreadChanged() {
  void refresh()
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange)
  return () => {
    subscribers.delete(onStoreChange)
  }
}

const getSnapshot = () => counts
const getServerSnapshot = () => EMPTY

/**
 * Shared unread state for the header badges, the nav dots and the landing banner (E-7, client
 * 2026-07-30: "can we make the notifications more prominent? … Maybe deal room and messages also need
 * the red bulb").
 *
 * Two different sources on purpose, because they are two different questions:
 *  • the deal dot counts unread NOTIFICATIONS of that nav item's types — which is literally what she
 *    asked for, and it clears when the notification is read or "mark all read" is used. Which types
 *    those are is not arbitrary: a type that fires on a SCHEDULE rather than on an event cannot feed a
 *    dot, or the dot never goes dark. That is the F-1 fix — see `DEAL_SURFACE_TYPES`;
 *  • the messages dot counts unread MESSAGES via `my_chat_threads`. That is the truthful signal and it
 *    self-clears through `mark_chat_read` when the thread is opened, so the dot cannot outlive the
 *    conversation the way a notification-derived one would.
 *
 * Refreshed on mount, on every notifications Realtime event, on `notifyUnreadChanged()` (any read action
 * taken in this tab — Realtime does not deliver the `is_read` UPDATEs, see that function), and on
 * navigation. The last one is the backstop that also covers a second tab on the same account.
 *
 * Every caller shares one store and one Realtime channel, so the bell, the dots and the banner cannot
 * report different numbers — see the store comment above for why that mattered.
 */
export function useUnread(role: NotificationRole): UnreadCounts {
  const pathname = usePathname()
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Re-count on mount, on navigation, and whenever the signed-in role changes.
  useEffect(() => {
    if (storeRole !== role) {
      storeRole = role
      counts = EMPTY // signing in as a different role must not inherit the previous user's numbers
    }
    void refresh()
  }, [role, pathname])

  // One Realtime channel for the app, held open while at least one consumer is mounted.
  useEffect(() => {
    let released = false
    channelRefs += 1

    const supabase = createClient()
    // getUser() is async, so in Strict Mode the cleanup can run before it resolves; `released` makes the
    // stale callback a no-op instead of leaving an orphaned subscription behind.
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (released || !user) return
      if (channel && channelUserId === user.id) return // already subscribed for this user
      if (channel) void supabase.removeChannel(channel)
      channelUserId = user.id
      channel = supabase
        .channel('notifications-unread')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
          () => void refresh(),
        )
        .subscribe()
    })

    return () => {
      released = true
      channelRefs -= 1
      if (channelRefs <= 0 && channel) {
        void supabase.removeChannel(channel)
        channel = null
        channelUserId = null
        channelRefs = 0
      }
    }
  }, [])

  return snapshot
}
