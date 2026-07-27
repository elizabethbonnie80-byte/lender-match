'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listActiveLogos, type LenderLogo } from '@/lib/queries/logos'
import { useT } from '@/components/i18n-provider'

/**
 * Round 3 Phase 3 — the lender logos on the sign-in page. The list is admin-maintained
 * (/admin/logos) and anon-readable, so this runs fine on the unauthenticated page.
 *
 * Renders NOTHING until there is at least one logo: an empty strip (or a "no logos yet" message) on
 * the login page would be worse than no strip at all.
 *
 * It only SCROLLS once one pass of the list is wider than the strip. With a handful of logos the list
 * is narrower than the strip, and translating it -50% simply walked it off the left edge and left the
 * rest of the strip blank — so a short list is centred and held still instead. When it does scroll,
 * the track holds the list twice and animates to -50% for a seamless loop (see `.ll-marquee` in
 * globals.css); each pass carries a trailing gap so the seam spacing matches the internal spacing.
 * Hovering pauses it, and it holds still under prefers-reduced-motion.
 */
export function LogoMarquee() {
  const supabase = useMemo(() => createClient(), [])
  const t = useT('signIn')
  const [logos, setLogos] = useState<LenderLogo[]>([])
  const stripRef = useRef<HTMLDivElement>(null)
  const passRef = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)

  useEffect(() => {
    let active = true
    listActiveLogos(supabase)
      .then((rows) => { if (active) setLogos(rows) })
      .catch(() => {}) // decorative — never block sign-in on it
    return () => { active = false }
  }, [supabase])

  // Measure rather than guess: logo widths vary (a square icon vs a wide wordmark), so the number of
  // logos alone doesn't say whether the list overflows.
  const measure = useCallback(() => {
    const strip = stripRef.current
    const pass = passRef.current
    if (!strip || !pass) return
    setScrolls(pass.scrollWidth > strip.clientWidth)
  }, [])

  // The first measurement is a plain synchronous call, NOT a ResizeObserver callback: the images may
  // still be loading (zero width) at that point, so each one also re-measures on load. The observer
  // then only has to catch later container changes. Belt and braces on purpose — RO callbacks are not
  // delivered at all while a tab is hidden.
  useEffect(() => {
    if (logos.length === 0) return
    measure()
    const strip = stripRef.current
    const pass = passRef.current
    if (!strip || !pass) return
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    observer.observe(pass)
    return () => observer.disconnect()
  }, [logos, measure])

  if (logos.length === 0) return null

  // Long lists should not scroll faster; keep a steady ~6s per logo.
  const duration = `${Math.max(20, logos.length * 6)}s`

  // NB: the row must never wrap and the images must never shrink, in either mode. If the row could
  // wrap it would always fit, scrollWidth would never exceed clientWidth, and the measurement below
  // could never flip a long list into scrolling mode.
  const row = (hidden: boolean) => (
    <div
      ref={hidden ? undefined : passRef}
      aria-hidden={hidden || undefined}
      className={`flex items-center gap-16 shrink-0 ${scrolls ? 'pr-16' : 'justify-center'}`}
    >
      {logos.map((logo) => (
        // eslint-disable-next-line @next/next/no-img-element -- Storage URLs are runtime data, not build-time assets
        <img
          key={logo.id}
          src={logo.url}
          alt={hidden ? '' : logo.name}
          onLoad={measure}
          // Client 2026-07-23 (A-4): "have the lender logos showing in color, and a bit bigger? They
          // look good on a mobile phone but very small on a computer." So: no greyscale, no dimming,
          // and taller — h-10 was the culprit on a desktop viewport.
          className="h-16 w-auto shrink-0 object-contain"
        />
      ))}
    </div>
  )

  return (
    <section className="w-full max-w-4xl mx-auto mt-12" aria-label={t('logosLabel')}>
      <div ref={stripRef} className="ll-marquee relative overflow-hidden">
        {/* fade the edges so logos slide in/out instead of popping — only while it moves */}
        {scrolls && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent z-10" />
          </>
        )}
        <div
          className={scrolls ? 'll-marquee-track flex w-max' : 'flex justify-center'}
          style={scrolls ? { ['--ll-marquee-duration' as string]: duration } : undefined}
        >
          {row(false)}
          {scrolls && row(true)}
        </div>
      </div>
    </section>
  )
}
