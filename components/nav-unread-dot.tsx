'use client'

/**
 * The red pip on a header nav item (E-7, client 2026-07-30: "Maybe deal room and messages also need the
 * red bulb when there are new notifications?").
 *
 * Positioned absolutely, so the nav <Link> it sits in must be `relative`. Deliberately a dot and not a
 * number: the exact figure already lives on the bell, and a second count in the nav competes with it for
 * attention rather than adding anything. `aria-hidden` with an accompanying sr-only word so a screen
 * reader is told "unread" once instead of announcing a decorative shape.
 */
export function NavUnreadDot({ count, label = 'unread' }: { count: number; label?: string }) {
  if (count <= 0) return null
  return (
    <>
      <span
        aria-hidden
        className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card"
      />
      <span className="sr-only"> ({label})</span>
    </>
  )
}
