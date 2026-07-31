'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Zap, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { getAutoOfferStatus, setAutoOffersEnabled } from '@/lib/queries/auto-offers'

/**
 * Auto-offer status + master switch at the top of New Deals (E-11, client 2026-07-30).
 *
 *   "can we make the auto-offers box more accessible? Right now it's a bit hidden in settings. Maybe we
 *    can have an auto-offer switch always at the top … with an auto-offers settings button beside it.
 *    Otherwise it's a bit hard to find or even know it exists?"
 *
 * The complaint was fair: the Auto-Offers section was the 4th of 6 in lender Settings, below the entire
 * Saved Filters list, so a lender who never scrolled that far never learned the feature existed. This
 * puts it on the page they land on, and the Manage button is the discoverable route into the editor.
 *
 * The switch is the lender-level MASTER (profiles.auto_offers_enabled), not the per-offer pause — see
 * migration 64 for why those stay two separate bits.
 *
 * Renders nothing when the lender has never created an auto-offer: an empty strip advertising a feature
 * with no content would be noise on the busiest screen in the app. They meet it in Settings first, and
 * from then on it is pinned here.
 */
export function AutoOfferStrip() {
  const t = useT('autoOffers')
  const supabase = useMemo(() => createClient(), [])
  const [enabled, setEnabled] = useState(false)
  const [activeCount, setActiveCount] = useState(0)
  const [hasAny, setHasAny] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await getAutoOfferStatus(supabase)
      setEnabled(s.enabled)
      setActiveCount(s.activeCount)
      // `activeCount` only counts sendable rows, so a lender whose only auto-offer is paused would look
      // like they have none. Ask the table directly whether anything exists at all.
      const { count } = await supabase.from('auto_offers').select('id', { count: 'exact', head: true })
      setHasAny((count ?? 0) > 0)
    } catch {
      setHasAny(false)
    }
  }, [supabase])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (next: boolean) => {
    setBusy(true)
    setEnabled(next) // optimistic — the switch should not lag under the finger
    try {
      await setAutoOffersEnabled(supabase, next)
      toast.success(next ? t('masterOnToast') : t('masterOffToast'))
    } catch (err) {
      setEnabled(!next)
      toast.error(err instanceof Error ? err.message : t('masterErr'))
    } finally {
      setBusy(false)
    }
  }

  if (!hasAny) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4 rounded-lg border border-border bg-card px-4 py-2.5">
      <Zap className={`h-4 w-4 shrink-0 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="text-sm font-medium text-foreground">{t('stripTitle')}</span>
      <span className="text-xs text-muted-foreground">
        {enabled ? t('stripActive', { count: activeCount }) : t('stripOff')}
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label={t('stripTitle')} />
        {/* asChild, so the Button renders AS the anchor. Wrapping a <Button> in a <Link> nests a
            <button> inside an <a>; the inner button swallows the click and the navigation never
            happens — which is exactly how this failed in QA. */}
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/lender/settings#auto-offers">
            <Settings2 className="h-3.5 w-3.5" />
            {t('stripManage')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
