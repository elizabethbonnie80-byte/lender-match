'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { LenderHeader } from '@/components/lender-header'
import { createClient } from '@/lib/supabase/client'
import {
  listLenderInvoices,
  markInvoicePaid,
  cancelInvoice,
  updateInvoice,
  downloadInvoicePdf,
  type LenderInvoiceItem,
} from '@/lib/queries/offers'
import { Toaster, toast } from 'sonner'
import { useT, useLocale } from '@/components/i18n-provider'
import { SUPPORT_EMAIL } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/components/field-error'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { RowActions } from '@/components/row-actions'
import {
  CheckCircle,
  XCircle,
  Pencil,
  Download,
  FileText,
  DollarSign,
  AlertCircle,
  Clock,
  RefreshCw,
} from 'lucide-react'

const TERMS = [
  '6mo Fixed',
  '1yr Fixed',
  '2yr Fixed',
  '3yr Fixed',
  '4yr Fixed',
  '5yr Fixed',
  '3yr Variable',
  '5yr Variable',
  'Open',
]

// Shape comes from Supabase (lib/queries/offers.ts). Aliases kept so existing references compile.
type Invoice = LenderInvoiceItem
type PendingInvoice = LenderInvoiceItem
type PaidInvoice = LenderInvoiceItem
type CancelledInvoice = LenderInvoiceItem

// Client 2026-07-25 (B-27): "add 2 decimal points so it doesn't round up. This should say $187.50".
// The DB already stores the cents (accept_offer does round(..., 2)) — only the display was truncating.
function calcFee(loanAmount: number, bps: number) {
  return Math.round((loanAmount * bps) / 100) / 100
}

