'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RowActions } from '@/components/row-actions'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Toaster, toast } from 'sonner'
import { Search, Building2, ShieldCheck, UserCog, User, Ban, ShieldOff, Trash2, Eye, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  listBrokerDirectory,
  setBrokerAdmin,
  suspendBroker,
  endBrokerSuspension,
  deleteBrokerAccount,
  getBrokerEnforcementDetail,
  type BrokerDirectoryRow,
  type BrokerEnforcementDetail,
} from '@/lib/queries/admin'

const DURATION_PRESETS = ['1', '3', '7', '30', 'custom'] as const

/**
 * Admin Manage → Brokers (Round 4, 2026-09-04): the existing "Make Admin" toggle (profiles.is_broker_admin,
 * unchanged — see the original note below) plus manual suspension, viewing the automatic 3-strikes
 * contact-info suspension history, and Delete Account (soft-delete + Auth ban, never erasure).
 *
 * "Make Admin" here is unchanged from client feedback 2026-07-20 #8: it grants brokerage-level admin
 * (sees every deal their brokerage submitted), NOT the platform `admin` role — there is deliberately no
 * UI here for granting that (approved scope for this round).
 */
export default function BrokersPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [brokers, setBrokers] = useState<BrokerDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [brokerageFilter, setBrokerageFilter] = useState('all')

  const [suspendTarget, setSuspendTarget] = useState<BrokerDirectoryRow | null>(null)
  const [suspendPreset, setSuspendPreset] = useState<(typeof DURATION_PRESETS)[number]>('7')
  const [customDays, setCustomDays] = useState('')
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendBusy, setSuspendBusy] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<BrokerDirectoryRow | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [detailTarget, setDetailTarget] = useState<BrokerDirectoryRow | null>(null)
  const [detail, setDetail] = useState<BrokerEnforcementDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setBrokers(await listBrokerDirectory(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('brokersLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const brokerages = useMemo(
    () => Array.from(new Set(brokers.map((b) => b.brokerageName).filter((n): n is string => !!n))).sort(),
    [brokers],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return brokers.filter((b) => {
      if (brokerageFilter !== 'all' && b.brokerageName !== brokerageFilter) return false
      if (!q) return true
      return `${b.firstName} ${b.lastName} ${b.email} ${b.brokerageName ?? ''}`.toLowerCase().includes(q)
    })
  }, [brokers, search, brokerageFilter])

  const adminCount = brokers.filter((b) => b.isBrokerAdmin).length

  const toggleAdmin = async (b: BrokerDirectoryRow) => {
    setBusyId(b.id)
    try {
      await setBrokerAdmin(supabase, b.id, !b.isBrokerAdmin)
      await load()
      const name = `${b.firstName} ${b.lastName}`
      toast.success(b.isBrokerAdmin ? t('brokerAdminRemovedToast', { name }) : t('brokerAdminSetToast', { name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('brokerAdminUpdateErr'))
    } finally {
      setBusyId(null)
    }
  }

  const openSuspend = (b: BrokerDirectoryRow) => {
    setSuspendTarget(b)
    setSuspendPreset('7')
    setCustomDays('')
    setSuspendReason('')
  }

  const confirmSuspend = async () => {
    if (!suspendTarget) return
    const days = suspendPreset === 'custom' ? Number.parseInt(customDays, 10) : Number.parseInt(suspendPreset, 10)
    if (!Number.isFinite(days) || days <= 0) {
      toast.error(t('suspendDaysInvalid'))
      return
    }
    if (!suspendReason.trim()) {
      toast.error(t('suspendReasonRequired'))
      return
    }
    setSuspendBusy(true)
    try {
      await suspendBroker(supabase, suspendTarget.id, days, suspendReason.trim())
      await load()
      toast.success(t('suspendedToast', { name: `${suspendTarget.firstName} ${suspendTarget.lastName}` }))
      setSuspendTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('suspendErr'))
    } finally {
      setSuspendBusy(false)
    }
  }

  const openDetail = useCallback(async (b: BrokerDirectoryRow) => {
    setDetailTarget(b)
    setDetail(null)
    setDetailLoading(true)
    try {
      setDetail(await getBrokerEnforcementDetail(supabase, b.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('detailLoadErr'))
    } finally {
      setDetailLoading(false)
    }
  }, [supabase, t])

  const endSuspension = async (suspensionId: string) => {
    if (!detailTarget) return
    try {
      await endBrokerSuspension(supabase, suspensionId)
      await load()
      await openDetail(detailTarget)
      toast.success(t('suspensionEndedToast'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('suspensionEndErr'))
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    if (!deleteReason.trim()) {
      toast.error(t('deleteReasonRequired'))
      return
    }
    const wasRetry = deleteTarget.isDeleted
    setDeleteBusy(true)
    try {
      await deleteBrokerAccount(supabase, deleteTarget.id, deleteReason.trim())
      toast.success(
        wasRetry
          ? t('retriedToast', { name: `${deleteTarget.firstName} ${deleteTarget.lastName}` })
          : t('deletedToast', { name: `${deleteTarget.firstName} ${deleteTarget.lastName}` }),
      )
      setDeleteTarget(null)
    } catch (err) {
      // The RPC half may have already succeeded (is_deleted=true) even though the Auth ban failed —
      // refresh regardless so the row's status reflects the real DB state, and the "Delete Account"
      // action turns into "Retry Auth Ban" so the admin has a way forward instead of a dead end.
      toast.error(err instanceof Error ? err.message : t('deleteErr'))
    } finally {
      await load().catch(() => {})
      setDeleteBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('brokersTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">
            {t('brokersIntro')}
            {adminCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-700 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> {t('brokerAdminsCount', { count: adminCount })}
              </span>
            )}
          </p>
        </div>

        {/* Search + brokerage filter */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('brokersSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={brokerageFilter} onValueChange={setBrokerageFilter}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder={t('allBrokerages')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allBrokerages')}</SelectItem>
              {brokerages.map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('brokersLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('brokersLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noBrokers')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBroker')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colEmail')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBrokerage')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{b.firstName} {b.lastName}</p>
                        {b.phone && <p className="text-xs text-muted-foreground">{b.phone}</p>}
                        {b.isBrokerAdmin && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-blue-700">
                            <ShieldCheck className="h-3 w-3" /> {t('statusBrokerAdmin')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-foreground">{b.email}</td>
                      <td className="px-6 py-4 text-foreground">{b.brokerageName ?? '—'}</td>
                      <td className="px-6 py-4">
                        {b.isDeleted && b.isAuthBanned ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            <Trash2 className="h-3.5 w-3.5" /> {t('statusDeleted')}
                          </span>
                        ) : b.isDeleted ? (
                          // Deleted in the DB, but Supabase Auth's OWN ban state (auth.users.banned_until)
                          // says the login-lock didn't take — a real partial-failure state, not guessed.
                          <div>
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5" /> {t('statusDeletedBanPending')}
                            </span>
                            <p className="text-xs text-muted-foreground mt-1">{t('banPendingHint')}</p>
                          </div>
                        ) : b.isSuspended ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <Ban className="h-3.5 w-3.5" /> {t('statusSuspended')}
                            </span>
                            {b.suspensionExpiresAt && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {t('suspendedUntil', { date: new Date(b.suspensionExpiresAt).toLocaleString() })}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <User className="h-3.5 w-3.5" /> {t('statusActive')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <RowActions
                            label={t('colAction')}
                            disabled={busyId === b.id}
                            actions={[
                              !b.isDeleted && {
                                label: b.isBrokerAdmin ? t('removeBrokerAdmin') : t('makeBrokerAdmin'),
                                icon: b.isBrokerAdmin ? <User className="h-3.5 w-3.5" /> : <UserCog className="h-3.5 w-3.5" />,
                                onSelect: () => void toggleAdmin(b),
                              },
                              !b.isDeleted && {
                                label: t('actionSuspend'),
                                icon: <Ban className="h-3.5 w-3.5" />,
                                onSelect: () => openSuspend(b),
                              },
                              !b.isDeleted && b.isSuspended && {
                                label: t('actionEndSuspension'),
                                icon: <ShieldOff className="h-3.5 w-3.5" />,
                                onSelect: () => void openDetail(b),
                              },
                              {
                                label: t('actionViewDetails'),
                                icon: <Eye className="h-3.5 w-3.5" />,
                                onSelect: () => void openDetail(b),
                              },
                              // Hidden only once BOTH halves are confirmed done (deleted in the DB AND
                              // Auth-banned per auth.users.banned_until) — nothing left to retry. Offered
                              // as "Retry Auth Ban" when deleted but the ban didn't take (a real,
                              // Auth-sourced partial-failure state, not a guess) — retrying is safe since
                              // both admin_soft_delete_broker and the Auth ban are idempotent.
                              (!b.isDeleted || !b.isAuthBanned) && {
                                label: b.isDeleted ? t('actionRetryDelete') : t('actionDeleteAccount'),
                                icon: <Trash2 className="h-3.5 w-3.5" />,
                                destructive: true,
                                onSelect: () => { setDeleteTarget(b); setDeleteReason('') },
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Suspend */}
      <Dialog open={!!suspendTarget} onOpenChange={(o) => { if (!o) setSuspendTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('suspendTitle', { name: suspendTarget ? `${suspendTarget.firstName} ${suspendTarget.lastName}` : '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('suspendDescription')}</p>
            <div className="space-y-2">
              <Label htmlFor="suspend-duration">{t('suspendDurationLabel')}</Label>
              <Select value={suspendPreset} onValueChange={(v) => setSuspendPreset(v as typeof suspendPreset)}>
                <SelectTrigger id="suspend-duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('suspendPreset1')}</SelectItem>
                  <SelectItem value="3">{t('suspendPreset3')}</SelectItem>
                  <SelectItem value="7">{t('suspendPreset7')}</SelectItem>
                  <SelectItem value="30">{t('suspendPreset30')}</SelectItem>
                  <SelectItem value="custom">{t('suspendPresetCustom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {suspendPreset === 'custom' && (
              <div className="space-y-2">
                <Label htmlFor="suspend-custom-days">{t('suspendCustomDaysLabel')}</Label>
                <Input
                  id="suspend-custom-days" type="number" min={1}
                  value={customDays} onChange={(e) => setCustomDays(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="suspend-reason">{t('suspendReasonLabel')}</Label>
              <Textarea
                id="suspend-reason" rows={3}
                value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                placeholder={t('suspendReasonPlaceholder')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" disabled={suspendBusy} onClick={() => setSuspendTarget(null)}>{t('cancel')}</Button>
            <Button disabled={suspendBusy} onClick={() => void confirmSuspend()}>{t('confirmSuspend')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Account / Retry Auth Ban — confirmation required either way */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleteBusy) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(deleteTarget?.isDeleted ? 'retryDeleteTitle' : 'deleteTitle', {
                name: deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}` : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.isDeleted ? t('retryDeleteDescription') : t('deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-reason">{t('deleteReasonLabel')}</Label>
            <Textarea
              id="delete-reason" rows={3}
              value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
              placeholder={t('deleteReasonPlaceholder')}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(e) => { e.preventDefault(); void confirmDelete() }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t(deleteTarget?.isDeleted ? 'confirmRetryDelete' : 'confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Details — full suspension + violation history */}
      <Dialog open={!!detailTarget} onOpenChange={(o) => { if (!o) setDetailTarget(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailTarget ? `${detailTarget.firstName} ${detailTarget.lastName}` : ''}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t('detailLoading')}</p>
          ) : detail && detailTarget ? (
            <div className="space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="text-sm text-muted-foreground">
                <p>{detailTarget.email}</p>
                <p>{detailTarget.brokerageName ?? '—'}</p>
                <p className="mt-1 text-foreground font-medium">{t('violations30dLabel', { count: detail.violations30d })}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{t('suspensionHistoryHeading')}</p>
                {detail.suspensions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">{t('noSuspensions')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.suspensions.map((s) => (
                      <div key={s.id} className="px-3 py-2 bg-muted/50 border border-border rounded-md">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-foreground">{s.reason}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {s.isAutomatic ? t('suspensionAutomatic') : t('suspensionManualBy', { name: s.createdByName ?? '—' })}
                              {' · '}
                              {new Date(s.startsAt).toLocaleDateString()} – {new Date(s.expiresAt).toLocaleString()}
                              {s.endedAt && ` · ${t('suspensionEndedBy', { name: s.endedByName ?? '—', date: new Date(s.endedAt).toLocaleString() })}`}
                            </p>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {s.isActive && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                {t('statusSuspended')}
                              </span>
                            )}
                            {s.isActive && (
                              <Button size="sm" variant="outline" onClick={() => void endSuspension(s.id)}>
                                {t('actionEndSuspension')}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{t('violationHistoryHeading')}</p>
                {detail.violations.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">{t('noViolations')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.violations.map((v) => (
                      <div key={v.id} className="px-3 py-2 bg-muted/50 border border-border rounded-md text-sm">
                        <p className="text-foreground truncate">{v.flaggedContent ?? '—'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {v.dealNumber ? `${v.dealNumber} · ` : ''}{new Date(v.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
