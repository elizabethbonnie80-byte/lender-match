'use client'

/**
 * The red pip on a nav item (E-7, client 2026-07-30: "Maybe deal room and messages also need the
 * red bulb when there are new notifications?").
 *
 * Deliberately a dot and not a number: the exact figure already lives on the bell, and a second count in
 * the nav competes with it for attention rather than adding anything. `aria-hidden` with an accompanying
 * sr-only word so a screen reader is told "unread" once instead of announcing a decorative shape.
 *
 * Two placements, one component, so the colour lives in exactly one place:
 *  • default (`inline: false`) — the horizontal header bar. Positioned absolutely, so **the nav `<Link>`
 *    it sits in must be `relative`**, and it carries `ring-card` to read as a raised pip against the
 *    header's `bg-card`.
 *  • `inline` — the compact menu's vertical rows (`components/nav-menu.tsx`). Pushed to the end of the
 *    row instead of overlapping the label, and with no ring, because the sheet is `bg-background`, not
 *    `bg-card` — the card-coloured ring would draw a visible halo there.
 */
export function NavUnreadDot({
  count,
  label = 'unread',
  inline = false,
}: {
  count: number
  label?: string
  inline?: boolean
}) {
  if (count <= 0) return null
  return (
    <>
      <span
        aria-hidden
        className={
          inline
            ? 'ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive'
            : 'absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card'
        }
      />
      <span className="sr-only"> ({label})</span>
    </>
  )
}
