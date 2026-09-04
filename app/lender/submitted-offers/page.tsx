'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { LenderHeader } from '@/components/lender-header'
import { createClient } from '@/lib/supabase/client'
import { listSubmittedOffers, withdrawOffer, getDealFull, type SubmittedOfferItem } from '@/lib/queries/offers'
import type { LenderDealListItem } from '@/lib/queries/deals'
import { LenderDealDetailSections } from '@/components/lender-deal-sections'
import { MakeOfferDialog, type OfferEditTarget } from '@/components/make-offer-dialog'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/components/field-error'
import { RowActions } from '@/components/row-actions'
import { offerStatusStyle } from '@/lib/status-styles'
import { sendMessage as sendDealMessage } from '@/lib/queries/messages'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clock,
  MessageSquare,
  Eye,
  Trash2,
  AlertTriangle,
  XCircle,
  Pencil,
  Percent,
  CalendarClock,
  FileText,
  Building2,
  Zap,
  AlertCircle,
  Loader2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
// Data comes from Supabase (lib/queries/offers.ts). Clean offer_status enum only —
// the mock's legacy "Under Review"/"Countered"/"Withdrawn" are purged.

type SubmittedOffer = SubmittedOfferItem
type OfferStatus = SubmittedOffer['status']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  // Calendar days from today (real current date) to the target date. Both anchored at UTC midnight so
  // the difference is a clean whole-day count, independent of the time of day.
  // Null-tolerant: a PREQUAL has no closing date, and `new Date(null)` gave NaN, which rendered as
  // "NaNd remaining" in the Closing column (found in QA 2026-07-27).
  if (!dateStr) return null
  const now = new Date()
  const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((new Date(dateStr).getTime() - todayUtcMidnight) / 86400000)
}

