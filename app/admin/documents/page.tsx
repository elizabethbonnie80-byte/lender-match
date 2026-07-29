'use client'

// Client 2026-07-28 (B-17): "I uploaded a pdf service agreement and ID but […] where can we view them
// in case we need to?" → "just in the admin portal in case we need to check them, or pull them for a
// lender regarding their invoice." Until now the two documents were only visible while the broker was
// still on the Create Deal wizard, so after submission nothing surfaced them.
//
// Read-only by design, and admin-only by RLS — `deal_documents` grants owner / brokerage-admin / platform
// admin and NEVER the lender, which is exactly what they asked for. No migration was needed.

import { useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster, toast } from 'sonner'
import { FileText, AlertCircle, Download, Search, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAllDealDocuments, type AdminDealDocumentRow } from '@/lib/queries/admin'
import { signedDealDocumentUrl } from '@/lib/queries/deal-documents'
import { downloadCsv, todayStamp } from '@/lib/csv'
import { useT } from '@/components/i18n-provider'

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}

export default function AdminDocumentsPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<AdminDealDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listAllDealDocuments(supabase)
      .then((r) => { if (active) setRows(r) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('docsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, t])

  const q = search.trim().toLowerCase()
  const visible = rows.filter((r) => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (!q) return true
    return (
      (r.dealNumber ?? '').toLowerCase().includes(q) ||
      (r.borrowerName ?? '').toLowerCase().includes(q) ||
      (r.fileName ?? '').toLowerCase().includes(q)
    )
  })

  const kindLabel = (k: AdminDealDocumentRow['kind']) => (k === 'consent' ? t('docKindConsent') : t('docKindPhotoId'))

  /**
   * The bucket is private, so there is no durable URL to link: mint a short-lived signed one on click and
   * open it. Deliberately not pre-fetched for every row — that would hand out dozens of live URLs.
   */
  const open = async (row: AdminDealDocumentRow) => {
    setOpening(row.id)
    try {
      const url = await signedDealDocumentUrl(supabase, row.storagePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docsOpenErr'))
    } finally {
      setOpening(null)
    }
  }

  const exportCsv = () =>
    downloadCsv(`deal-documents-${todayStamp()}.csv`, visible, [
      { header: 'Deal', value: (r) => r.dealNumber ?? '' },
      { header: 'Document', value: (r) => (r.kind === 'consent' ? 'Consent' : 'Photo ID') },
      { header: 'File name', value: (r) => r.fileName ?? '' },
      { header: 'Borrower', value: (r) => r.borrowerName ?? '' },
      { header: 'Name on document', value: (r) => r.extractedName ?? '' },
      { header: 'Name check', value: (r) => (r.nameMatches === null ? 'Not checked' : r.nameMatches ? 'Match' : r.nameVariance ? 'Variance' : 'Mismatch') },
      { header: 'Uploaded', value: (r) => r.uploadedAt.slice(0, 10) },
    ])

  // Same three states the Create Deal badge shows, so admin and broker read the check identically.
  const nameCheck = (r: AdminDealDocumentRow) => {
    if (r.nameMatches === null) return { label: t('docCheckNone'), cls: 'bg-muted text-muted-foreground' }
    if (r.nameMatches) return { label: t('docCheckMatch'), cls: 'bg-green-100 text-green-800' }
    if (r.nameVariance) return { label: t('docCheckVariance'), cls: 'bg-amber-100 text-amber-900' }
    return { label: t('docCheckMismatch'), cls: 'bg-red-100 text-red-800' }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{t('docsTitle')}</h1>
            <p className="text-muted-foreground text-sm">
              {visible.length !== rows.length
                ? t('docsTotalShown', { total: rows.length, shown: visible.length })
                : t('docsTotal', { total: rows.length })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0} className="gap-1.5 shrink-0">
            <Download className="h-4 w-4" /> {t('downloadCsv')}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <Kpi label={t('docsKpiTotal')} value={String(rows.length)} />
          <Kpi label={t('docsKpiConsent')} value={String(rows.filter((r) => r.kind === 'consent').length)} />
          <Kpi label={t('docsKpiVariance')} value={String(rows.filter((r) => r.nameVariance).length)} />
        </div>

        <div className="bg-card border border-border rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('docsSearchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('docsAllKinds')}</SelectItem>
              <SelectItem value="consent">{t('docKindConsent')}</SelectItem>
              <SelectItem value="photo_id">{t('docKindPhotoId')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('docsLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('docsLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('docsEmpty')}</p>
              <p className="text-xs text-muted-foreground">{t('docsEmptyHint')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">{t('colDeal')}</th>
                    <th className="px-4 py-3 font-medium">{t('docsColDocument')}</th>
                    <th className="px-4 py-3 font-medium">{t('docsColBorrower')}</th>
                    <th className="px-4 py-3 font-medium">{t('docsColNameCheck')}</th>
                    <th className="px-4 py-3 font-medium">{t('docsColUploaded')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((r) => {
                    const check = nameCheck(r)
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 align-top">
                        <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{r.dealNumber ?? '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-foreground">{kindLabel(r.kind)}</span>
                          {r.fileName && (
                            <span className="block text-xs text-muted-foreground max-w-[240px] truncate">{r.fileName}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.borrowerName ?? '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${check.cls}`}>{check.label}</span>
                          {/* On a variance the name actually read off the document is the useful part. */}
                          {r.extractedName && r.nameMatches === false && (
                            <span className="block text-xs text-muted-foreground mt-1">{r.extractedName}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.uploadedAt.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={opening === r.id}
                            onClick={() => open(r)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {opening === r.id ? t('docsOpening') : t('docsView')}
                          </Button>
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
