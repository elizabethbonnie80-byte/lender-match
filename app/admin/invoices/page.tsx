'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster, toast } from 'sonner'
import { Receipt, Search, AlertCircle, Download, DollarSign, CheckCircle, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAllInvoices, type AdminInvoiceRow } from '@/lib/queries/admin'
import { markInvoicePaid } from '@/lib/queries/offers'
import { RowActions } from '@/components/row-actions'
import { downloadCsv, todayStamp } from '@/lib/csv'
import { useT, useLocale } from '@/components/i18n-provider'
import type { Database } from '@/lib/database.types'

type InvoiceStatus = Database['public']['Enums']['invoice_status']

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-muted text-muted-foreground',
}

const money = (n: number, locale: string) =>
  n.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

// Whole calendar days an invoice is past its due date (0 if not yet due). UTC-anchored like the lender page.
function daysOverdue(dueDate: string): number {
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.round((todayUtc - new Date(dueDate).getTime()) / 86400000))
}

export default function AdminInvoicesPage() {
  const t = useT('admin')
  const locale = useLocale()
  const fmt = (n: number) => money(n, locale)
  const supabase = useMemo(() => createClient(), [])
  const [invoices, setInvoices] = useState<AdminInvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  // Defaults to 'current': the point of archiving is that old paid invoices stop cluttering this list.
  const [archiveFilter, setArchiveFilter] = useState('current')

  const STATUS_LABEL: Record<InvoiceStatus, string> = {
    pending: t('invPending'),
    paid: t('invPaid'),
    cancelled: t('invCancelled'),
  }

  const reload = useCallback(
    () => listAllInvoices(supabase).then(setInvoices).catch(() => {}),
    [supabase],
  )

  useEffect(() => {
    let active = true
    listAllInvoices(supabase)
      .then((rows) => { if (active) setInvoices(rows) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('invoicesLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, t])

  // Client 2026-07-25 (B-2): "How does the analytics know in the Admin portal that an invoice is paid?
  // There doesn't seem to be anywhere I can mark them as paid." The mark_invoice_paid RPC already
  // accepts an admin (`inv.lender_id <> auth.uid() and not is_admin()`), so this needed no migration —
  // only the action.
  const [busyId, setBusyId] = useState<string | null>(null)
  const handleMarkPaid = async (id: string) => {
    setBusyId(id)
    try {
      await markInvoicePaid(supabase, id)
      await reload()
      toast.success(t('invMarkedPaid'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('invMarkPaidErr'))
    } finally {
      setBusyId(null)
    }
  }

  const visible = invoices.filter((i) => {
    if (archiveFilter === 'current' && i.archivedAt) return false
    if (archiveFilter === 'archived' && !i.archivedAt) return false
    if (statusFilter !== 'all' && i.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${i.invoiceNumber} ${i.dealNumber} ${i.lenderName} ${i.lenderInstitution ?? ''} ${i.clientName}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // KPIs over ALL invoices (not the filtered view) — platform oversight.
  const paidTotal = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
  const outstandingTotal = invoices.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0)
  const overdueCount = invoices.filter((i) => i.status === 'pending' && daysOverdue(i.dueDate) > 0).length

  const exportCsv = () =>
    downloadCsv(`invoices-${todayStamp()}.csv`, visible, [
      { header: 'Invoice #', value: (i) => i.invoiceNumber },
      { header: 'Deal #', value: (i) => i.dealNumber },
      { header: 'Lender', value: (i) => i.lenderName },
      { header: 'Institution', value: (i) => i.lenderInstitution ?? '' },
      { header: 'Client', value: (i) => i.clientName },
      { header: 'Loan Amount', value: (i) => i.loanAmount },
      { header: 'Fee', value: (i) => i.amount },
      { header: 'bps', value: (i) => i.bps },
      { header: 'Term', value: (i) => i.term },
      { header: 'Status', value: (i) => i.status },
      { header: 'Issue Date', value: (i) => i.issueDate },
      { header: 'Due Date', value: (i) => i.dueDate },
      { header: 'Paid Date', value: (i) => i.paidDate ?? '' },
      { header: 'Archived', value: (i) => (i.archivedAt ? i.archivedAt.slice(0, 10) : '') },
    ])

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('invoicesTitle')}</h1>
            <p className="text-muted-foreground text-sm">
              {visible.length !== invoices.length
                ? t('invoicesTotalShown', { total: invoices.length, shown: visible.length })
                : t('invoicesTotal', { total: invoices.length })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0} className="gap-1.5 shrink-0">
            <Download className="h-4 w-4" /> {t('downloadCsv')}
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2 shrink-0"><Receipt className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('kpiInvoices')}</p>
              <p className="text-lg font-bold text-foreground">{invoices.length}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className="bg-green-100 rounded-lg p-2 shrink-0"><CheckCircle className="h-5 w-5 text-green-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('kpiPaid')}</p>
              <p className="text-lg font-bold text-green-700">{fmt(paidTotal)}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className="bg-yellow-100 rounded-lg p-2 shrink-0"><DollarSign className="h-5 w-5 text-yellow-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('kpiOutstanding')}</p>
              <p className="text-lg font-bold text-foreground">{fmt(outstandingTotal)}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-4 flex items-center gap-3">
            <div className={`${overdueCount > 0 ? 'bg-red-100' : 'bg-muted'} rounded-lg p-2 shrink-0`}>
              <Clock className={`h-5 w-5 ${overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('kpiOverdue')}</p>
              <p className={`text-lg font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-foreground'}`}>{overdueCount}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t('searchInvoices')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              <SelectItem value="pending">{STATUS_LABEL.pending}</SelectItem>
              <SelectItem value="paid">{STATUS_LABEL.paid}</SelectItem>
              <SelectItem value="cancelled">{STATUS_LABEL.cancelled}</SelectItem>
            </SelectContent>
          </Select>
          {/* Client 2026-07-28 (A-25): archived invoices are out of the default list but never gone —
              this is how they get to them. */}
          <Select value={archiveFilter} onValueChange={setArchiveFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current">{t('invCurrentOnly')}</SelectItem>
              <SelectItem value="archived">{t('invArchivedOnly')}</SelectItem>
              <SelectItem value="all">{t('invIncludeArchived')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('invoicesLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('invoicesLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('noInvoicesMatch')}</p>
              <p className="text-xs text-muted-foreground">{t('tryClearFilters')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">{t('colInvoice')}</th>
                    <th className="px-4 py-3 font-medium">{t('colDealNum')}</th>
                    <th className="px-4 py-3 font-medium">{t('colLender')}</th>
                    <th className="px-4 py-3 font-medium">{t('colClient')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colLoan')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colFee')}</th>
                    <th className="px-4 py-3 font-medium">{t('colTerm')}</th>
                    <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                    <th className="px-4 py-3 font-medium">{t('colIssue')}</th>
                    <th className="px-4 py-3 font-medium">{t('colDue')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((i) => {
                    const overdue = i.status === 'pending' && daysOverdue(i.dueDate) > 0
                    return (
                      <tr key={i.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-foreground whitespace-nowrap">{i.invoiceNumber}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{i.dealNumber}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-foreground">{i.lenderName}</span>
                          {i.lenderInstitution && <span className="text-muted-foreground text-xs block">{i.lenderInstitution}</span>}
                        </td>
                        <td className="px-4 py-3 text-foreground whitespace-nowrap">{i.clientName}</td>
                        <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{fmt(i.loanAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">{fmt(i.amount)}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{i.term}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[i.status]}`}>
                            {STATUS_LABEL[i.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{i.issueDate}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{i.dueDate}</span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {i.status === 'pending' && (
                            <RowActions
                              label={t('actions')}
                              actions={[{
                                label: t('invMarkPaid'),
                                icon: <CheckCircle className="h-4 w-4" />,
                                onSelect: () => handleMarkPaid(i.id),
                                disabled: busyId === i.id,
                              }]}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
