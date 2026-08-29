'use client'

import type { KeyboardEvent } from 'react'
import Link from 'next/link'
import { LenderHeader } from '@/components/lender-header'
import { listMaturingDeals, listMaturingDealsFiltered, type MaturingDealListItem, type MaturingMatch } from '@/lib/queries/deals'
import { useLenderDealFeed, FEED_ITEMS_PER_PAGE } from '@/hooks/use-lender-deal-feed'
import { MakeOfferDialog } from '@/components/make-offer-dialog'
import { DealFiltersSidepanel } from '@/components/deal-filters-sidepanel'
import { LenderDealDetailSections } from '@/components/lender-deal-sections'
import { FieldError } from '@/components/field-error'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
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
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Tag,
  XCircle,
  Building2,
  X,
  Bell,
  Star,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = FEED_ITEMS_PER_PAGE

// ─── Helpers (maturing-only card styling) ──────────────────────────────────────

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 0
  const target = new Date(dateStr + 'T12:00:00').getTime()
  const today = new Date().setHours(12, 0, 0, 0)
  return Math.ceil((target - today) / 86400000)
}

/** Match-tint for the card HEADER only (not the whole card body). */
function cardStyle(match: MaturingMatch): string {
  if (!match) return 'bg-muted'
  if (match.pct >= 90) return 'bg-yellow-100'
  if (match.pct >= 80) return 'bg-orange-100'
  return 'bg-red-100'
}

function matchBadge(pct: number): string {
  if (pct >= 90) return 'bg-yellow-300 text-yellow-900'
  if (pct >= 80) return 'bg-orange-300 text-orange-900'
  return 'bg-red-300 text-red-900'
}