function fmtCurrency(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(0)}K`
}

// Round 3: a switched-away offer surfaces as plain "Declined" here (the data-layer mapping lives in
// lib/queries/offers.ts), so the page only knows Pending / Accepted / Declined.
function statusCfg(status: OfferStatus) {
  switch (status) {
    case 'Pending':   return { cls: offerStatusStyle('pending'),  icon: <Clock className="h-3 w-3" /> }
    case 'Accepted':  return { cls: offerStatusStyle('accepted'), icon: <CheckCircle className="h-3 w-3" /> }
    case 'Declined':  return { cls: offerStatusStyle('declined'), icon: <XCircle className="h-3 w-3" /> }
    case 'Withdrawn': return { cls: offerStatusStyle('withdrawn'), icon: <Trash2 className="h-3 w-3" /> }
  }
}

function closingCls(days: number | null): string {
  if (days === null) return 'text-muted-foreground'
  if (days <= 14) return 'text-red-600 font-semibold'
  if (days <= 30) return 'text-amber-600 font-medium'
  return 'text-muted-foreground'
}

type ExpiryWarn = { key: 'expired' | 'expiresToday' | 'expiresIn'; days: number } | null

function expiryWarning(expiryDate: string, status: OfferStatus): ExpiryWarn {
  if (status !== 'Pending') return null
  const d = daysUntil(expiryDate)
  if (d === null) return null   // an offer always has an expiry; belt and braces since daysUntil is nullable
  if (d < 0) return { key: 'expired', days: d }
  if (d === 0) return { key: 'expiresToday', days: d }
  if (d <= 5) return { key: 'expiresIn', days: d }
  return null
}

const isActive = (s: OfferStatus) => s === 'Pending'

// ─── Offer Detail Dialog ──────────────────────────────────────────────────────

function OfferDetailDialog({
  offer,
  onClose,
  onWithdraw,
  onMessage,
}: {
  offer: SubmittedOffer | null
  onClose: () => void
  onWithdraw: (id: string) => void
  onMessage: (id: string) => void
}) {
  const t = useT('submittedOffers')
  const tf = useT('feed')
  const supabase = useMemo(() => createClient(), [])
  // Client 2026-07-23 (A-19): "the lender can't see the loan details but they should be able to view
  // the same data as in new deal." Same component, same fields — RLS lets a lender read the deal they
  // offered on, and deal_identities is still never selected.
  const [fullDeal, setFullDeal] = useState<LenderDealListItem | null>(null)
  useEffect(() => {
    if (!offer) { setFullDeal(null); return }
    let active = true
    getDealFull(supabase, offer.dealId)
      .then((d) => { if (active) setFullDeal(d) })
      .catch(() => { if (active) setFullDeal(null) })
    return () => { active = false }
  }, [offer, supabase])
  if (!offer) return null
  const { cls, icon } = statusCfg(offer.status)
  const closingDays = daysUntil(offer.closingDate)
  const closingClass = closingCls(closingDays)
  const expWarn = expiryWarning(offer.expiryDate, offer.status)

  return (
    <Dialog open={!!offer} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>{offer.dealNumber}</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
              {icon} {tf(offer.status)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {offer.status === 'Accepted' && (
            <div className="flex gap-3 p-4 rounded-lg border text-sm bg-green-50 border-green-200 text-green-900">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="font-semibold">{t('acceptedBanner')}</p>
            </div>
          )}

          {/* Two-column detail grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Deal info */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> {t('dealInfo')}
              </p>
              {[
                [t('dLocation'), `${offer.city}, ${offer.province}`],
                [t('dPropertyType'), tf(offer.propertyType)],
                [t('dLoanAmount'), fmtCurrency(offer.loanAmount)],
                [t('dPropertyValue'), fmtCurrency(offer.propertyValue)],
                [t('dLtv'), `${offer.ltv}%`],
                [t('dPurpose'), tf(offer.purpose)],
                [t('dInsurance'), tf(offer.insuranceType)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground">{value}</span>
                </div>
              ))}
            </div>

            {/* Offer details */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5" /> {t('yourOffer')}
              </p>
              {[
                [t('dRate'), `${offer.offeredRate}% ${tf(offer.rateType)}`],
                // term is null for an open mortgage, which has none — don't render it as "0 years".
                [t('dTerm'), offer.term === null ? t('termOpen')
                  : offer.term === 1 ? t('yearsOne', { n: offer.term }) : t('years', { n: offer.term })],
                [t('dAmortization'), t('years', { n: offer.amortization })],
                [t('dCommission'), t('commissionBps', { bps: offer.commissionBps })],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground">{value}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1.5">{t('conditions')}</p>
                {offer.conditions.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">{t('noConditions')}</p>
                ) : (
                  <ul className="space-y-1">
                    {offer.conditions.map((c) => (
                      <li key={c} className="text-xs text-foreground flex items-start gap-1.5">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
              <CalendarClock className="h-3.5 w-3.5" /> {t('timeline')}
            </p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('offerSentLabel')}</p>
                <p className="font-medium text-foreground">{offer.offerDate}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('offerExpiry')}</p>
                <p className={`font-medium ${expWarn ? 'text-red-600' : 'text-foreground'}`}>
                  {offer.expiryDate}
                  {expWarn && <span className="block text-xs">{t(expWarn.key, { days: expWarn.days })}</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('dealClosing')}</p>
                <p className={`font-medium ${closingClass}`}>
                  {offer.closingDate}
                  {closingDays !== null && (
                    <span className="block text-xs">{t('closingRemaining', { days: closingDays })}</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Dialog actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex gap-2">
              {isActive(offer.status) && offer.canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10 gap-1.5"
                  onClick={() => { onClose(); onWithdraw(offer.id) }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t('withdrawBtn')}
                </Button>
              )}
              {offer.canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { onClose(); onMessage(offer.id) }}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> {t('messageBrokerBtn')}
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>{t('close')}</Button>
          </div>

          {/* Full deal record — identical to the New Deals card (A-19) */}
          {fullDeal && (
            <div className="space-y-5">
              <LenderDealDetailSections deal={fullDeal} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10

export default function SubmittedOffersPage() {
  const supabase = useMemo(() => createClient(), [])
  const t = useT('submittedOffers')
  const tf = useT('feed')
  const tc = useT('common')

  const [offers, setOffers] = useState<SubmittedOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)

  // Dialogs
  const [detailOffer, setDetailOffer] = useState<SubmittedOffer | null>(null)
  // Round 3: pending offers stay editable until accepted (edit_offer RPC; broker notified on edit).
  const [editTarget, setEditTarget] = useState<OfferEditTarget | null>(null)
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null)
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [messageSending, setMessageSending] = useState(false)
  const [messageBlockReason, setMessageBlockReason] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [messageShowError, setMessageShowError] = useState(false)

  // Feedback
  const [feedback, setFeedback] = useState<string | null>(null)

  const flash = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 3500)
  }

  const load = useCallback(async () => {
    setOffers(await listSubmittedOffers(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load])

  // ── Derived ──

  const offersWithState = offers

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase()
    return offersWithState.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (q && !(
        o.dealNumber.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q) ||
        o.province.toLowerCase().includes(q) ||
        o.propertyType.toLowerCase().includes(q) ||
        o.purpose.toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [offersWithState, statusFilter, searchTerm])

  // Reset page on filter change
  useMemo(() => { setCurrentPage(1) }, [statusFilter, searchTerm])

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const paginated = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  // Stats
  const stats = useMemo(() => ({
    total:    offersWithState.length,
    pending:  offersWithState.filter((o) => o.status === 'Pending').length,
    accepted: offersWithState.filter((o) => o.status === 'Accepted').length,
    declined: offersWithState.filter((o) => o.status === 'Declined').length,
  }), [offersWithState])

  // ── Handlers ──

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return
    try {
      await withdrawOffer(supabase, withdrawTarget)
      await load()
      flash(t('withdrawnToast'))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('withdrawErr'))
    } finally {
      setWithdrawTarget(null)
    }
  }

  // Client 2026-07-23 (A-16): this used to only `flash` a fake confirmation — the message was never
  // persisted, which is why nothing appeared in the messages record. It now goes through the same path
  // as the deal feeds: send_deal_message (which creates the thread).
  //
  // Round 4 (Option 2, corrected 2026-09-04): this call site was missed when the other message-send
  // paths (messages-inbox.tsx, use-lender-deal-feed.ts) were migrated off the old client-side
  // scanContact() pre-check. send_deal_message() is now itself authoritative for both blocking and
  // recording — the anti-contact trigger FLAGS offending content (is_invalid = true) instead of
  // rejecting the write, so the RPC call always "succeeds"; its returned `blocked`/`reason` is the sole
  // source of truth for whether the message actually reached the broker. The old pre-check here was
  // doubly wrong: redundant when it agreed with the trigger, and silently unsafe when it didn't — if the
  // pre-check missed something the trigger caught, this code used to fall straight through to
  // `flash(t('messageSent'))` without ever looking at the RPC's result, telling the lender a message was
  // delivered when it had actually been flagged and hidden from the broker.
  const sendMessage = async (e: React.MouseEvent) => {
    e.preventDefault() // never let the AlertDialog close before the send resolves
    if (!messageTarget || messageSending) return
    const text = messageText.trim()
    if (!text) {
      setMessageShowError(true)
      return
    }
    const dealId = getOfferById(messageTarget)?.dealId
    if (!dealId) return
    setMessageSending(true)
    setMessageBlockReason(null)
    try {
      const { blocked, reason } = await sendDealMessage(supabase, { dealId, content: text })
      if (blocked) {
        // in-dialog, not `flash`: the dialog stays open, so a page banner would sit behind the overlay
        setMessageBlockReason(reason ? t('contactBlocked', { reason }) : t('contactBlockedGeneric'))
        return
      }
      flash(t('messageSent'))
      setMessageTarget(null)
      setMessageText('')
      setMessageShowError(false)
    } catch (err) {
      setMessageBlockReason(err instanceof Error ? err.message : t('messageErr'))
    } finally {
      setMessageSending(false)
    }
  }

  const getOfferById = (id: string) =>
    offersWithState.find((o) => o.id === id) ?? null

  // Prefill the shared offer dialog with the offer's saved values (comments included — the lender
  // is editing their own text; the "always clear comments" rule applies to NEW-offer prefill only).
  const openEdit = (offer: SubmittedOffer) =>
    setEditTarget({
      offerId: offer.id,
      dealId: offer.dealId,
      overrideBps: offer.overrideBps,
      values: {
        mortgageProduct: offer.mortgageProduct,
        rate: String(offer.offeredRate),
        rateLockDays: String(offer.rateLockDays),
        commissionBps: String(offer.commissionBps),
        commitmentDays: offer.commitmentDays === null ? '' : String(offer.commitmentDays),
        docReviewDays: offer.docReviewDays === null ? '' : String(offer.docReviewDays),
        comments: offer.comments ?? '',
        lenderFeePct: offer.lenderFeePct === null ? '' : String(offer.lenderFeePct),
      },
    })

  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: t('total'), value: stats.total, cls: '' },
            { label: tf('Pending'), value: stats.pending, cls: 'text-yellow-700' },
            { label: tf('Accepted'), value: stats.accepted, cls: 'text-green-700' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-2xl font-bold ${cls || 'text-foreground'}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Search + filter controls */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder={t('filterByStatus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                <SelectItem value="Pending">{tf('Pending')}</SelectItem>
                <SelectItem value="Accepted">{tf('Accepted')}</SelectItem>
                <SelectItem value="Declined">{tf('Declined')}</SelectItem>
                <SelectItem value="Withdrawn">{tf('Withdrawn')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4">
            <CheckCircle className="h-4 w-4 shrink-0" />
            {feedback}
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted-foreground">
            {statusFilter !== 'all' || searchTerm
              ? t('statsMatching', { count: filtered.length })
              : t('statsTotal', { count: filtered.length })}
          </p>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('loadingOffers')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('loadErrorTitle')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('noOffersTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {offersWithState.length === 0 ? t('noOffersEmpty') : t('noOffersFilter')}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colDeal')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colLocation')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colLoanLtv')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colRate')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colTermAmort')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colClosing')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colStatus')}</th>
                      <th className="px-6 py-3 text-left font-semibold text-foreground whitespace-nowrap">{t('colExpiry')}</th>
                      <th className="px-6 py-3 text-center font-semibold text-foreground whitespace-nowrap">{t('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((offer) => {
                      const { cls, icon } = statusCfg(offer.status)
                      const closingDays = daysUntil(offer.closingDate)
                      const closingClass = closingCls(closingDays)
                      const expWarn = expiryWarning(offer.expiryDate, offer.status)
                      const active = isActive(offer.status)

                      return (
                        <tr
                          key={offer.id}
                          className={`border-b border-border last:border-b-0 transition-colors ${
                            offer.status === 'Declined' ? 'opacity-50' : 'hover:bg-muted/40'
                          }`}
                        >
                          {/* Deal # */}
                          <td className="px-6 py-4">
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                              {offer.dealNumber}
                              {/* Round 3: sent by a standing auto-offer, not typed by hand */}
                              {offer.isAuto && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-800">
                                  <Zap className="h-3 w-3" /> {t('autoBadge')}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{offer.offerDate}</p>
                          </td>

                          {/* Location */}
                          <td className="px-6 py-4">
                            <p className="text-foreground">{offer.city}, {offer.province}</p>
                            <p className="text-xs text-muted-foreground">{tf(offer.propertyType)}</p>
                          </td>

                          {/* Loan / LTV */}
                          <td className="px-6 py-4">
                            <p className="font-semibold text-foreground">{fmtCurrency(offer.loanAmount)}</p>
                            <p className="text-xs text-muted-foreground">{t('ltvOnly', { ltv: offer.ltv })}</p>
                          </td>

                          {/* Rate */}
                          <td className="px-6 py-4">
                            <p className="text-lg font-bold text-primary">{offer.offeredRate}%</p>
                            <p className="text-xs text-muted-foreground">{tf(offer.rateType)}</p>
                          </td>

                          {/* Term & Amortization */}
                          <td className="px-6 py-4">
                            <p className="text-foreground">
                              {offer.term === null ? t('termOpen') : t('termYr', { term: offer.term })}
                            </p>
                            <p className="text-xs text-muted-foreground">{t('amortLine', { years: offer.amortization })}</p>
                          </td>

                          {/* Closing */}
                          <td className="px-6 py-4">
                            <p className="text-foreground">{offer.closingDate || t('noClosingDate')}</p>
                            {closingDays !== null && (
                              <p className={`text-xs flex items-center gap-1 ${closingClass}`}>
                                {closingDays <= 14 && (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {t('closingRemaining', { days: closingDays })}
                              </p>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
                              {icon} {tf(offer.status)}
                            </span>
                          </td>

                          {/* Expiry */}
                          <td className="px-6 py-4">
                            <p className={`text-sm ${expWarn ? 'text-red-600 font-medium' : 'text-foreground'}`}>
                              {expWarn ? t(expWarn.key, { days: expWarn.days }) : offer.expiryDate}
                            </p>
                            {!expWarn && (
                              <p className="text-xs text-muted-foreground">{offer.expiryDate}</p>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-6 py-4">
                            <div className="flex justify-center">
                              <RowActions
                                label={t('colActions')}
                                actions={[
                                  { label: t('viewDetails'), icon: <Eye className="h-4 w-4" />, onSelect: () => setDetailOffer(offer) },
                                  active && offer.canManage && { label: t('editOffer'), icon: <Pencil className="h-4 w-4" />, onSelect: () => openEdit(offer) },
                                  offer.canManage && { label: t('messageBroker'), icon: <MessageSquare className="h-4 w-4" />, onSelect: () => { setMessageTarget(offer.id); setMessageText('') } },
                                  active && offer.canManage && { label: t('withdrawBtn'), icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setWithdrawTarget(offer.id) },
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="bg-muted border-t border-border px-6 py-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('showing', { from: startIndex + 1, to: Math.min(startIndex + ITEMS_PER_PAGE, filtered.length), total: filtered.length })}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" /> {tc('previous')}
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <Button
                          key={page}
                          variant={currentPage === page ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className="min-w-10"
                        >
                          {page}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="gap-1"
                    >
                      {tc('next')} <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ── Offer detail dialog ── */}
      <OfferDetailDialog
        offer={detailOffer}
        onClose={() => setDetailOffer(null)}
        onWithdraw={(id) => setWithdrawTarget(id)}
        onMessage={(id) => { setMessageTarget(id); setMessageText('') }}
      />

      {/* ── Edit offer (Round 3: editable until accepted; broker is notified) ── */}
      <MakeOfferDialog
        dealIds={null}
        edit={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={async (_ids, message) => {
          setEditTarget(null)
          await load().catch(() => {})
          flash(message)
        }}
      />

      {/* ── Withdraw confirmation ── */}
      <AlertDialog open={!!withdrawTarget} onOpenChange={() => setWithdrawTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('withdrawTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('withdrawDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmWithdraw}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('confirmWithdraw')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Message broker dialog ── */}
      <AlertDialog open={!!messageTarget} onOpenChange={() => { setMessageTarget(null); setMessageBlockReason(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('messageTitle', { deal: getOfferById(messageTarget ?? '')?.dealNumber ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('messageDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-4">
            <Textarea
              placeholder={t('messagePlaceholder')}
              value={messageText}
              onChange={(e) => { setMessageText(e.target.value); if (messageShowError) setMessageShowError(false); if (messageBlockReason) setMessageBlockReason(null) }}
              aria-invalid={messageShowError && !messageText.trim()}
              rows={4}
              className="resize-none bg-muted/50"
            />
            <div className="flex items-center justify-between mt-1">
              <FieldError show={messageShowError && !messageText.trim()} />
              <p className="text-xs text-muted-foreground text-right ml-auto">{t('charCount', { n: messageText.length })}</p>
            </div>
            {messageBlockReason && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{messageBlockReason}</p>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setMessageText(''); setMessageShowError(false); setMessageBlockReason(null) }}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={sendMessage} disabled={messageSending} className={`gap-1.5 ${!messageText.trim() ? 'opacity-50' : ''}`}>
              {messageSending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('send')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
