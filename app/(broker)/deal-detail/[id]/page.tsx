'use client'

import { PortalHeader } from '@/components/portal-header'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Check, X, AlertCircle, Lock } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  getBrokerDealDetail,
  getBrokerDealFull,
  listDealOffers,
  acceptOffer,
  switchOffer,
  getAcceptedLender,
  type BrokerDealDetail,
  type DealOffer,
  type AcceptedLender,
} from '@/lib/queries/offers'
import type { LenderDealListItem } from '@/lib/queries/deals'
import { offerStatusStyle } from '@/lib/status-styles'
import { getPendingSurveyForDeal, type PendingSurvey } from '@/lib/queries/surveys'
import { SurveyDialog } from '@/components/survey-dialog'
import { LenderDealDetailSections, DealSection, DealField } from '@/components/lender-deal-sections'
import { ClipboardList } from 'lucide-react'
import { useEnums } from '@/lib/use-enums'
import { useT, useLocale } from '@/components/i18n-provider'

// Raw offer_status enum → the capitalized key used in the shared `feed` catalog namespace.
const OFFER_STATUS_KEY: Record<DealOffer['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  switched: 'Switched',
}

function fmtDate(dateString: string | null, locale: string) {
  if (!dateString) return '—'
  // A date-only column ("2026-10-15") parses as UTC midnight, which renders as the PREVIOUS day in
  // any negative-offset timezone — every Canadian one. Pin those to local noon (same trick as
  // lender/invoices' fmtDay); real timestamps already carry an offset and are left alone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? new Date(`${dateString}T12:00:00`)
    : new Date(dateString)
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function DealDetailPage() {
  const params = useParams()
  const dealId = params.id as string
  const supabase = createClient()
  const t = useT('dealDetail')
  const tf = useT('feed')
  const { LABELS, DEAL_STATUS_LABEL } = useEnums()
  const dateLocale = useLocale() === 'fr' ? 'fr-CA' : 'en-US'
  const fmt = (d: string | null) => fmtDate(d, dateLocale)

  const [deal, setDeal] = useState<BrokerDealDetail | null>(null)
  const [fullDeal, setFullDeal] = useState<LenderDealListItem | null>(null)
  const [offers, setOffers] = useState<DealOffer[]>([])
  const [lender, setLender] = useState<AcceptedLender | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Confirm-accept modal
  const [pendingAcceptId, setPendingAcceptId] = useState<string | null>(null)

  // Closing survey (created by the cron job when the deal closes)
  const [pendingSurvey, setPendingSurvey] = useState<PendingSurvey | null>(null)
  const [surveyOpen, setSurveyOpen] = useState(false)

  const load = useCallback(async () => {
    const d = await getBrokerDealDetail(supabase, dealId)
    setDeal(d)
    if (!d) return
    setFullDeal(await getBrokerDealFull(supabase, dealId))
    setOffers(await listDealOffers(supabase, dealId))
    if (['accepted', 'confirmed', 'funded'].includes(d.status)) {
      setLender(await getAcceptedLender(supabase, dealId))
    } else {
      setLender(null)
    }
    setPendingSurvey(await getPendingSurveyForDeal(supabase, dealId))
  }, [supabase, dealId])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : t('loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load])

  // Round 3 ONE-step accept (supersedes OQ#21): accept_offer atomically reveals the lender,
  // generates the platform-fee invoice, and notifies the lender — no separate Confirm step.
  const doAccept = async () => {
    if (!pendingAcceptId) return
    setBusy(true)
    try {
      await acceptOffer(supabase, pendingAcceptId)
      setPendingAcceptId(null)
      await load()
      toast.success(t('toastAccepted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastAcceptErr'))
    } finally {
      setBusy(false)
    }
  }

  const doSwitch = async () => {
    if (!deal) return
    setBusy(true)
    try {
      await switchOffer(supabase, deal.id)
      await load()
      toast.success(t('toastSwitched'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastSwitchErr'))
    } finally {
      setBusy(false)
    }
  }

  const accepted = deal && ['accepted', 'confirmed', 'funded'].includes(deal.status)
  const acceptedOffer = offers.find((o) => o.id === deal?.acceptedOfferId) ?? null

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/deal-room">
          <Button variant="outline" size="sm" className="gap-2 mb-6">
            <ArrowLeft className="h-4 w-4" />
            {t('back')}
          </Button>
        </Link>

        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t('loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-foreground">{t('loadErrorPrefix', { error: loadError })}</p>
        ) : !deal ? (
          <p className="text-sm text-foreground">{t('notFound')}</p>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">{deal.dealNumber}</h1>
                <p className="text-muted-foreground">{deal.clientName}</p>
              </div>
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-primary/10 text-primary">
                {DEAL_STATUS_LABEL[deal.status]}
              </span>
            </div>

            {/* Closing survey prompt (created by the cron job once the deal reaches its closing date) */}
            {pendingSurvey && (
              <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-4">
                <ClipboardList className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{t('surveyClosedTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('surveyClosedBody', { lender: pendingSurvey.lenderInstitution ?? t('lenderFallback') })}
                  </p>
                </div>
                <Button size="sm" onClick={() => setSurveyOpen(true)} className="gap-1.5 shrink-0">
                  <ClipboardList className="h-4 w-4" /> {t('completeSurvey')}
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Deal Information Sidebar */}
              <div className="lg:col-span-1">
                <div className="bg-card border border-border rounded-lg p-6 sticky top-8">
                  <h2 className="text-lg font-semibold text-foreground mb-4">{t('dealInformation')}</h2>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('client')}</p>
                      <p className="text-sm font-medium text-foreground">{deal.clientName}</p>
                    </div>
                    <hr className="my-4 border-border" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('location')}</p>
                      <p className="text-sm font-medium text-foreground">
                        {[deal.city, deal.province ? LABELS.province[deal.province] : null].filter(Boolean).join(', ') || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('propertyAddress')}</p>
                      <p className="text-sm font-medium text-foreground break-words">{deal.propertyAddress || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('loanAmount')}</p>
                      <p className="text-sm font-medium text-foreground">${deal.loanAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('ltv')}</p>
                      <p className="text-sm font-medium text-foreground">{deal.ltv !== null ? `${deal.ltv}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('product')}</p>
                      <p className="text-sm font-medium text-foreground">
                        {deal.mortgageProduct ? LABELS.mortgage_product[deal.mortgageProduct] : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('closingDate')}</p>
                      <p className="text-sm font-medium text-foreground">{fmt(deal.closingDate)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Offers / Accepted section */}
              <div className="lg:col-span-2 space-y-4">
                {accepted && acceptedOffer ? (
                  <div className="bg-card border border-green-300 rounded-lg p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h3 className="text-xl font-semibold text-foreground">
                          {t('offerAccepted')}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t('offerLine', { n: acceptedOffer.offerNumber, product: LABELS.mortgage_product[acceptedOffer.mortgageProduct] })}
                        </p>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {DEAL_STATUS_LABEL[deal.status]}
                      </span>
                    </div>

                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
                      {/* Lender identity — revealed only after acceptance */}
                      <div className="mb-6">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t('lender')}</p>
                        {lender ? (
                          <>
                            <p className="text-lg font-semibold text-foreground">
                              {lender.firstName} {lender.lastName}
                            </p>
                            {lender.institution && (
                              <p className="text-sm text-muted-foreground">{lender.institution}</p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t('revealing')}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('rate')}</p>
                          <p className="text-xl font-bold text-foreground">{acceptedOffer.rate.toFixed(2)}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('rateLock')}</p>
                          <p className="text-xl font-bold text-foreground">{t('days', { n: acceptedOffer.rateLockDays })}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('commission')}</p>
                          <p className="text-xl font-bold text-foreground">{t('bps', { n: acceptedOffer.commissionBps })}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('processing')}</p>
                          <p className="text-xl font-bold text-foreground">
                            {t('days', { n: acceptedOffer.docReviewTurnTimeDays ?? '—' })}
                          </p>
                        </div>
                        {acceptedOffer.lenderFeePct !== null && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('lenderFeePct')}</p>
                            <p className="text-xl font-bold text-foreground">{acceptedOffer.lenderFeePct.toFixed(1)}%</p>
                          </div>
                        )}
                      </div>

                      {acceptedOffer.comments && (
                        <p className="text-sm text-muted-foreground mb-6">{acceptedOffer.comments}</p>
                      )}

                      {/* Round 3 one-step accept: the lender was notified and the platform-fee
                          invoice generated on acceptance — the broker's only remaining action is
                          Switch (max 2/month; blocked once the invoice is paid). */}
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                        <p className="text-sm font-semibold text-green-900">{t('acceptedNoticeTitle')}</p>
                        <p className="text-xs text-green-800 mt-1">{t('acceptedNoticeBody')}</p>
                      </div>

                      {deal.status !== 'funded' && (
                        <Button onClick={doSwitch} disabled={busy} variant="outline" className="w-full">
                          {t('switchOffer')}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-4">{t('availableOffers')}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{t('listedByArrival')}</p>

                    {/* Client-supplied disclaimer (2026-07-27), shown to the BROKER when viewing offers
                        placed on a pre-qualification — before conversion, and after it too, since those
                        offers carried over from the prequal. Nothing equivalent is shown to the lender. */}
                    {offers.length > 0 && (deal.prequal || deal.prequalConvertedAt) && (
                      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <p className="text-xs leading-relaxed text-amber-900">{t('prequalOfferNotice')}</p>
                      </div>
                    )}

                    {offers.length === 0 ? (
                      <div className="bg-card border border-border rounded-lg p-12 text-center">
                        <p className="text-sm font-semibold text-foreground mb-1">{t('noOffersTitle')}</p>
                        <p className="text-xs text-muted-foreground">{t('noOffersBody')}</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {offers.map((offer) => (
                          <div
                            key={offer.id}
                            className={`bg-card border rounded-lg p-6 transition-all ${
                              offer.status === 'declined'
                                ? 'opacity-60 border-red-200'
                                : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-start gap-4 flex-1">
                                <div className="bg-primary/10 text-primary w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold">
                                  {offer.offerNumber}
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">
                                    {t('submitted', { date: fmt(offer.createdAt) })}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {LABELS.mortgage_product[offer.mortgageProduct]}
                                  </p>
                                </div>
                              </div>
                              <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${offerStatusStyle(offer.status)}`}>
                                {tf(OFFER_STATUS_KEY[offer.status])}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('rate')}</p>
                                <p className="font-semibold text-foreground">{offer.rate.toFixed(2)}%</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('rateLock')}</p>
                                <p className="font-semibold text-foreground flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  {t('days', { n: offer.rateLockDays })}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('commission')}</p>
                                <p className="font-semibold text-foreground">{t('bps', { n: offer.commissionBps })}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('processing')}</p>
                                <p className="font-semibold text-foreground">
                                  {t('processingDays', { n: offer.docReviewTurnTimeDays ?? '—' })}
                                </p>
                              </div>
                              {offer.lenderFeePct !== null && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('lenderFeePct')}</p>
                                  <p className="font-semibold text-foreground">{offer.lenderFeePct.toFixed(1)}%</p>
                                </div>
                              )}
                            </div>

                            {offer.comments && (
                              <p className="text-sm text-muted-foreground mb-4 italic">{offer.comments}</p>
                            )}

                            {offer.status === 'declined' ? (
                              <div className="flex items-center gap-2 text-red-600 text-sm">
                                <X className="h-4 w-4" />
                                {t('offerDeclined')}
                              </div>
                            ) : deal.prequal ? (
                              // accept_offer refuses an unconverted prequal (the invoice needs a closing
                              // date). Say so up front instead of letting the broker through a modal that
                              // promises an identity reveal + invoice and then fails on the RPC.
                              <div className="rounded-md border border-border bg-muted/40 p-3 text-center">
                                <p className="text-sm text-muted-foreground">{t('acceptNeedsLiveDeal')}</p>
                              </div>
                            ) : (
                              <Button onClick={() => setPendingAcceptId(offer.id)} disabled={busy} className="w-full">
                                {t('acceptOffer')}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Full deal record — the broker sees every field, including the borrower name + property
                address that are deliberately hidden from lenders (anonymity). */}
            {fullDeal && (
              <div className="bg-card border border-border rounded-lg p-6 mb-8">
                <h2 className="text-lg font-semibold text-foreground mb-6">{t('fullDetails')}</h2>
                <DealSection title={t('borrowerSection')}>
                  <DealField label={t('client')} value={deal.clientName} />
                  <DealField label={t('propertyAddress')} value={deal.propertyAddress || '—'} />
                </DealSection>
                <LenderDealDetailSections deal={fullDeal} />
              </div>
            )}
          </>
        )}

        {/* Accept confirmation modal */}
        {pendingAcceptId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-lg p-8 max-w-md w-full shadow-lg">
              <div className="flex items-start gap-4 mb-4">
                <AlertCircle className="h-6 w-6 text-yellow-600 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{t('acceptTitle')}</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    {t('acceptBody')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button onClick={() => setPendingAcceptId(null)} variant="outline" className="flex-1" disabled={busy}>
                  {t('cancel')}
                </Button>
                <Button onClick={doAccept} className="flex-1 gap-2" disabled={busy}>
                  <Check className="h-4 w-4" />
                  {busy ? t('accepting') : t('confirmSelection')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {surveyOpen && pendingSurvey && (
          <SurveyDialog
            survey={pendingSurvey}
            onClose={() => setSurveyOpen(false)}
            onSubmitted={async () => {
              setSurveyOpen(false)
              await load()
              toast.success(t('toastSurvey'))
            }}
          />
        )}
      </main>
    </div>
  )
}
