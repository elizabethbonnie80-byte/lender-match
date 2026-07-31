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
  /** Unread notifications belonging to the role's deal surface (Deal Room / Submitted Offers). */
  deals: number
  /** Unread MESSAGES (not notifications) across every thread the user is in. */
  messages: number
  ready: boolean
}

const EMPTY: UnreadCounts = { total: 0, deals: 0, messages: 0, ready: false }

/**
 * Shared unread state for the header badges, the nav dots and the landing banner (E-7, client
 * 2026-07-30: "can we make the notifications more prominent? … Maybe deal room and messages also need
 * the red bulb").
 *
 * Two different sources on purpose, because they are two different questions:
 *  • the deal dot counts unread NOTIFICATIONS of that surface's types — which is literally what she
 *    asked for, and it clears when the notification is read or "mark all read" is used;
 *  • the messages dot counts unread MESSAGES via `my_chat_threads`. That is the truthful signal and it
 *    self-clears through `mark_chat_read` when the thread is opened, so the dot cannot outlive the
 *    conversation the way a notification-derived one would.
 *
 * Refreshed on mount, on every notifications Realtime event, and on navigation — the last one covers
 * reading a thread (which writes no notification) and the case where a user has turned the
 * `message_received` notification type off entirely.
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
