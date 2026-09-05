'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2 } from 'lucide-react'
import { useT, useLocale } from '@/components/i18n-provider'
import type { AdminInvoiceRow, AdminUpdateInvoiceInput } from '@/lib/queries/admin'

type TaxLineDraft = { key: string; label: string; rate: string }

function fmtMoney(n: number, locale: string) {
  return n.toLocaleString(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

let keySeq = 0
const nextKey = () => `tl-${++keySeq}`

/**
 * Admin Invoice Management (2026-09-04): edits a PENDING invoice's financial/content fields.
 * The grand total shown here is a CLIENT-SIDE preview only, for the admin's convenience — the actual
 * total is always recalculated server-side by admin_update_invoice(), which never trusts this preview.
 */
export function AdminInvoiceEditDialog({
  invoice,
  open,
  onClose,
  onSave,
  saving,
}: {
  invoice: AdminInvoiceRow | null
  open: boolean
  onClose: () => void
  onSave: (input: AdminUpdateInvoiceInput) => void
  saving: boolean
}) {
  const t = useT('admin')
  const locale = useLocale()
  const fmt = (n: number) => fmtMoney(n, locale === 'fr' ? 'fr-CA' : 'en-CA')

  const [subtotal, setSubtotal] = useState('')
  const [discountAmount, setDiscountAmount] = useState('0')
  const [discountReason, setDiscountReason] = useState('')
  const [taxLines, setTaxLines] = useState<TaxLineDraft[]>([])
  const [description, setDescription] = useState('')
  const [billingReference, setBillingReference] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentInstructions, setPaymentInstructions] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [changeReason, setChangeReason] = useState('')

  useEffect(() => {
    if (!invoice) return
    setSubtotal(String(invoice.subtotal))
    setDiscountAmount(String(invoice.discountAmount))
    setDiscountReason(invoice.discountReason ?? '')
    setTaxLines(invoice.taxLines.map((l) => ({ key: nextKey(), label: l.label, rate: String(l.rate) })))
    setDescription(invoice.description ?? '')
    setBillingReference(invoice.billingReference ?? '')
    setNotes(invoice.notes ?? '')
    setPaymentInstructions(invoice.paymentInstructions ?? '')
    setDueDate(invoice.dueDate)
    setChangeReason('')
  }, [invoice])

  if (!invoice) return null

  const parsedSubtotal = Number.parseFloat(subtotal) || 0
  const parsedDiscount = Number.parseFloat(discountAmount) || 0
  const taxableBase = Math.max(parsedSubtotal - parsedDiscount, 0)
  const previewTaxLines = taxLines.map((l) => {
    const rate = Number.parseFloat(l.rate) || 0
    return { label: l.label || t('editTaxLabelPlaceholder'), rate, amount: Math.round(taxableBase * rate) / 100 }
  })
  const taxTotal = previewTaxLines.reduce((s, l) => s + l.amount, 0)
  const grandTotal = parsedSubtotal - parsedDiscount + taxTotal

  const invalid = parsedSubtotal < 0 || parsedDiscount < 0 || parsedDiscount > parsedSubtotal

  function addTaxLine() {
    setTaxLines((prev) => [...prev, { key: nextKey(), label: '', rate: '0' }])
  }
  function removeTaxLine(key: string) {
    setTaxLines((prev) => prev.filter((l) => l.key !== key))
  }
  function updateTaxLine(key: string, field: 'label' | 'rate', value: string) {
    setTaxLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  function handleSave() {
    if (invalid) return
    onSave({
      subtotal: parsedSubtotal,
      discountAmount: parsedDiscount,
      discountReason: discountReason.trim() || null,
      taxLines: taxLines
        .filter((l) => l.label.trim())
        .map((l) => ({ label: l.label.trim(), rate: Number.parseFloat(l.rate) || 0 })),
      description: description.trim() || null,
      billingReference: billingReference.trim() || null,
      notes: notes.trim() || null,
      paymentInstructions: paymentInstructions.trim() || null,
      dueDate: dueDate || null,
      changeReason: changeReason.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editInvoiceTitle', { invoice: invoice.invoiceNumber })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {invoice.status !== 'pending' && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-md p-2">{t('editOnlyPending')}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-subtotal">{t('editSubtotal')}</Label>
              <Input id="edit-subtotal" type="number" min={0} step="0.01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-due-date">{t('editDueDate')}</Label>
              <Input id="edit-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-discount">{t('editDiscountAmount')}</Label>
              <Input id="edit-discount" type="number" min={0} step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-discount-reason">{t('editDiscountReason')}</Label>
              <Input id="edit-discount-reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </div>
          </div>
          {invalid && <p className="text-xs text-destructive">{t('editDiscountExceedsSubtotal')}</p>}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('editTaxLines')}</Label>
              <Button type="button" variant="outline" size="sm" onClick={addTaxLine} className="gap-1 h-7">
                <Plus className="h-3.5 w-3.5" /> {t('editAddTaxLine')}
              </Button>
            </div>
            {taxLines.length === 0 && <p className="text-xs text-muted-foreground">{t('editNoTaxLines')}</p>}
            {taxLines.map((l) => (
              <div key={l.key} className="flex items-center gap-2">
                <Input
                  placeholder={t('editTaxLabelPlaceholder')}
                  value={l.label}
                  onChange={(e) => updateTaxLine(l.key, 'label', e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="number" min={0} step="0.01"
                  value={l.rate}
                  onChange={(e) => updateTaxLine(l.key, 'rate', e.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeTaxLine(l.key)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-description">{t('editDescription')}</Label>
            <Input id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('editDescriptionPlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-billing-ref">{t('editBillingReference')}</Label>
            <Input id="edit-billing-ref" value={billingReference} onChange={(e) => setBillingReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-payment-instructions">{t('editPaymentInstructions')}</Label>
            <Textarea id="edit-payment-instructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">{t('editNotes')}</Label>
            <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-change-reason">{t('editChangeReason')}</Label>
            <Input id="edit-change-reason" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder={t('editChangeReasonPlaceholder')} />
          </div>

          <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{t('editPreview')}</p>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('editSubtotal')}</span><span>{fmt(parsedSubtotal)}</span>
            </div>
            {parsedDiscount > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('editDiscountAmount')}</span><span>-{fmt(parsedDiscount)}</span>
              </div>
            )}
            {previewTaxLines.map((l, idx) => (
              <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                <span>{l.label} ({l.rate}%)</span><span>{fmt(l.amount)}</span>
              </div>
            ))}
            <div className="border-t border-border pt-1.5 flex justify-between font-semibold text-foreground">
              <span>{t('editGrandTotal')}</span><span>{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('editCancel')}</Button>
          <Button onClick={handleSave} disabled={invalid || saving || invoice.status !== 'pending'}>
            {t('editSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
