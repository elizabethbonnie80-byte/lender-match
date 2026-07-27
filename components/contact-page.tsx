'use client'

import { useState, type ReactNode } from 'react'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/components/field-error'
import { CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sendContactMessage } from '@/lib/queries/contact'
import { SUPPORT_EMAIL } from '@/lib/brand'

type FormState = 'idle' | 'submitting' | 'success'

/**
 * Shared Contact page body for the broker and lender portals — the two routes were 95% identical,
 * differing only in the header chrome and two i18n keys. Pass the role's header + subtitle/thank-you
 * keys. Submits via the `contact-us` edge function (Resend) to SUPPORT_EMAIL (Round 3 Phase 1).
 */
export function ContactPage({
  header,
  subtitleKey,
  thankYouKey,
}: {
  header: ReactNode
  /** Omitted on the lender contact page — client 2026-07-23 (A-29). */
  subtitleKey?: 'subtitleBroker' | 'subtitleLender'
  thankYouKey: 'thankYouBroker' | 'thankYouLender'
}) {
  const t = useT('contact')
  const [formState, setFormState] = useState<FormState>('idle')
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    organization: '',
    invoiceNumber: '',
    dealRef: '',
    message: '',
  })

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const isValid = form.name.trim() && form.email.trim() && form.message.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) {
      setShowErrors(true)
      return
    }
    setFormState('submitting')
    setError(null)
    try {
      await sendContactMessage(createClient(), form)
      setFormState('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'))
      setFormState('idle')
    }
  }

  const handleReset = () => {
    setForm({ name: '', email: '', organization: '', invoiceNumber: '', dealRef: '', message: '' })
    setFormState('idle')
    setShowErrors(false)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-background">
      {header}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
          {subtitleKey && <p className="text-muted-foreground">{t(subtitleKey)}</p>}
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
              {t('sendMessage')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('sendMessageSub')}</p>
          </div>

          <div className="p-6">
            {formState === 'success' ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground mb-1">{t('messageSentTitle')}</p>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {t(thankYouKey, { name: form.name, email: form.email })}
                  </p>
                </div>
                <Button variant="outline" onClick={handleReset} className="mt-2">
                  {t('sendAnother')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      {t('fullName')} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      placeholder={t('phFullName')}
                      value={form.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      required
                      aria-invalid={showErrors && !form.name.trim()}
                      className="bg-muted/50"
                    />
                    <FieldError show={showErrors && !form.name.trim()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      {t('emailAddress')} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('phEmail')}
                      value={form.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      required
                      aria-invalid={showErrors && !form.email.trim()}
                      className="bg-muted/50"
                    />
                    <FieldError show={showErrors && !form.email.trim()} />
                  </div>
                </div>

                {/* Organization + Invoice # */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="organization">
                      {t('organization')}
                      <span className="text-muted-foreground text-xs ml-1">{t('optional')}</span>
                    </Label>
                    <Input
                      id="organization"
                      placeholder={t('phOrganization')}
                      value={form.organization}
                      onChange={(e) => handleChange('organization', e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoiceNumber">
                      {t('invoiceNumber')}
                      <span className="text-muted-foreground text-xs ml-1">{t('ifApplicable')}</span>
                    </Label>
                    <Input
                      id="invoiceNumber"
                      placeholder={t('phInvoice')}
                      value={form.invoiceNumber}
                      onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                {/* Deal Reference # */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dealRef">{t('dealRef')}</Label>
                    <Input
                      id="dealRef"
                      placeholder={t('phDealRef')}
                      value={form.dealRef}
                      onChange={(e) => handleChange('dealRef', e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label htmlFor="message">
                    {t('message')} <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    placeholder={t('phMessage')}
                    value={form.message}
                    onChange={(e) => handleChange('message', e.target.value)}
                    required
                    aria-invalid={showErrors && !form.message.trim()}
                    rows={6}
                    className="bg-muted/50 resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <FieldError show={showErrors && !form.message.trim()} />
                    <p className="text-xs text-muted-foreground text-right ml-auto">
                      {t('charCount', { n: form.message.length })}
                    </p>
                  </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                {/* Submit */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    <span className="text-destructive">*</span> {t('requiredFields')}
                  </p>
                  <Button
                    type="submit"
                    disabled={formState === 'submitting'}
                    className={`min-w-36 ${!isValid ? 'opacity-50' : ''}`}
                  >
                    {formState === 'submitting' ? t('sending') : t('send')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          {t('orEmail', { email: SUPPORT_EMAIL })}
        </p>
      </main>
    </div>
  )
}