function closingStyle(days: number): string {
  if (days <= 5) return 'text-red-700 font-bold'
  if (days <= 10) return 'text-orange-600 font-semibold'
  return 'text-amber-600 font-medium'
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MaturingDealsPage() {
  const t = useT('maturingDeals')
  const tc = useT('common')

  // All feed state/effects/handlers live in the shared hook (see New Deals). Maturing keeps the server
  // order (no client sort) and adds the match-% legend/badge below.
  const {
    deals, loading, loadError, visibleDeals, paginated,
    searchTerm, setSearchTerm, showFilters, setShowFilters,
    filters, activeFilterCount, applyFilters, clearFilters, handleSaveFilter,
    dbFilters, activeFilterId, toggleSavedFilter,
    selectedIds, setSelectedIds, toggleSelect, toggleSelectAll,
    pendingDeals, allSelected, someSelected, bulkSelected, lenderStatus,
    collapsedIds, toggleCollapsed,
    currentPage, setCurrentPage, totalPages, startIndex,
    offerTarget, setOfferTarget, handleMakeOffer, onOfferSent, offerPrefillProduct, offerOverrideBps, offerBpsConsistent,
    declineTarget, setDeclineTarget, confirmDecline,
    messageTarget, setMessageTarget, messageText, setMessageText,
    messageSending, messageShowError, setMessageShowError, sendMessage,
    messageBlockReason, setMessageBlockReason,
    openMessage, feedback,
  } = useLenderDealFeed<MaturingDealListItem>({
    t,
    fetchAll: listMaturingDeals,
    fetchFiltered: listMaturingDealsFiltered,
    refetchOnSaveFilter: true, // saving a filter changes match-% scoring → reflect it
  })

  // Match-band tallies for the color legend (maturing-only; over the full server-scoped feed).
  const yellowCount = deals.filter((d) => d.match && d.match.pct >= 90).length
  const orangeCount = deals.filter((d) => d.match && d.match.pct >= 80 && d.match.pct < 90).length
  const redCount = deals.filter((d) => d.match && d.match.pct >= 70 && d.match.pct < 80).length

  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>

        {/* Color legend */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {t('legendTitle')}
          </p>
          <div className="flex flex-wrap gap-4">
            {[
              { bg: 'bg-yellow-100', badge: 'bg-yellow-300 text-yellow-900', label: t('legend90'), count: yellowCount, desc: t('desc90') },
              { bg: 'bg-orange-100', badge: 'bg-orange-300 text-orange-900', label: t('legend80'), count: orangeCount, desc: t('desc80') },
              { bg: 'bg-red-100', badge: 'bg-red-300 text-red-900', label: t('legend70'), count: redCount, desc: t('desc70') },
              { bg: 'bg-card', badge: 'bg-muted text-muted-foreground', label: t('legendLow'), count: deals.length - yellowCount - orangeCount - redCount, desc: t('descLow') },
            ].map(({ bg, badge, label, count, desc }) => (
              <div key={label} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border ${bg}`}>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${badge}`}>{label}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-900">{t('dealsCount', { count })}</p>
                  <p className="text-xs text-gray-600">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Client-supplied notice (2026-07-25, B-38): "somewhere that's visible upon loading the page
            but not super conspicuous" */}
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t('feedDisclaimer')}</p>

        {/* Search + filter bar */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              className="gap-2 shrink-0"
              onClick={() => setShowFilters((s) => !s)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t('filters')}
              {activeFilterCount > 0 && (
                <span className="bg-primary-foreground text-primary text-xs font-bold rounded-full px-1.5 py-0 leading-4">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground shrink-0">
                <X className="h-4 w-4 mr-1" /> {t('clear')}
              </Button>
            )}
          </div>

          {/* Saved filters row — the lender's real DB filters (created/edited in Settings). Clicking
              one narrows the feed server-side; clicking the active one clears it. */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap shrink-0">
              <Star className="h-3.5 w-3.5" /> {t('saved')}
            </span>

            {dbFilters.map((sf) => (
              <button
                key={sf.id}
                onClick={() => toggleSavedFilter(sf.id)}
                title={sf.criteriaPreview}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border shrink-0 ${
                  activeFilterId === sf.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:border-primary hover:text-primary'
                }`}
              >
                <Bell className="h-3 w-3" />
                {sf.name}
                {activeFilterId === sf.id && <X className="h-3 w-3" />}
              </button>
            ))}

            {dbFilters.length === 0 && (
              <span className="text-xs text-muted-foreground italic">{t('noSavedFilters')}</span>
            )}

            <Link
              href="/lender/settings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors shrink-0"
            >
              <Plus className="h-3 w-3" />
              {t('manageInSettings')}
            </Link>
          </div>

          {/* Select-all row (bulk selection) */}
          {pendingDeals.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleSelectAll}
                id="select-all-maturing"
              />
              <label htmlFor="select-all-maturing" className="text-sm font-medium text-foreground cursor-pointer select-none">
                {t('selectAllOnPage')}
              </label>
            </div>
          )}
        </div>

        {/* Feedback */}
        {feedback && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4">
            <CheckCircle className="h-4 w-4 shrink-0" />
            {feedback}
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 mb-4">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size === 1
                ? t('selectedOne', { count: selectedIds.size })
                : t('selectedMany', { count: selectedIds.size })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => handleMakeOffer(bulkSelected)}>
                {t('makeOfferN', { count: selectedIds.size })}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDeclineTarget(bulkSelected)}>
                {t('declineN', { count: selectedIds.size })}
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setMessageTarget(bulkSelected); setMessageText('') }}>
                <MessageSquare className="h-4 w-4" />
                {t('messageN', { count: selectedIds.size })}
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
                {t('clear')}
              </Button>
            </div>
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted-foreground">
            {activeFilterCount > 0 || searchTerm
              ? t('statsMatching', { count: visibleDeals.length })
              : t('statsTotal', { count: visibleDeals.length })}
          </p>
        </div>

        {/* Deal cards */}
        {loading ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">{t('loadingDeals')}</p>
          </div>
        ) : loadError ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('loadErrorTitle')}</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('noDealsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('noDealsHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {paginated.map((deal) => {
              const status = lenderStatus[deal.id] ?? 'pending'
              const isActioned = status !== 'pending'
              const isChecked = selectedIds.has(deal.id)
              const days = daysUntil(deal.closingDate)
              // E-4: only an offer-sent card folds — the pending one is the deal being read.
              const canCollapse = status === 'offer-sent'
              const isCollapsed = canCollapse && collapsedIds.has(deal.id)

              return (
                <div
                  key={deal.id}
                  className={`bg-card border border-border rounded-lg overflow-hidden transition-opacity ${
                    isActioned ? 'opacity-40' : ''
                  }`}
                >
                  {/* Card header — match color lives here only, not on the whole card.
                      Doubles as the expand/collapse control once an offer is sent (E-4). */}
                  <div
                    className={`flex items-center justify-between gap-3 px-6 py-4 flex-wrap ${
                      isCollapsed ? '' : 'border-b border-border'
                    } ${isActioned ? 'bg-muted' : cardStyle(deal.match)} ${
                      canCollapse ? 'cursor-pointer select-none' : ''
                    }`}
                    {...(canCollapse
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-expanded': !isCollapsed,
                          onClick: () => toggleCollapsed(deal.id),
                          onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleCollapsed(deal.id)
                            }
                          },
                        }
                      : {})}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <Checkbox
                        checked={isChecked}
                        disabled={isActioned}
                        onCheckedChange={() => toggleSelect(deal.id)}
                      />
                      {deal.cofDate !== null && (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                          COF
                        </span>
                      )}
                      {/* Round 3 Phase 3: a prequal has no address/closing date yet (same badge as New Deals) */}
                      {deal.prequal && (
                        <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">
                          {t('prequal')}
                        </span>
                      )}
                      <span className="font-bold text-foreground">{deal.dealNumber}</span>
                      <span className={`text-xs flex items-center gap-1 ${closingStyle(days)}`}>
                        {days <= 5 && <AlertTriangle className="h-3 w-3" />}
                        {days <= 5 ? t('urgent', { days }) : t('daysLeft', { days })}
                      </span>
                      {deal.match && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${matchBadge(deal.match.pct)}`}>
                          {deal.match.pct}% &ldquo;{deal.match.filterName}&rdquo;
                        </span>
                      )}
                    </div>

                    {status === 'offer-sent' ? (
                      <span className="flex items-center gap-1 text-xs text-green-700 font-medium whitespace-nowrap">
                        <CheckCircle className="h-3.5 w-3.5" /> {t('offerSent')}
                        {isCollapsed ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronUp className="h-4 w-4" />
                        )}
                      </span>
                    ) : status === 'declined' ? (
                      <span className="text-xs text-muted-foreground">{t('declined')}</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => openMessage(deal.id)}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {t('messageBroker')}
                        </Button>
                        <Button size="sm" className="gap-1.5" onClick={() => handleMakeOffer([deal.id])}>
                          <Tag className="h-3.5 w-3.5" />
                          {t('makeOffer')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setDeclineTarget([deal.id])}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('decline')}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Missing-criteria hint (only when partially matched) */}
                  {!isCollapsed && deal.match && deal.match.missing.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 bg-muted/40 border-b border-border">
                      {deal.match.missing.map((m) => (
                        <span key={m} className="text-[11px] text-gray-600 flex items-center gap-1">
                          <X className="h-2.5 w-2.5 text-gray-500 shrink-0" />
                          {m}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card body — property / deal / qualifying information */}
                  {!isCollapsed && (
                    <div className="p-6">
                      <LenderDealDetailSections deal={deal} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {visibleDeals.length > 0 && (
          <div className="bg-card border border-border rounded-lg mt-4 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              {t('showing', { from: startIndex + 1, to: Math.min(startIndex + ITEMS_PER_PAGE, visibleDeals.length), total: visibleDeals.length })}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> {tc('previous')}
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="min-w-10"
                    >
                      {page}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  {tc('next')} <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4 text-center">
          {t('privacyNotice')}
        </p>
      </main>

      {/* ── Make Offer (shared component: form + anti-contact + make_offer) ── */}
      <MakeOfferDialog dealIds={offerTarget} prefillProduct={offerPrefillProduct} overrideBps={offerOverrideBps} bpsConsistent={offerBpsConsistent} onClose={() => setOfferTarget(null)} onSuccess={onOfferSent} />

      {/* ── Decline confirmation ── */}
      <AlertDialog open={!!declineTarget} onOpenChange={() => setDeclineTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {declineTarget && declineTarget.length > 1
                ? t('declineTitleMany', { count: declineTarget.length })
                : t('declineTitleOne')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('declineDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDecline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('confirmDecline')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Message broker ── */}
      <AlertDialog open={!!messageTarget} onOpenChange={() => { setMessageTarget(null); setMessageShowError(false); setMessageBlockReason(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messageTarget && messageTarget.length > 1
                ? t('messageTitleMany', { count: messageTarget.length })
                : t('messageTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('messageDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-4">
            <Textarea
              placeholder={t('messagePlaceholder')}
              value={messageText}
              onChange={(e) => { setMessageText(e.target.value); if (messageShowError) setMessageShowError(false); if (messageBlockReason) setMessageBlockReason(null) }}
              aria-invalid={messageShowError && !messageText.trim()}
              rows={4}
              className="resize-none bg-muted/50"
            />
            <div className="flex items-center justify-between mt-1">
              <FieldError show={messageShowError && !messageText.trim()} />
              <p className="text-xs text-muted-foreground text-right ml-auto">{t('charCount', { n: messageText.length })}</p>
            </div>
            {/* Why the send was refused. Has to live in the dialog: it stays open on a block, so a
                page-level banner would sit behind the overlay. */}
            {messageBlockReason && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{messageBlockReason}</p>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setMessageText(''); setMessageShowError(false); setMessageBlockReason(null) }}>{t('cancel')}</AlertDialogCancel>
            <Button onClick={sendMessage} disabled={messageSending} className={`gap-1.5 ${!messageText.trim() ? 'opacity-50' : ''}`}>
              {messageSending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('send')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Filters sidepanel — same full-criteria panel as New Deals */}
      <DealFiltersSidepanel
        open={showFilters}
        onOpenChange={setShowFilters}
        filters={filters}
        onApply={applyFilters}
        onSave={handleSaveFilter}
      />
    </div>
  )
}
