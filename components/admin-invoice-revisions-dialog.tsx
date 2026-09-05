'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { History, AlertCircle } from 'lucide-react'
import { useT, useLocale } from '@/components/i18n-provider'
import { createClient } from '@/lib/supabase/client'
import { listInvoiceRevisions, type InvoiceRevision } from '@/lib/queries/admin'

function fmtMoney(n: unknown, locale: string) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateTime(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Admin Invoice Management (2026-09-04): read-only viewer over invoice_revisions (append-only, admin
 * read via RLS). Each row is the invoice as it stood BEFORE that revision's change — so "revision 1"
 * shown here means "this is what the invoice looked like before its first edit".
 */
export function AdminInvoiceRevisionsDialog({
  invoiceId,
  invoiceNumber,
  open,
  onClose,
}: {
  invoiceId: string | null
  invoiceNumber: string
  open: boolean
  onClose: () => void
}) {
  const t = useT('admin')
  const locale = useLocale()
  const dl = locale === 'fr' ? 'fr-CA' : 'en-CA'
  const supabase = createClient()
  const [revisions, setRevisions] = useState<InvoiceRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !invoiceId) return
    let active = true
    setLoading(true)
    setLoadError(null)
    listInvoiceRevisions(supabase, invoiceId)
      .then((rows) => { if (active) setRevisions(rows) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('revisionHistoryError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('revisionHistoryTitle', { invoice: invoiceNumber })}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse py-8 text-center">{t('revisionHistoryLoading')}</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">{loadError}</p>
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t('revisionHistoryEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {revisions.map((r) => {
              const snap = r.snapshot as Record<string, unknown>
              return (
                <div key={r.id} className="border border-border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-foreground">{t('revisionLabel', { n: r.revisionNumber })}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt, dl)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('revisionChangedBy', { name: r.changedByName })}
                    {r.changeReason && <> — {r.changeReason}</>}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs bg-muted/40 rounded-md p-2">
                    <span className="text-muted-foreground">{t('revisionSnapshotStatus')}</span>
                    <span className="text-foreground">{String(snap.status ?? '—')}</span>
                    <span className="text-muted-foreground">{t('revisionSnapshotSubtotal')}</span>
                    <span className="text-foreground">{fmtMoney(snap.subtotal, dl)}</span>
                    <span className="text-muted-foreground">{t('revisionSnapshotDiscount')}</span>
                    <span className="text-foreground">{fmtMoney(snap.discount_amount, dl)}</span>
                    <span className="text-muted-foreground">{t('revisionSnapshotTax')}</span>
                    <span className="text-foreground">{fmtMoney(snap.tax_total, dl)}</span>
                    <span className="text-muted-foreground">{t('revisionSnapshotTotal')}</span>
                    <span className="text-foreground font-medium">{fmtMoney(snap.amount, dl)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
