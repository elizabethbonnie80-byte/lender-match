'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Toaster, toast } from 'sonner'
import { Settings, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { getInvoiceSettings, setInvoiceSettings, type InvoiceSettings } from '@/lib/queries/admin'

type TaxLineDraft = { key: string; label: string; rate: string }
let keySeq = 0
const nextKey = () => `tl-${++keySeq}`

/**
 * Admin Invoice Management (2026-09-04): global defaults for NEW invoices only — editing this page
 * never touches an existing invoice (accept_offer reads it once, at creation time). Deliberately NOT a
 * drag-and-drop designer — a handful of text fields + a tax-line template list, mirroring the
 * /admin/penalties settings-card pattern.
 */
export default function InvoiceSettingsPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const [headerText, setHeaderText] = useState('')
  const [defaultDescription, setDefaultDescription] = useState('')
  const [footerText, setFooterText] = useState('')
  const [defaultPaymentInstructions, setDefaultPaymentInstructions] = useState('')
  const [taxLines, setTaxLines] = useState<TaxLineDraft[]>([])

  const load = useCallback(async () => {
    const s = await getInvoiceSettings(supabase)
    setHeaderText(s.headerText ?? '')
    setDefaultDescription(s.defaultDescription ?? '')
    setFooterText(s.footerText ?? '')
    setDefaultPaymentInstructions(s.defaultPaymentInstructions ?? '')
    setTaxLines(s.defaultTaxLines.map((l) => ({ key: nextKey(), label: l.label, rate: String(l.rate) })))
    setUpdatedAt(s.updatedAt)
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('invSettingsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  function addTaxLine() {
    setTaxLines((prev) => [...prev, { key: nextKey(), label: '', rate: '0' }])
  }
  function removeTaxLine(key: string) {
    setTaxLines((prev) => prev.filter((l) => l.key !== key))
  }
  function updateTaxLine(key: string, field: 'label' | 'rate', value: string) {
    setTaxLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  const save = async () => {
    setSaving(true)
    try {
      const input: Omit<InvoiceSettings, 'updatedAt'> = {
        headerText: headerText.trim() || null,
        defaultDescription: defaultDescription.trim() || null,
        footerText: footerText.trim() || null,
        defaultPaymentInstructions: defaultPaymentInstructions.trim() || null,
        defaultTaxLines: taxLines
          .filter((l) => l.label.trim())
          .map((l) => ({ label: l.label.trim(), rate: Number.parseFloat(l.rate) || 0 })),
      }
      const next = await setInvoiceSettings(supabase, input)
      setUpdatedAt(next.updatedAt)
      toast.success(t('invSettingsSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('invSettingsErr'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('invoiceSettingsTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-2xl">{t('invoiceSettingsIntro')}</p>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Settings className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">{t('invSettingsLoading')}</p>
          </div>
        ) : loadError ? (
          <div className="py-16 text-center">
            <p className="text-sm font-semibold text-destructive">{loadError}</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="header-text">{t('invHeaderText')}</Label>
              <Input id="header-text" value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder={t('invHeaderTextPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-description">{t('invDefaultDescription')}</Label>
              <Input id="default-description" value={defaultDescription} onChange={(e) => setDefaultDescription(e.target.value)} placeholder={t('invDefaultDescriptionPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="footer-text">{t('invFooterText')}</Label>
              <Textarea id="footer-text" value={footerText} onChange={(e) => setFooterText(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-payment-instructions">{t('invDefaultPaymentInstructions')}</Label>
              <Textarea id="default-payment-instructions" value={defaultPaymentInstructions} onChange={(e) => setDefaultPaymentInstructions(e.target.value)} rows={2} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('invDefaultTaxLines')}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addTaxLine} className="gap-1 h-7">
                  <Plus className="h-3.5 w-3.5" /> {t('invAddTaxLine')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('invDefaultTaxLinesHint')}</p>
              {taxLines.length === 0 && <p className="text-xs text-muted-foreground italic">{t('invNoDefaultTaxLines')}</p>}
              {taxLines.map((l) => (
                <div key={l.key} className="flex items-center gap-2">
                  <Input
                    placeholder={t('invTaxLabelPlaceholder')}
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

            <div className="flex items-center justify-between pt-2 border-t border-border">
              {updatedAt && (
                <p className="text-xs text-muted-foreground">
                  {t('invSettingsLastUpdated', { date: new Date(updatedAt).toLocaleString() })}
                </p>
              )}
              <Button onClick={save} disabled={saving} className="gap-1.5 ml-auto">
                {t('invSettingsSave')}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
