'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
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

/** Every mounted useUnread(), so a read action in this tab can re-count all of them at once. */
const listeners = new Set<() => void>()

/**
 * Tell every mounted `useUnread()` to re-count NOW. Call it right after a write that changes read state
 * — mark one notification read, mark all read, mark a chat read.
 *
 * ⚠️ This is NOT redundant with the Realtime subscription below, and removing it silently breaks the
 * client's F-1 request ("it should also go away once they review the new notifications"). Realtime
 * delivers the INSERTs but **not** the `is_read` UPDATEs: `notifications` has REPLICA IDENTITY DEFAULT,
 * so on an UPDATE the old tuple carries only the primary key and the subscription's
 * `recipient_id=eq.<uid>` filter has nothing to match, so the event is dropped. Measured locally —
 * inserting a row lit the badge live, while "Mark all read" left the badge, the nav dot and the banner
 * showing 53 against a database that already said 0, until the next navigation or reload.
 *
 * The server-side alternative (`alter table notifications replica identity full`) would also work and is
 * deliberately not used: it writes the entire previous row into the WAL on every UPDATE of the app's
 * busiest table, purely to broadcast an event back to the tab that caused it. Read state is only ever
 * written by the user's own client, so a local notification is both sufficient and exact. The one thing
 * it does not cover is a SECOND tab open on the same account — that tab still corrects itself on its
 * next navigation, which is the same guarantee it had before.
 */
export function notifyUnreadChanged() {
  for (const listener of listeners) listener()
}

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
 */
export function useUnread(role: NotificationRole): UnreadCounts {
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY)
  const pathname = usePathname()
  const wantsMessages = role !== 'admin'

  const refresh = useCallback(async () => {
    const supabase = createClient()
    try {
      const [total, deals, threads] = await Promise.all([
        unreadNotificationCount(supabase),
        DEAL_SURFACE_TYPES[role].length > 0
          ? unreadNotificationCount(supabase, DEAL_SURFACE_TYPES[role])
          : Promise.resolve(0),
        wantsMessages ? listThreads(supabase) : Promise.resolve([]),
      ])
      setCounts({
        total,
        deals,
        messages: threads.reduce((sum, t) => sum + t.unread, 0),
        ready: true,
      })
    } catch {
      /* unauthenticated or transient — keep whatever we last had rather than flashing zeros */
    }
  }, [role, wantsMessages])

  useEffect(() => {
    void refresh()
  }, [refresh, pathname])

  // Re-count when this tab marks something read — see notifyUnreadChanged() for why Realtime alone
  // cannot cover this.
  useEffect(() => {
    const listener = () => void refresh()
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [refresh])

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // Same Strict-Mode guard as the bell: getUser() is async, so in dev the cleanup can run before it
    // resolves and the stale callback would subscribe a second channel on this topic — which trips
    // Supabase's "cannot add postgres_changes callbacks after subscribe()".
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return
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
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [refresh])

  return counts
}
