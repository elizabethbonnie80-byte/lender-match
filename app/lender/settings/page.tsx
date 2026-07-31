'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { LenderHeader } from '@/components/lender-header'
import { NotificationPreferences } from '@/components/notification-preferences'
import { AccountSettings } from '@/components/account-settings'
import { BlockManager } from '@/components/block-manager'
import {
  listBrokerages,
  listBlockedBrokerages,
  blockBrokerage,
  unblockBrokerage,
  type Org,
} from '@/lib/queries/blocks'
import { Toaster } from 'sonner'
import { useT } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'
import { createClient } from '@/lib/supabase/client'
import {
  listSavedFilters,
  createSavedFilter,
  updateSavedFilter,
  deleteSavedFilter,
  setSavedFilterActive,
  EMPTY_SAVED_FILTER,
  type SavedFilterRow,
  type SavedFilterInput,
} from '@/lib/queries/saved-filters'
import { EnumField, NumberField } from '@/components/filter-fields'
import { AutoOfferManager } from '@/components/auto-offer-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FieldError, RequiredFieldsNote } from '@/components/field-error'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  CheckCircle,
  Bell,
  Filter,
  Pencil,
  Trash2,
  Clock,
  AlertCircle,
  SlidersHorizontal,
  Zap,
} from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Section({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted">
        <span className="text-primary">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Flash({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-2.5 mb-4">
      <CheckCircle className="h-4 w-4 shrink-0" />
      {msg}
    </div>
  )
}

// The saved-filter criterion inputs (EnumField / NumberField) are shared with the New Deals / Maturing
// Filters sidepanel — see components/filter-fields.tsx.

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function LenderSettingsPage() {
  const t = useT('lenderSettings')
  const enums = useEnums()
  const supabase = useMemo(() => createClient(), [])

  // ── 1. Brokerage blocking (wired: lender_blocked_brokerages) ──
  const [brokerages, setBrokerages] = useState<Org[]>([])
  const [blockedIds, setBlockedIds] = useState<string[]>([])
  const [blocksLoading, setBlocksLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([listBrokerages(supabase), listBlockedBrokerages(supabase)])
      .then(([orgs, blocked]) => { if (active) { setBrokerages(orgs); setBlockedIds(blocked) } })
      .catch(() => {})
      .finally(() => { if (active) setBlocksLoading(false) })
    return () => { active = false }
  }, [supabase])

  const onBlock = async (id: string) => {
    await blockBrokerage(supabase, id)
    setBlockedIds((prev) => [...prev, id])
  }
  const onUnblock = async (id: string) => {
    await unblockBrokerage(supabase, id)
    setBlockedIds((prev) => prev.filter((x) => x !== id))
  }

  // ── 2. Decline confirmation ──
  // skipUntil stores ISO timestamp until which confirmation is suppressed
  const [skipUntil, setSkipUntil] = useState<string | null>(null)
  const [declineFlash, setDeclineFlash] = useState<string | null>(null)

  const declineSkipActive = skipUntil !== null && new Date(skipUntil) > new Date()
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    if (!declineSkipActive || !skipUntil) return
    const format = () => {
      const diff = new Date(skipUntil).getTime() - Date.now()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setTimeLeft(t('timeRemaining', { h, m }))
    }
    const interval = setInterval(() => {
      if (new Date(skipUntil).getTime() - Date.now() <= 0) { setSkipUntil(null); clearInterval(interval); return }
      format()
    }, 60000)
    format() // set immediately
    return () => clearInterval(interval)
  }, [skipUntil, declineSkipActive, t])

  const handleDeclineSkipToggle = (enabled: boolean) => {
    if (enabled) {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      setSkipUntil(until)
      flash(setDeclineFlash, t('declineSuppressedToast'))
    } else {
      setSkipUntil(null)
      flash(setDeclineFlash, t('declineReEnabledToast'))
    }
  }

  // ── 3. Saved filters (real CRUD; these criteria drive the maturing-deals match %) ──
  const [filters, setFilters] = useState<SavedFilterRow[]>([])
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [deletingFilter, setDeletingFilter] = useState<SavedFilterRow | null>(null)
  const [filtersFlash, setFiltersFlash] = useState<string | null>(null)

  // Editor dialog: `editing` holds the form; `editingId` is null for a new filter, else the id.
  const [editing, setEditing] = useState<SavedFilterInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingFilter, setSavingFilter] = useState(false)
  const [filterShowErrors, setFilterShowErrors] = useState(false)

  const loadFilters = useCallback(async () => {
    setFilters(await listSavedFilters(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    loadFilters()
      .catch((err) => flash(setFiltersFlash, err instanceof Error ? err.message : t('couldNotLoad')))
      .finally(() => { if (active) setFiltersLoading(false) })
    return () => { active = false }
  }, [loadFilters, t])

  const openNewFilter = () => { setEditing({ ...EMPTY_SAVED_FILTER }); setEditingId(null); setFilterShowErrors(false) }
  const openEditFilter = (f: SavedFilterRow) => {
    const { id: _id, criteriaCount: _c, criteriaPreview: _p, ...input } = f
    setEditing(input)
    setEditingId(f.id)
    setFilterShowErrors(false)
  }
  const patchEditing = (patch: Partial<SavedFilterInput>) =>
    setEditing((e) => (e ? { ...e, ...patch } : e))

  const handleSaveFilter = async () => {
    if (!editing || savingFilter) return
    if (!editing.name.trim()) {
      setFilterShowErrors(true)
      return
    }
    setSavingFilter(true)
    try {
      if (editingId) await updateSavedFilter(supabase, editingId, editing)
      else await createSavedFilter(supabase, editing)
      await loadFilters()
      flash(setFiltersFlash, t('filterSavedToast', { name: editing.name.trim() }))
      setEditing(null)
      setEditingId(null)
    } catch (err) {
      flash(setFiltersFlash, err instanceof Error ? err.message : t('couldNotSave'))
    } finally {
      setSavingFilter(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingFilter) return
    try {
      await deleteSavedFilter(supabase, deletingFilter.id)
      await loadFilters()
      flash(setFiltersFlash, t('filterDeletedToast', { name: deletingFilter.name }))
    } catch (err) {
      flash(setFiltersFlash, err instanceof Error ? err.message : t('couldNotDelete'))
    } finally {
      setDeletingFilter(null)
    }
  }

  const handleFilterActiveToggle = async (f: SavedFilterRow, active: boolean) => {
    setFilters((prev) => prev.map((x) => (x.id === f.id ? { ...x, isActive: active } : x)))
    try {
      await setSavedFilterActive(supabase, f.id, active)
    } catch {
      await loadFilters() // revert optimistic change on failure
    }
  }

  // Profile · email · password are handled by the shared <AccountSettings /> (all wired).
  // Notification preferences are handled by <NotificationPreferences /> (wired to profile columns).

  // ── Shared flash helper ──
  function flash(setter: (v: string | null) => void, msg: string) {
    setter(msg)
    setTimeout(() => setter(null), 3500)
  }

  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* ── 1. Auto-Offers (Round 3 Phase 3 — standing offers sent on a full filter match) ──
            E-11 (client 2026-07-30): moved here from 4th of 6. It used to sit below the entire Saved
            Filters list, which is the longest block on this page, so a lender who never scrolled past
            their filters never discovered the feature at all — "it's a bit hard to find or even know it
            exists". The `id` is the anchor the New Deals strip's Manage button links to. */}
        <div id="auto-offers" className="scroll-mt-20">
          <Section icon={<Zap className="h-4 w-4" />} title={t('secAutoOffers')}>
            <AutoOfferManager />
          </Section>
        </div>

        {/* ── 2. Brokerage Blocking (wired) ── */}
        <BlockManager
          t={t}
          title={t('secBrokerageBlocking')}
          addLabel={t('blockBrokerage')}
          intro={t('brokerageIntro')}
          orgs={brokerages}
          blockedIds={blockedIds}
          loading={blocksLoading}
          onBlock={onBlock}
          onUnblock={onUnblock}
        />

        {/* ── 3. Decline Confirmation ── */}
        <Section icon={<AlertCircle className="h-4 w-4" />} title={t('secOfferDecline')}>
          <Flash msg={declineFlash} />
          <div className="space-y-1">
            <div className="flex items-start justify-between py-4 border-b border-border">
              <div className="pr-6">
                <p className="text-sm font-medium text-foreground">
                  {t('skipDecline')}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('skipDeclineDesc')}
                </p>
                {declineSkipActive && timeLeft && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-2 font-medium">
                    <Clock className="h-3.5 w-3.5" />
                    {t('confirmationsSuppressed', { time: timeLeft })}
                  </p>
                )}
              </div>
              <Switch
                checked={declineSkipActive}
                onCheckedChange={handleDeclineSkipToggle}
              />
            </div>

            <div className="flex items-start justify-between py-4">
              <div className="pr-6">
                <p className="text-sm font-medium text-foreground">{t('showOfferSummary')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('showOfferSummaryDesc')}
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        </Section>

        {/* ── 4. Saved Filters ── */}
        <Section icon={<SlidersHorizontal className="h-4 w-4" />} title={t('secSavedFilters')}>
          <div className="flex items-start justify-between gap-4 mb-5">
            <p className="text-sm text-muted-foreground">
              {t('savedFiltersIntro')}
            </p>
            <Button size="sm" className="shrink-0" onClick={openNewFilter}>
              {t('newFilter')}
            </Button>
          </div>

          <Flash msg={filtersFlash} />

          {filtersLoading ? (
            <p className="text-sm text-muted-foreground animate-pulse py-8 text-center">{t('loadingFilters')}</p>
          ) : filters.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-border rounded-lg">
              <Filter className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('noFilters')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('noFiltersHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filters.map((f) => (
                <div key={f.id} className="bg-muted/40 border border-border rounded-lg px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.criteriaPreview}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('criteriaCount', { count: f.criteriaCount })}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title={t('edit')} onClick={() => openEditFilter(f)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title={t('delete')} onClick={() => setDeletingFilter(f)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      {t('activeScores')}
                    </span>
                    <Switch checked={f.isActive} onCheckedChange={(v) => handleFilterActiveToggle(f, v)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── 5. Account (wired): profile · email · password ── */}
        <AccountSettings />

        {/* ── 6. Notifications ── */}
        <Section icon={<Bell className="h-4 w-4" />} title={t('secNotifications')}>
          <NotificationPreferences role="lender" />
        </Section>
      </main>

      {/* ── Filter criteria editor dialog ── */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setEditingId(null) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              {editingId ? t('editFilter') : t('newFilter')}
            </DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-5 py-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="filter-name" className="text-xs">
                    {t('filterName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="filter-name"
                    value={editing.name}
                    onChange={(e) => patchEditing({ name: e.target.value })}
                    placeholder={t('filterNamePlaceholder')}
                    aria-invalid={filterShowErrors && !editing.name.trim()}
                    className="bg-muted/50 h-9"
                    autoFocus
                  />
                  <FieldError show={filterShowErrors && !editing.name.trim()} />
                </div>
                <label className="flex items-center gap-2 h-9">
                  <Switch checked={editing.isActive} onCheckedChange={(v) => patchEditing({ isActive: v })} />
                  <span className="text-xs text-muted-foreground">{t('activeCriteria')}</span>
                </label>
              </div>

              <p className="text-xs text-muted-foreground border-t border-border pt-3">
                {t('weightedHint')}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <EnumField label={t('cfTransactionType')} anyLabel={t('any')} options={enums.TRANSACTION_TYPE_OPTIONS}
                  value={editing.transactionType} onChange={(v) => patchEditing({ transactionType: v })} />
                <EnumField label={t('cfProvince')} anyLabel={t('any')} options={enums.PROVINCE_OPTIONS}
                  value={editing.province} onChange={(v) => patchEditing({ province: v })} />
                <EnumField label={t('cfMortgageProduct')} anyLabel={t('any')} options={enums.MORTGAGE_PRODUCT_OPTIONS}
                  value={editing.mortgageProduct} onChange={(v) => patchEditing({ mortgageProduct: v })} />
                <EnumField label={t('cfPurpose')} anyLabel={t('any')} options={enums.TRANSACTION_PURPOSE_OPTIONS}
                  value={editing.purpose} onChange={(v) => patchEditing({ purpose: v })} />
                <EnumField label={t('cfMortgagePosition')} anyLabel={t('any')} options={enums.MORTGAGE_POSITION_OPTIONS}
                  value={editing.mortgagePosition} onChange={(v) => patchEditing({ mortgagePosition: v })} />
                <EnumField label={t('cfDwellingType')} anyLabel={t('any')} options={enums.DWELLING_TYPE_OPTIONS}
                  value={editing.dwellingType} onChange={(v) => patchEditing({ dwellingType: v })} />
                <EnumField label={t('cfOccupancy')} anyLabel={t('any')} options={enums.OCCUPANCY_OPTIONS}
                  value={editing.occupancy} onChange={(v) => patchEditing({ occupancy: v })} />
                <NumberField label={t('cfCreditScoreMin')} value={editing.creditScoreMin}
                  onChange={(v) => patchEditing({ creditScoreMin: v })} placeholder={t('creditScorePlaceholder')} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <NumberField label={t('cfLtvMin')} value={editing.ltvMin} onChange={(v) => patchEditing({ ltvMin: v })} />
                <NumberField label={t('cfLtvMax')} value={editing.ltvMax} onChange={(v) => patchEditing({ ltvMax: v })} />
                <div />
                <NumberField label={t('cfAmortMin')} value={editing.amortizationMin} onChange={(v) => patchEditing({ amortizationMin: v })} />
                <NumberField label={t('cfAmortMax')} value={editing.amortizationMax} onChange={(v) => patchEditing({ amortizationMax: v })} />
                <div />
                <NumberField label={t('cfValueMin')} value={editing.propertyValueMin} onChange={(v) => patchEditing({ propertyValueMin: v })} />
                <NumberField label={t('cfValueMax')} value={editing.propertyValueMax} onChange={(v) => patchEditing({ propertyValueMax: v })} />
              </div>
            </div>
          )}

          <DialogFooter className="items-center sm:justify-between">
            <RequiredFieldsNote />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { setEditing(null); setEditingId(null) }}>{t('cancel')}</Button>
              <Button onClick={handleSaveFilter} disabled={savingFilter} className={!editing?.name.trim() ? 'opacity-50' : ''}>
                {savingFilter ? t('saving') : t('saveFilter')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete filter dialog ── */}
      <AlertDialog open={!!deletingFilter} onOpenChange={(o) => !o && setDeletingFilter(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: deletingFilter?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingFilter(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              {t('deleteFilter')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
