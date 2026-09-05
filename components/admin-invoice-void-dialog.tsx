'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { XCircle } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import type { AdminInvoiceRow } from '@/lib/queries/admin'

/**
 * Admin Invoice Management (2026-09-04): voids a PENDING invoice via admin_void_invoice(), reusing the
 * existing 'voided' status (migration 85/86) — a reason is required, matching the RPC's own guard.
 */
export function AdminInvoiceVoidDialog({
  invoice,
  open,
  onClose,
  onConfirm,
  busy,
}: {
  invoice: AdminInvoiceRow | null
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  busy: boolean
}) {
  const t = useT('admin')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  if (!invoice) return null
  const trimmed = reason.trim()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            {t('voidInvoiceTitle', { invoice: invoice.invoiceNumber })}
          </DialogTitle>
          <DialogDescription>
            {invoice.status === 'pending' ? t('voidInvoiceBody') : t('voidOnlyPending')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="void-reason">{t('voidReasonLabel')}</Label>
          <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          {!trimmed && <p className="text-xs text-muted-foreground">{t('voidReasonRequired')}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('voidCancel')}</Button>
          <Button
            variant="destructive"
            disabled={!trimmed || busy || invoice.status !== 'pending'}
            onClick={() => onConfirm(trimmed)}
          >
            {t('voidConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
