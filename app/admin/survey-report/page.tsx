'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from 'sonner'
import { ClipboardList, Printer, AlertCircle, Star, Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listSurveyReport, type SurveyReportRow } from '@/lib/queries/admin'
import { downloadCsv, todayStamp } from '@/lib/csv'
import { useT } from '@/components/i18n-provider'

// English yes/no for the CSV export (stable data). The table uses a localized version.
const ynEn = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No')

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}

export default function AdminSurveyReportPage() {
  const t = useT('admin')
  const yn = (v: boolean | null) => (v === null ? '—' : v ? t('yes') : t('no'))
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<SurveyReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [satFilter, setSatFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    let active = true
    listSurveyReport(supabase)
      .then((r) => { if (active) setRows(r) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('surveysLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, t])

  const rated = rows.filter((r) => r.satisfaction != null)
  const avgSat = rated.length ? (rated.reduce((s, r) => s + (r.satisfaction ?? 0), 0) / rated.length).toFixed(2) : '—'
  const closedCount = rows.filter((r) => r.closedWithLender).length

  const visible = rows.filter((r) => {
    if (statusFilter === 'closed' && !r.closedWithLender) return false
    if (statusFilter === 'not_closed' && r.closedWithLender) return false
    if (satFilter !== 'all' && String(r.satisfaction ?? '') !== satFilter) return false
    return true
  })

  const exportCsv = () =>
    downloadCsv(`surveys-${todayStamp()}.csv`, visible, [
      { header: 'Deal', value: (r) => r.dealNumber ?? '' },
      { header: 'Lender Institution', value: (r) => r.lenderInstitution ?? '' },
      { header: 'Lender', value: (r) => r.lenderName },
      { header: 'Broker', value: (r) => r.brokerName },
      { header: 'Closed with lender', value: (r) => ynEn(r.closedWithLender) },
      { header: 'Commitment on time', value: (r) => ynEn(r.commitmentOnTime) },
      { header: 'Doc review on time', value: (r) => ynEn(r.docReviewOnTime) },
      { header: 'Funded on time', value: (r) => ynEn(r.fundedOnTime) },
      { header: 'Satisfaction', value: (r) => r.satisfaction ?? '' },
      { header: 'Reason (if not closed)', value: (r) => r.notClosedReason ?? '' },
      { header: 'Comments', value: (r) => r.comments ?? '' },
      { header: 'Completed', value: (r) => r.completedAt?.slice(0, 10) ?? '' },
    ])

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start justify-between gap-4 mb-8 print:hidden">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('surveyReportTitle')}</h1>
            <p className="text-muted-foreground text-sm">
              {visible.length !== rows.length
                ? t('surveysTotalShown', { total: rows.length, shown: visible.length })
                : t('surveysTotal', { total: rows.length })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0} className="gap-1.5">
              <Download className="h-4 w-4" /> {t('downloadCsv')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
              <Printer className="h-4 w-4" /> {t('print')}
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Kpi label={t('kpiCompleted')} value={String(rows.length)} />
          <Kpi label={t('kpiAvgSat')} value={avgSat === '—' ? '—' : `${avgSat} / 5`} />
          <Kpi label={t('kpiClosedWith')} value={String(closedCount)} />
          <Kpi label={t('kpiDidNotClose')} value={String(rows.length - closedCount)} />
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3 print:hidden">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allOutcomes')}</SelectItem>
              <SelectItem value="closed">{t('outcomeClosed')}</SelectItem>
              <SelectItem value="not_closed">{t('outcomeNotClosed')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={satFilter} onValueChange={setSatFilter}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('anySatisfaction')}</SelectItem>
              {[5, 4, 3, 2, 1].map((n) => (
                <SelectItem key={n} value={String(n)}>{n === 1 ? t('star', { n }) : t('stars', { n })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('surveysLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('surveysLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('noCompletedSurveys')}</p>
              <p className="text-xs text-muted-foreground">{t('surveysAppearHint')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">{t('colDeal')}</th>
                    <th className="px-4 py-3 font-medium">{t('colLender')}</th>
                    <th className="px-4 py-3 font-medium">{t('colBroker')}</th>
                    <th className="px-4 py-3 font-medium">{t('colClosed')}</th>
                    <th className="px-4 py-3 font-medium">{t('colCommitment')}</th>
                    <th className="px-4 py-3 font-medium">{t('colDocReview')}</th>
                    <th className="px-4 py-3 font-medium">{t('colFunded')}</th>
                    <th className="px-4 py-3 font-medium">{t('colSatisfaction')}</th>
                    <th className="px-4 py-3 font-medium">{t('colComments')}</th>
                    <th className="px-4 py-3 font-medium">{t('colCompleted')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 align-top">
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{r.dealNumber ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-foreground">{r.lenderInstitution ?? '—'}</span>
                        <span className="block text-xs text-muted-foreground">{r.lenderName}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.brokerName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            r.closedWithLender ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {yn(r.closedWithLender)}
                        </span>
                        {r.closedWithLender === false && r.notClosedReason && (
                          <span className="block text-xs text-muted-foreground max-w-[220px] mt-1 whitespace-normal">
                            {r.notClosedReason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{yn(r.commitmentOnTime)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{yn(r.docReviewOnTime)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{yn(r.fundedOnTime)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.satisfaction != null ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                            {r.satisfaction}/5
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Client 2026-07-28 (B-3): the broker's free-text note. Wraps rather than
                          truncating — the point of the column is to be readable. */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.comments ? (
                          <span className="block max-w-[280px] whitespace-normal">{r.comments}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.completedAt?.slice(0, 10) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