function fmtMoney(n: number, locale: string) {
  return n.toLocaleString(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDay(d: string, locale: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Active date/currency locale tag for the app locale.
function useDateLocale() {
  return useLocale() === 'fr' ? 'fr-CA' : 'en-CA'
}

function daysOverdue(dueDate: string): number {
  // Calendar days the invoice is past due (0 if due today or in the future). Both dates anchored at
  // UTC midnight so the count is a clean whole-day figure regardless of the current time of day.
  const now = new Date()
  const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.round((todayUtcMidnight - new Date(dueDate).getTime()) / 86400000))
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function OverdueBadge({ dueDate }: { dueDate: string }) {
  const t = useT('invoices')
  const days = daysOverdue(dueDate)
  if (days === 0) return null
  return (
    <span className="ml-1.5 text-xs font-medium text-red-600">{t('daysLate', { days })}</span>
  )
}

interface MakeChangesDialogProps {
  invoice: PendingInvoice
  open: boolean
  onClose: () => void
  onSave: (id: string, term: string, loanAmount: number, closingDate: string) => void
}

function MakeChangesDialog({ invoice, open, onClose, onSave }: MakeChangesDialogProps) {
  const t = useT('invoices')
  const dl = useDateLocale()
  const fmt = (n: number) => fmtMoney(n, dl)
  const [term, setTerm] = useState(invoice.term)
  const [loanAmount, setLoanAmount] = useState(String(invoice.loanAmount))
  const [closingDate, setClosingDate] = useState(invoice.closingDate)
  const [showError, setShowError] = useState(false)

  const parsedAmount = parseInt(loanAmount.replace(/\D/g, ''), 10) || 0
  const newFee = calcFee(parsedAmount, invoice.bps) // hypothetical fee for the edited loan amount
  const originalFee = invoice.amount // authoritative stored fee (invoices.amount)
  const diff = newFee - originalFee

  const changed =
    term !== invoice.term ||
    parsedAmount !== invoice.loanAmount ||
    closingDate !== invoice.closingDate

  function handleSave() {
    if (parsedAmount <= 0) {
      setShowError(true)
      return
    }
    if (!changed) return // nothing to save — no-op
    onSave(invoice.id, term, parsedAmount, closingDate)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            {t('changesTitle', { invoice: invoice.invoiceNumber })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground text-xs">
            {t('changesIntro', { bps: invoice.bps })}
          </p>

          {/* Term */}
          <div className="space-y-1.5">
            <Label htmlFor="chg-term">{t('term')}</Label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger id="chg-term" className="bg-muted/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERMS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loan Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="chg-amount">{t('loanAmountCad')}</Label>
            <Input
              id="chg-amount"
              value={loanAmount}
              onChange={(e) => { setLoanAmount(e.target.value.replace(/[^\d]/g, '')); if (showError) setShowError(false) }}
              aria-invalid={showError && parsedAmount <= 0}
              className="bg-muted/40 font-mono"
              placeholder={t('loanAmountPlaceholder')}
            />
            <FieldError show={showError && parsedAmount <= 0} />
          </div>

          {/* Closing Date */}
          <div className="space-y-1.5">
            <Label htmlFor="chg-date">{t('closingDate')}</Label>
            <Input
              id="chg-date"
              type="date"
              value={closingDate}
              onChange={(e) => setClosingDate(e.target.value)}
              className="bg-muted/40"
            />
          </div>

          {/* Live recalculation */}
          <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {t('feeRecalc')}
            </p>
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>{t('loanAmount')}</span>
              <span>{parsedAmount > 0 ? fmt(parsedAmount) : '—'}</span>
            </div>
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>{t('bpsApplied')}</span>
              <span>{t('bpsAppliedValue', { bps: invoice.bps, pct: invoice.bps / 100 })}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-semibold text-foreground">
              <span>{t('newFee')}</span>
              <span>{parsedAmount > 0 ? fmt(newFee) : '—'}</span>
            </div>
            {changed && parsedAmount > 0 && diff !== 0 && (
              <p className={`text-xs font-medium ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {t('feeDiff', { diff: `${diff > 0 ? '+' : ''}${fmt(diff)}`, original: fmt(originalFee) })}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={handleSave} className={!changed || parsedAmount <= 0 ? 'opacity-50' : ''}>
            {t('saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const supabase = useMemo(() => createClient(), [])
  const t = useT('invoices')
  const tf = useT('feed')
  const dl = useDateLocale()
  const fmt = (n: number) => fmtMoney(n, dl)
  const fmtDate = (d: string) => fmtDay(d, dl)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)

  async function handleDownloadPdf(id: string) {
    setPdfBusyId(id)
    try {
      const url = await downloadInvoicePdf(supabase, id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pdfError'))
    } finally {
      setPdfBusyId(null)
    }
  }

  const load = useCallback(async () => {
    setInvoices(await listLenderInvoices(supabase))
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load])

  const pending = useMemo(() => invoices.filter((i) => i.status === 'Pending') as PendingInvoice[], [invoices])
  const paid = useMemo(() => invoices.filter((i) => i.status === 'Paid') as PaidInvoice[], [invoices])
  const cancelled = useMemo(() => invoices.filter((i) => i.status === 'Cancelled') as CancelledInvoice[], [invoices])

  const pendingTotal = pending.reduce((s, i) => s + i.amount, 0)
  const overdueCount = pending.filter((i) => daysOverdue(i.dueDate) > 0).length

  // term (a display string) isn't sent — the RPC recalculates from loan amount + closing date.
  async function handleSaveChanges(id: string, _term: string, loanAmount: number, closingDate: string) {
    setBusy(true)
    try {
      await updateInvoice(supabase, id, { loanAmount, closingDate })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkPaid(id: string) {
    setBusy(true)
    try {
      await markInvoicePaid(supabase, id)
      await load()
    } finally {
      setMarkingPaidId(null)
      setBusy(false)
    }
  }

  async function handleCancel(id: string) {
    setBusy(true)
    try {
      await cancelInvoice(supabase, id, 'Cancelled by lender')
      await load()
    } finally {
      setCancellingId(null)
      setBusy(false)
    }
  }

  const changingInvoice = changingId
    ? (invoices.find((i) => i.id === changingId) as PendingInvoice | undefined)
    : undefined

  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        </div>

        {loading && <p className="text-sm text-muted-foreground animate-pulse">{t('loading')}</p>}
        {loadError && <p className="text-sm text-destructive">{t('loadErrorPrefix', { error: loadError })}</p>}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className="bg-yellow-100 rounded-lg p-2 shrink-0">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('cardPending')}</p>
              <p className="text-lg font-bold text-foreground">{pending.length}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className={`${overdueCount > 0 ? 'bg-red-100' : 'bg-muted'} rounded-lg p-2 shrink-0`}>
              <AlertCircle className={`h-5 w-5 ${overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('cardOverdue')}</p>
              <p className={`text-lg font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-foreground'}`}>
                {overdueCount}
              </p>
            </div>
          </div>
        </div>

        {/* Overdue alert */}
        {overdueCount > 0 && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t('overdueAlert', { count: overdueCount, email: SUPPORT_EMAIL })}</span>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="pending">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              {t('tabPending')}
              {pending.length > 0 && (
                <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px]">{pending.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="paid" className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5" />
              {t('tabPaid')}
              {paid.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">{paid.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="flex items-center gap-2">
              <XCircle className="h-3.5 w-3.5" />
              {t('tabCancelled')}
              {cancelled.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">{cancelled.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── PENDING ─────────────────────────────────────────────────────── */}
          <TabsContent value="pending" className="mt-4">
            {pending.length === 0 ? (
              <div className="bg-card border border-border rounded-lg py-16 text-center">
                <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="font-semibold text-foreground">{t('pendingEmptyTitle')}</p>
                <p className="text-sm text-muted-foreground mt-1">{t('pendingEmptyBody')}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colInvoice')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colDeal')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLocation')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colTypeTerm')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLoanAmount')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colBps')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colFee')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colDueDate')}</th>
                        <th className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((inv) => {
                        const overdue = daysOverdue(inv.dueDate) > 0
                        return (
                          <tr
                            key={inv.id}
                            className={`border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${overdue ? 'bg-red-50/50' : ''}`}
                          >
                            <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                              {inv.dealRef}
                              {inv.documentName && (
                                <span
                                  className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                                  title={t('nameVarianceTip', { name: inv.documentName })}
                                >
                                  {t('nameVarianceBadge')}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">{inv.propertyCity}, {inv.propertyProvince}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-foreground">{tf(inv.dealType)}</span>
                              <span className="text-muted-foreground text-xs ml-1">· {inv.term}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{fmt(inv.loanAmount)}</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                                {t('bps', { n: inv.bps })}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                              {fmt(inv.amount)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={overdue ? 'text-red-600 font-medium' : 'text-foreground'}>
                                {fmtDate(inv.dueDate)}
                              </span>
                              <OverdueBadge dueDate={inv.dueDate} />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex justify-center">
                                <RowActions
                                  label={t('colActions')}
                                  actions={[
                                    {
                                      label: t('actionPaid'),
                                      icon: <CheckCircle className="h-4 w-4 text-green-600" />,
                                      onSelect: () => setMarkingPaidId(inv.id),
                                    },
                                    {
                                      label: t('actionChanges'),
                                      icon: <Pencil className="h-4 w-4" />,
                                      onSelect: () => setChangingId(inv.id),
                                    },
                                    {
                                      label: t('actionPdf'),
                                      icon: (
                                        <Download className={`h-4 w-4 ${pdfBusyId === inv.id ? 'animate-pulse' : ''}`} />
                                      ),
                                      onSelect: () => handleDownloadPdf(inv.id),
                                      disabled: pdfBusyId === inv.id,
                                    },
                                    {
                                      label: t('actionCancel'),
                                      icon: <XCircle className="h-4 w-4" />,
                                      onSelect: () => setCancellingId(inv.id),
                                      destructive: true,
                                    },
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
              </div>
            )}
          </TabsContent>

          {/* ── PAID ────────────────────────────────────────────────────────── */}
          <TabsContent value="paid" className="mt-4">
            {paid.length === 0 ? (
              <div className="bg-card border border-border rounded-lg py-16 text-center">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-semibold text-foreground">{t('paidEmpty')}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colInvoice')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colDeal')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLocation')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colTypeTerm')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLoanAmount')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colBps')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colFeePaid')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colPaidDate')}</th>
                        <th className="text-center px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colPdf')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paid.map((inv) => (
                        <tr
                          key={inv.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.dealRef}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{inv.propertyCity}, {inv.propertyProvince}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-foreground">{tf(inv.dealType)}</span>
                            <span className="text-muted-foreground text-xs ml-1">· {inv.term}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{fmt(inv.loanAmount)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                              {t('bps', { n: inv.bps })}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-green-700 whitespace-nowrap">
                            {fmt(inv.amount)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="flex items-center gap-1.5 text-green-700">
                              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                              {inv.paidDate ? fmtDate(inv.paidDate) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t('downloadPdf')}
                              disabled={pdfBusyId === inv.id}
                              onClick={() => handleDownloadPdf(inv.id)}
                            >
                              <Download className={`h-3.5 w-3.5 ${pdfBusyId === inv.id ? 'animate-pulse' : ''}`} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── CANCELLED ───────────────────────────────────────────────────── */}
          <TabsContent value="cancelled" className="mt-4">
            {cancelled.length === 0 ? (
              <div className="bg-card border border-border rounded-lg py-16 text-center">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-semibold text-foreground">{t('cancelledEmpty')}</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colInvoice')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colDeal')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLocation')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colTypeTerm')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colLoanAmount')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colBps')}</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colFeeVoid')}</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('colCancelled')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cancelled.map((inv) => (
                        <tr
                          key={inv.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors opacity-70"
                        >
                          <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.dealRef}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{inv.propertyCity}, {inv.propertyProvince}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-foreground">{tf(inv.dealType)}</span>
                            <span className="text-muted-foreground text-xs ml-1">· {inv.term}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium whitespace-nowrap line-through text-muted-foreground">
                            {fmt(inv.loanAmount)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                              {t('bps', { n: inv.bps })}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-muted-foreground line-through whitespace-nowrap">
                            {fmt(inv.amount)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                              {inv.cancelledDate ? fmtDate(inv.cancelledDate) : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-muted/50 border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground">
          <FileText className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t('infoBanner', { email: SUPPORT_EMAIL })}</span>
        </div>
      </main>

      {/* Make Changes dialog */}
      {changingInvoice && (
        <MakeChangesDialog
          invoice={changingInvoice}
          open={!!changingId}
          onClose={() => setChangingId(null)}
          onSave={handleSaveChanges}
        />
      )}

      {/* Mark as Paid — confirmation */}
      <AlertDialog open={!!markingPaidId} onOpenChange={(o) => !o && setMarkingPaidId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              {t('markPaidTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('markPaidBody', { invoice: invoices.find((i) => i.id === markingPaidId)?.invoiceNumber ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('goBack')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-green-600 hover:bg-green-700"
              onClick={() => markingPaidId && handleMarkPaid(markingPaidId)}
            >
              {t('confirmPayment')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel — confirmation */}
      <AlertDialog open={!!cancellingId} onOpenChange={(o) => !o && setCancellingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              {t('cancelTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t('cancelBody1', { invoice: invoices.find((i) => i.id === cancellingId)?.invoiceNumber ?? '' })}</p>
                <p className="font-medium text-foreground">{t('cancelBody2')}</p>
                <p>{t('cancelBody3')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('goBack')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => cancellingId && handleCancel(cancellingId)}
            >
              {t('confirmCancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
