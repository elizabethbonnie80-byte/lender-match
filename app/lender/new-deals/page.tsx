'use client'

import Link from 'next/link'
import { LenderHeader } from '@/components/lender-header'
import { listOpenDealsForLender, listOpenDealsFiltered, type LenderDealListItem } from '@/lib/queries/deals'
import { useLenderDealFeed, FEED_ITEMS_PER_PAGE } from '@/hooks/use-lender-deal-feed'
import { isNewDeal } from '@/lib/age-windows'
import { MakeOfferDialog } from '@/components/make-offer-dialog'
import { DealFiltersSidepanel } from '@/components/deal-filters-sidepanel'
import { LenderDealDetailSections } from '@/components/lender-deal-sections'
import { FieldError } from '@/components/field-error'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  Bell,
  MessageSquare,
  Tag,
  XCircle,
  X,
  CheckCircle,
  Plus,
  Star,
  ChevronLeft,
  ChevronRight,
  Building2,
  Loader2,
  AlertCircle,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = FEED_ITEMS_PER_PAGE

/** Client 2026-07-23 (A-7): the "N deals total · sorted by …" line is hidden for now, may come back. */
const SHOW_DEAL_COUNT = false
/** Client 2026-07-25 (B-11): "please hide this too … We may want it showing at some point but not now". */
const SHOW_NEW_THIS_WEEK = false

// New Deals floats COF-specified deals to the top, then sorts by soonest closing date. Defined at
// module scope so its reference is stable (the feed hook memoizes on it). Copies before sorting so it
// never mutates the hook's `deals` state array.
function sortByClosing(deals: LenderDealListItem[]): LenderDealListItem[] {
  return [...deals].sort((a, b) => {
    if (a.cofDate !== null && b.cofDate === null) return -1
    if (a.cofDate === null && b.cofDate !== null) return 1
    const ac = a.closingDate ? new Date(a.closingDate).getTime() : Infinity
    const bc = b.closingDate ? new Date(b.closingDate).getTime() : Infinity
    return ac - bc
  })
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewDealsPage() {
  const t = useT('newDeals')

  // All feed state/effects/handlers live in the shared hook (see Maturing Deals). New Deals sorts the
  // list client-side and adds the "new this week" badge; it doesn't score, so no refetch on save.
  const {
    loading, loadError, visibleDeals, paginated: paginatedDeals,
    searchTerm, setSearchTerm, showFilters, setShowFilters,
    filters, activeFilterCount, applyFilters, clearFilters, handleSaveFilter,
    dbFilters, activeFilterId, toggleSavedFilter,
    selectedIds, setSelectedIds, toggleSelect, toggleSelectAll,
    pendingDeals, allSelected, someSelected, bulkSelected, lenderStatus,
    currentPage, setCurrentPage, totalPages, startIndex,
    offerTarget, setOfferTarget, handleMakeOffer, onOfferSent, offerPrefillProduct,
    declineTarget, setDeclineTarget, confirmDecline,
    messageTarget, setMessageTarget, messageText, setMessageText,
    messageSending, messageShowError, setMessageShowError, sendMessage,
    messageBlockReason, setMessageBlockReason,
    openMessage, feedback,
  } = useLenderDealFeed<LenderDealListItem>({
    t,
    fetchAll: listOpenDealsForLender,
    fetchFiltered: listOpenDealsFiltered,
    sort: sortByClosing,
  })

  const newThisWeekCount = visibleDeals.filter((d) => isNewDeal(d.submittedAt)).length

  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">{t('title')}</h1>
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

          {/* Select-all row (page-scoped bulk selection) */}
          {pendingDeals.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleSelectAll}
                id="select-all-page"
              />
              <label htmlFor="select-all-page" className="text-sm font-medium text-foreground cursor-pointer select-none">
                {t('selectAllOnPage')}
              </label>
            </div>
          )}
        </div>

        {/* Feedback toast */}
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

        {/* Stats bar */}
        <div className="flex items-center justify-between mb-3">
          {/* Client 2026-07-23 (A-7): "can you please hide this for now? We may reinstate it later" —
              hidden behind a flag rather than deleted, so bringing it back is a one-word change. */}
          {SHOW_DEAL_COUNT && (
            <p className="text-sm text-muted-foreground">
              {activeFilterCount > 0 || searchTerm
                ? t('statsMatching', { count: visibleDeals.length })
                : t('statsTotal', { count: visibleDeals.length })}
            </p>
          )}
          {SHOW_NEW_THIS_WEEK && newThisWeekCount > 0 && (
            <Badge className="text-xs bg-primary text-primary-foreground">
              {t('newThisWeek', { count: newThisWeekCount })}
            </Badge>
          )}
        </div>

        {/* Deal cards */}
        {loading ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('loadingDeals')}</p>
          </div>
        ) : loadError ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('loadErrorTitle')}</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </div>
        ) : visibleDeals.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('noDealsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('noDealsHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedDeals.map((deal) => {
              const status = lenderStatus[deal.id] ?? 'pending'
              const isPending = status === 'pending'
              const isChecked = selectedIds.has(deal.id)
              const dealIsNew = isNewDeal(deal.submittedAt)

              return (
                <div
                  key={deal.id}
                  className={`bg-card border border-border rounded-lg overflow-hidden transition-opacity ${
                    status === 'declined' ? 'opacity-40' : ''
                  }`}
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-3 px-6 py-4 bg-muted border-b border-border flex-wrap">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isChecked}
                        disabled={!isPending}
                        onCheckedChange={() => toggleSelect(deal.id)}
                      />
                      {dealIsNew && (
                        <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                          {t('new')}
                        </span>
                      )}
                      {deal.cofDate !== null && !dealIsNew && (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                          COF
                        </span>
                      )}
                      {/* Round 3 Phase 3: a prequal has no address/closing date yet */}
                      {deal.prequal && (
                        <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">
                          {t('prequal')}
                        </span>
                      )}
                      <span className="font-bold text-foreground">{deal.dealNumber}</span>
                    </div>

                    {status === 'offer-sent' ? (
                      <span className="flex items-center gap-1 text-xs text-green-700 font-medium whitespace-nowrap">
                        <CheckCircle className="h-3.5 w-3.5" /> {t('offerSent')}
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
                          {t('messagesBtn')}
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

                  {/* Card body — property / deal / qualifying information */}
                  <div className="p-6">
                    <LenderDealDetailSections deal={deal} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination footer */}
        {visibleDeals.length > 0 && (
          <div className="bg-card border border-border rounded-lg mt-4 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              {t('showing', { from: startIndex + 1, to: Math.min(startIndex + ITEMS_PER_PAGE, visibleDeals.length), total: visibleDeals.length })}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
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
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

      </main>

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

      {/* ── Message modal ── */}
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

      {/* Make Offer dialog (shared component: form + anti-contact + make_offer) */}
      <MakeOfferDialog dealIds={offerTarget} prefillProduct={offerPrefillProduct} onClose={() => setOfferTarget(null)} onSuccess={onOfferSent} />

      {/* Filters sidepanel — full-criteria (province → the 20 "Others" checkboxes), matching the
          client's reference Bubble panel. */}
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
