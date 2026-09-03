'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Ban, ShieldOff, X, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Org } from '@/lib/queries/blocks'

type Tf = (key: string, vars?: Record<string, string | number>) => string

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted">
        <span className="text-primary"><Ban className="h-4 w-4" /></span>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

/**
 * Bilateral-block manager shared by the broker settings (block lender institutions) and the lender
 * settings (block brokerages). Persists to broker_blocked_institutions / lender_blocked_brokerages via
 * the `onBlock`/`onUnblock` callbacks — which really change deal visibility (lender_can_see_deal). The
 * shared i18n keys (blockedToast, allBlocked, blockTitle, …) exist identically in both `settings` and
 * `lenderSettings`; only the section title, add label and intro differ, passed in explicitly.
 */
export function BlockManager({
  t,
  title,
  addLabel,
  intro,
  orgs,
  blockedIds,
  loading,
  onBlock,
  onUnblock,
  maxBlocked,
  limitHelperText,
  limitReachedText,
}: {
  t: Tf
  title: string
  addLabel: string
  intro: string
  orgs: Org[]
  blockedIds: string[]
  loading: boolean
  onBlock: (id: string) => Promise<void>
  onUnblock: (id: string) => Promise<void>
  /** Round 4: when set, caps how many can be blocked and drives the "N of max" / limit-reached UI.
   *  Omitted by the lender's brokerage-blocking usage, which stays unlimited exactly as before. */
  maxBlocked?: number
  /** Shown under the intro, only when `maxBlocked` is set (e.g. "You may block up to 5..."). */
  limitHelperText?: string
  /** Shown next to the (disabled) add control once at the cap, and used as the toast message if a
   *  BLOCK_LIMIT_REACHED error ever reaches the client despite the control being disabled (stale
   *  browser state, another tab/session). */
  limitReachedText?: string
}) {
  const [selected, setSelected] = useState('')
  const [pendingBlock, setPendingBlock] = useState<Org | null>(null)
  const [pendingUnblock, setPendingUnblock] = useState<Org | null>(null)
  const [busy, setBusy] = useState(false)

  const blockedSet = new Set(blockedIds)
  const available = orgs.filter((o) => !blockedSet.has(o.id))
  const blocked = orgs.filter((o) => blockedSet.has(o.id))
  const atLimit = maxBlocked !== undefined && blocked.length >= maxBlocked

  const onSelect = (id: string) => {
    setSelected(id)
    const org = orgs.find((o) => o.id === id)
    if (org) setPendingBlock(org)
  }

  const doBlock = async () => {
    if (!pendingBlock) return
    setBusy(true)
    try {
      await onBlock(pendingBlock.id)
      toast.success(t('blockedToast', { name: pendingBlock.name }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('blockDesc')
      toast.error(msg === 'BLOCK_LIMIT_REACHED' ? (limitReachedText ?? msg) : msg)
    } finally {
      setPendingBlock(null)
      setSelected('')
      setBusy(false)
    }
  }

  const doUnblock = async () => {
    if (!pendingUnblock) return
    setBusy(true)
    try {
      await onUnblock(pendingUnblock.id)
      toast.success(t('unblockedToast', { name: pendingUnblock.name }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('unblockDesc'))
    } finally {
      setPendingUnblock(null)
      setBusy(false)
    }
  }

  return (
    <>
      <Section title={title}>
        <div className="mb-5">
          <p className="text-sm text-muted-foreground">{intro}</p>
          {limitHelperText && <p className="text-sm text-muted-foreground mt-1">{limitHelperText}</p>}
        </div>

        <div className="flex gap-3 items-end mb-6">
          <div className="flex-1 space-y-2">
            <Label htmlFor="block-select">{addLabel}</Label>
            <Select value={selected} onValueChange={onSelect} disabled={loading || atLimit}>
              <SelectTrigger id="block-select" className="bg-muted/50">
                <SelectValue placeholder={t('blockPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">{t('allBlocked')}</div>
                ) : (
                  available.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {o.name}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {atLimit && limitReachedText && (
              <p className="text-xs font-medium text-destructive">{limitReachedText}</p>
            )}
          </div>
        </div>

        {blocked.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-border rounded-lg">
            <ShieldOff className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('noneBlocked')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">
              {maxBlocked !== undefined
                ? t('blockedListLimited', { count: blocked.length, max: maxBlocked })
                : t('blockedList', { count: blocked.length })}
            </p>
            {blocked.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 bg-muted/50 border border-border rounded-lg">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium text-foreground">{o.name}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive gap-1.5" onClick={() => setPendingUnblock(o)}>
                  <X className="h-3.5 w-3.5" />
                  {t('unblock')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <AlertDialog open={!!pendingBlock} onOpenChange={(o) => { if (!o && !busy) { setPendingBlock(null); setSelected('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('blockTitle', { name: pendingBlock?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('blockDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => { setSelected(''); setPendingBlock(null) }}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void doBlock() }}>{t('confirmBlock')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingUnblock} onOpenChange={(o) => { if (!o && !busy) setPendingUnblock(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unblockTitle', { name: pendingUnblock?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('unblockDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => setPendingUnblock(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void doUnblock() }}>{t('confirmUnblock')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
