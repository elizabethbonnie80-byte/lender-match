'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'
import { BRAND } from '@/lib/brand'
import { productTermYears, platformBpsFor } from '@/lib/queries/deals'
import {
  listAutoOffers,
  createAutoOffer,
  updateAutoOffer,
  setAutoOfferActive,
  deleteAutoOffer,
  EMPTY_AUTO_OFFER,
  type AutoOfferRow,
  type AutoOfferInput,
} from '@/lib/queries/auto-offers'
import { listSavedFilters, type SavedFilterRow } from '@/lib/queries/saved-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FieldError, RequiredFieldsNote } from '@/components/field-error'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { CheckCircle, Pencil, Trash2, Zap } from 'lucide-react'
import type { Database } from '@/lib/database.types'

type MortgageProduct = Database['public']['Enums']['mortgage_product']

/**
 * Round 3 Phase 3 — the lender's saved "standard offers" (migration 47). Each one rides on a saved
 * filter: when a submitted deal matches that filter in full, has no notes and has "No lender
 * exceptions required" checked, the offer is sent automatically on the lender's behalf. Lives in
 * lender Settings next to the saved filters it depends on.
 */
export function AutoOfferManager() {
  const t = useT('autoOffers')
  const enums = useEnums()
  const supabase = useMemo(() => createClient(), [])

  const [rows, setRows] = useState<AutoOfferRow[]>([])
  const [filters, setFilters] = useState<SavedFilterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [flashMsg, setFlashMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AutoOfferRow | null>(null)

  const [editing, setEditing] = useState<AutoOfferInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const flash = (msg: string) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(null), 3500) }

  const load = useCallback(async () => {
    const [a, f] = await Promise.all([listAutoOffers(supabase), listSavedFilters(supabase)])
    setRows(a)
    setFilters(f)
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => flash(err instanceof Error ? err.message : t('couldNotLoad')))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const openNew = () => {
    setEditing({ ...EMPTY_AUTO_OFFER, savedFilterId: filters[0]?.id ?? '' })
    setEditingId(null)
    setAttempted(false)
  }
  const openEdit = (r: AutoOfferRow) => {
    const { id: _id, sentCount: _s, lastSentAt: _l, filterName: _f, ...input } = r
    setEditing(input)
    setEditingId(r.id)
    setAttempted(false)
  }
  const patch = (p: Partial<AutoOfferInput>) => setEditing((e) => (e ? { ...e, ...p } : e))
  const close = () => { setEditing(null); setEditingId(null) }

  // Required: name, filter, product, rate, commission, rate lock. The rest are optional.
  const missing = !editing
    || !editing.name.trim()
    || !editing.savedFilterId
    || !editing.mortgageProduct
    || !(editing.rate > 0)
    || !(editing.commissionBps > 0)
    || !(editing.rateLockDays > 0)

  const save = async () => {
    if (!editing || saving) return
    if (missing) { setAttempted(true); return }
    setSaving(true)
    try {
      if (editingId) await updateAutoOffer(supabase, editingId, editing)
      else await createAutoOffer(supabase, editing)
      await load()
      flash(t('savedToast', { name: editing.name.trim() }))
      close()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('couldNotSave'))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteAutoOffer(supabase, deleting.id)
      await load()
      flash(t('deletedToast', { name: deleting.name }))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('couldNotDelete'))
    } finally {
      setDeleting(null)
    }
  }

  const toggleActive = async (r: AutoOfferRow, active: boolean) => {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: active } : x)))
    try {
      await setAutoOfferActive(supabase, r.id, active)
    } catch {
      await load() // revert the optimistic change
    }
  }

  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
  const invalid = (bad: boolean) => (attempted && bad ? 'border-destructive focus-visible:ring-destructive' : '')
  const Req = () => <span className="text-destructive ml-0.5">*</span>

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-5">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Button
          size="sm" className="shrink-0" onClick={openNew}
          disabled={filters.length === 0}
          title={filters.length === 0 ? t('needFilter') : undefined}
        >
          {t('new')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2 mb-4">
        {t('rules')}
      </p>

      {flashMsg && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-2.5 mb-4">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {flashMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse py-8 text-center">{t('loading')}</p>
      ) : filters.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-border rounded-lg">
          <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{t('needFilter')}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-border rounded-lg">
          <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{t('none')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('noneHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const netBps = Math.max(0, r.commissionBps - platformBpsFor(r.mortgageProduct))
            const expired = r.endDate !== null && r.endDate < new Date().toISOString().slice(0, 10)
            return (
              <div key={r.id} className="bg-muted/40 border border-border rounded-lg px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {enums.LABELS.mortgage_product[r.mortgageProduct]} · {r.rate.toFixed(2)}% ·{' '}
                      {t('bpsNet', { gross: r.commissionBps, net: netBps })} · {t('lockDays', { days: r.rateLockDays })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('onFilter', { name: r.filterName })}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('sentCount', { count: r.sentCount })}
                      {r.endDate ? ` · ${expired ? t('ended', { date: r.endDate }) : t('endsOn', { date: r.endDate })}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={t('edit')} onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      title={t('delete')} onClick={() => setDeleting(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    {r.isActive ? t('activeSends') : t('paused')}
                  </span>
                  <Switch checked={r.isActive} onCheckedChange={(v) => toggleActive(r, v)} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Editor dialog ── */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              {editingId ? t('editTitle') : t('newTitle')}
            </DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-5 py-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ao-name" className="text-xs">{t('name')}<Req /></Label>
                  <Input id="ao-name" value={editing.name} placeholder={t('namePlaceholder')}
                    className={`bg-muted/50 h-9 ${invalid(!editing.name.trim())}`}
                    onChange={(e) => patch({ name: e.target.value })} autoFocus />
                  <FieldError show={attempted && !editing.name.trim()} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('filter')}<Req /></Label>
                  <Select value={editing.savedFilterId} onValueChange={(v) => patch({ savedFilterId: v })}>
                    <SelectTrigger className={`bg-muted/50 h-9 w-full ${invalid(!editing.savedFilterId)}`}>
                      <SelectValue placeholder={t('filterPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {filters.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('filterHint')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('product')}<Req /></Label>
                  <Select value={editing.mortgageProduct}
                    onValueChange={(v) => patch({ mortgageProduct: v as MortgageProduct })}>
                    <SelectTrigger className="bg-muted/50 h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {enums.MORTGAGE_PRODUCT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-rate" className="text-xs">{t('rate')}<Req /></Label>
                  <Input id="ao-rate" type="number" step="0.01" value={editing.rate || ''}
                    className={`bg-muted/50 h-9 ${invalid(!(editing.rate > 0))}`}
                    onChange={(e) => patch({ rate: Number(e.target.value) })} />
                  <FieldError show={attempted && !(editing.rate > 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-bps" className="text-xs">{t('commission')}<Req /></Label>
                  <Input id="ao-bps" type="number" value={editing.commissionBps || ''}
                    className={`bg-muted/50 h-9 ${invalid(!(editing.commissionBps > 0))}`}
                    onChange={(e) => patch({ commissionBps: Number(e.target.value) })} />
                  <FieldError show={attempted && !(editing.commissionBps > 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-lock" className="text-xs">{t('rateLock')}<Req /></Label>
                  <Input id="ao-lock" type="number" value={editing.rateLockDays || ''}
                    className={`bg-muted/50 h-9 ${invalid(!(editing.rateLockDays > 0))}`}
                    onChange={(e) => patch({ rateLockDays: Number(e.target.value) })} />
                  <FieldError show={attempted && !(editing.rateLockDays > 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-commit" className="text-xs">{t('commitment')}</Label>
                  <Input id="ao-commit" type="number" value={editing.commitmentTurnTimeDays ?? ''}
                    className="bg-muted/50 h-9"
                    onChange={(e) => patch({ commitmentTurnTimeDays: numOrNull(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-doc" className="text-xs">{t('docReview')}</Label>
                  <Input id="ao-doc" type="number" value={editing.docReviewTurnTimeDays ?? ''}
                    className="bg-muted/50 h-9"
                    onChange={(e) => patch({ docReviewTurnTimeDays: numOrNull(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-fee" className="text-xs">{t('lenderFeePct')}</Label>
                  <Input id="ao-fee" type="number" step="0.1" value={editing.lenderFeePct ?? ''}
                    className="bg-muted/50 h-9"
                    onChange={(e) => patch({ lenderFeePct: numOrNull(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">{t('lenderFeePctHint')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ao-end" className="text-xs">{t('endDate')}</Label>
                  <Input id="ao-end" type="date" value={editing.endDate ?? ''}
                    className="bg-muted/50 h-9"
                    onChange={(e) => patch({ endDate: e.target.value || null })} />
                  <p className="text-xs text-muted-foreground">{t('endDateHint')}</p>
                </div>
              </div>

              {/* Same platform-bps deduction preview the Make Offer dialog shows. */}
              {editing.commissionBps > 0 && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">
                        {(() => {
                          // An open mortgage has no term, so it takes a label that doesn't name one.
                          const years = productTermYears(editing.mortgageProduct)
                          return years === null
                            ? t('platformDeductionNoTerm', { brand: BRAND })
                            : t('platformDeduction', { brand: BRAND, term: years })
                        })()}
                      </span>
                      <span className="text-destructive whitespace-nowrap">
                        -{platformBpsFor(editing.mortgageProduct)} bps
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                      <span className="font-semibold text-foreground">{t('finalCommissionAmount')}</span>
                      <span className="font-semibold text-foreground whitespace-nowrap">
                        {Math.max(0, editing.commissionBps - platformBpsFor(editing.mortgageProduct))} bps
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2">
                <Switch checked={editing.isActive} onCheckedChange={(v) => patch({ isActive: v })} />
                <span className="text-xs text-muted-foreground">{t('activeCheckbox')}</span>
              </label>

              <p className="text-xs text-muted-foreground border-t border-border pt-3">{t('noCommentsHint')}</p>
            </div>
          )}

          <DialogFooter className="items-center sm:justify-between">
            <RequiredFieldsNote />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={close}>{t('cancel')}</Button>
              <Button onClick={save} disabled={saving} className={missing ? 'opacity-50' : ''}>
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleting(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={confirmDelete}>
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
