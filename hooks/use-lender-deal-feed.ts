'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/client'
import { type OpenDealFilters } from '@/lib/queries/deals'
import {
  EMPTY_FILTER_CRITERIA,
  countActiveFilters,
  createSavedFilter,
  listSavedFilters,
  type SavedFilterInput,
  type SavedFilterRow,
} from '@/lib/queries/saved-filters'
import { declineDeal } from '@/lib/queries/offers'
import { sendMessage as sendDealMessage, listThreads } from '@/lib/queries/messages'
import { scanContact } from '@/lib/queries/anti-contact'
import { useEnums } from '@/lib/use-enums'

type DB = SupabaseClient<Database>
type Enums = Database['public']['Enums']

const EMPTY_FILTERS: OpenDealFilters = { ...EMPTY_FILTER_CRITERIA }
export const FEED_ITEMS_PER_PAGE = 10

/** Per-deal lender action state shown in the feeds. */
export type LenderAction = 'pending' | 'offer-sent' | 'declined'

/** The deal fields the shared feed logic touches (selection, status, free-text search). Both
 *  LenderDealListItem and MaturingDealListItem satisfy this. */
export type FeedDeal = {
  id: string
  dealNumber: string
  city: string | null
  province: Enums['province'] | null
  dwellingType: Enums['dwelling_type'] | null
  mortgageProduct: Enums['mortgage_product'] | null
  // Round 3 Phase 3: no address/closing date yet — the card carries a PREQUAL badge.
  prequal?: boolean
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * All the shared state, effects, and handlers behind the two lender deal feeds (New Deals + Maturing).
 * The two pages were copy-pasted line-for-line here; they now differ only in their card rendering and a
 * couple of page-specific extras (the "new this week" badge / the match-% legend + badge). Pass the
 * page's `t` (namespace-bound — the toast keys are identical across both namespaces), the two feed
 * queries (their signatures match: `(supabase, filterId)` and `(supabase, filters)`), and an optional
 * client-side `sort` (New Deals floats COF + sorts by closing date; Maturing keeps server order).
 */
export function useLenderDealFeed<T extends FeedDeal>(config: {
  t: Translate
  fetchAll: (supabase: DB, filterId: string | null) => Promise<T[]>
  fetchFiltered: (supabase: DB, filters: OpenDealFilters) => Promise<T[]>
  sort?: (deals: T[]) => T[]
  // Maturing re-fetches after saving a filter because saved filters drive its match-% scoring; New
  // Deals doesn't score, so it skips the refetch. Defaults to off.
  refetchOnSaveFilter?: boolean
}) {
  const { t, fetchAll, fetchFiltered, sort, refetchOnSaveFilter } = config
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { LABELS } = useEnums()

  // deal → existing chat thread (this lender). When a deal already has a thread, the "Message" button
  // routes to that conversation in the inbox instead of re-opening the compose dialog.
  const [threadByDeal, setThreadByDeal] = useState<Map<string, string>>(new Map())
  const refreshThreadMap = useMemo(
    () => () =>
      listThreads(supabase)
        .then((ts) => setThreadByDeal(new Map(ts.map((th) => [th.dealId, th.chatId]))))
        .catch((e) => console.warn('lender-feed: refreshThreadMap failed', e)),
    [supabase],
  )
  useEffect(() => {
    void refreshThreadMap()
  }, [refreshThreadMap])

  const [deals, setDeals] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<OpenDealFilters>(EMPTY_FILTERS)
  const [currentPage, setCurrentPage] = useState(1)
  const [lenderStatus, setLenderStatus] = useState<Record<string, LenderAction>>({})

  // The lender's real saved filters (DB — same ones used by Settings). Clicking a chip narrows the feed
  // server-side via fetchAll(filterId); creation/editing lives in Settings.
  const [dbFilters, setDbFilters] = useState<SavedFilterRow[]>([])
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null)

  // Row selection (bulk actions)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Dialogs
  const [offerTarget, setOfferTarget] = useState<string[] | null>(null)
  const [declineTarget, setDeclineTarget] = useState<string[] | null>(null)
  const [messageTarget, setMessageTarget] = useState<string[] | null>(null)
  const [messageText, setMessageText] = useState('')
  const [messageSending, setMessageSending] = useState(false)
  const [messageShowError, setMessageShowError] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    listSavedFilters(supabase)
      .then(setDbFilters)
      .catch(() => setDbFilters([]))
  }, [supabase])

  // Fetch the feed SERVER-SIDE: the ad-hoc Filters panel (fetchFiltered) takes precedence; otherwise a
  // saved-filter chip (fetchAll). They're mutually exclusive (selecting one clears the other) so exactly
  // one query path runs. Debounced so typing in the range inputs doesn't refetch on every keystroke.
  useEffect(() => {
    let active = true
    setLoading(true)
    const adHocActive = countActiveFilters(filters) > 0
    const timer = setTimeout(() => {
      const p = adHocActive ? fetchFiltered(supabase, filters) : fetchAll(supabase, activeFilterId)
      p.then((rows) => { if (active) setDeals(rows) })
        .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('loadError')) })
        .finally(() => { if (active) setLoading(false) })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, filters, activeFilterId, t])

  const flash = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 3500)
  }

  // ── Derived ──

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])

  // Free-text search stays client-side (enum/range filtering is server-side). New Deals also sorts.
  const visibleDeals = useMemo(() => {
    const q = searchTerm.toLowerCase()
    const filtered = !q
      ? deals
      : deals.filter((d) => {
          const provinceLabel = d.province ? LABELS.province[d.province] ?? '' : ''
          const dwellingLabel = d.dwellingType ? LABELS.dwelling_type[d.dwellingType] ?? '' : ''
          return (
            d.dealNumber.toLowerCase().includes(q) ||
            (d.city ?? '').toLowerCase().includes(q) ||
            provinceLabel.toLowerCase().includes(q) ||
            dwellingLabel.toLowerCase().includes(q)
          )
        })
    return sort ? sort(filtered) : filtered
  }, [deals, searchTerm, LABELS, sort])

  useMemo(() => { setCurrentPage(1) }, [searchTerm, filters])

  const totalPages = Math.ceil(visibleDeals.length / FEED_ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * FEED_ITEMS_PER_PAGE
  const paginated = visibleDeals.slice(startIndex, startIndex + FEED_ITEMS_PER_PAGE)

  // "Select all" is scoped to THIS PAGE only (individual row checkboxes only render for `paginated`).
  const pendingDeals = paginated.filter((d) => (lenderStatus[d.id] ?? 'pending') === 'pending')
  const allSelected = pendingDeals.length > 0 && pendingDeals.every((d) => selectedIds.has(d.id))
  const someSelected = !allSelected && pendingDeals.some((d) => selectedIds.has(d.id))

  // ── Handlers ──

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Only adds/removes this page's pending ids, so selections made on other pages survive.
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected || someSelected) {
        pendingDeals.forEach((d) => next.delete(d.id))
      } else {
        pendingDeals.forEach((d) => next.add(d.id))
      }
      return next
    })
  }

  const applyLenderStatus = (ids: string[], status: LenderAction) => {
    setLenderStatus((prev) => {
      const next = { ...prev }
      ids.forEach((id) => { next[id] = status })
      return next
    })
    setSelectedIds(new Set())
  }

  const handleMakeOffer = (ids: string[]) => {
    if (ids.length === 0) return
    setOfferTarget(ids)
  }

  // Called by <MakeOfferDialog> after make_offer succeeds for every target deal.
  const onOfferSent = (ids: string[], message: string) => {
    applyLenderStatus(ids, 'offer-sent')
    flash(message)
    setOfferTarget(null)
  }

  // Real decline: persist to deal_declines (RLS then hides the deal across all feeds) and drop it here.
  const confirmDecline = async () => {
    if (!declineTarget) return
    const ids = declineTarget
    setDeclineTarget(null)
    try {
      for (const id of ids) await declineDeal(supabase, id)
      setDeals((prev) => prev.filter((d) => !ids.includes(d.id)))
      setSelectedIds(new Set())
      flash(t('declinedToast', { count: ids.length }))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('declineErr'))
    }
  }

  // The card "Message" button: jump straight to an existing conversation, or open the compose dialog.
  const openMessage = (dealId: string) => {
    const chatId = threadByDeal.get(dealId)
    if (chatId) {
      router.push(`/lender/messages?chat=${chatId}`)
      return
    }
    setMessageTarget([dealId])
    setMessageText('')
    setMessageShowError(false)
  }

  const sendMessage = async () => {
    if (!messageTarget || messageSending) return
    const text = messageText.trim()
    if (!text) {
      setMessageShowError(true)
      return
    }
    setMessageSending(true)
    try {
      const reason = await scanContact(supabase, text, 'chat_message', messageTarget[0])
      if (reason) {
        flash(t('contactBlocked', { reason }))
        return
      }
      for (const dealId of messageTarget) {
        await sendDealMessage(supabase, { dealId, content: text })
      }
      flash(t('messageSent', { count: messageTarget.length }))
      setMessageTarget(null)
      setMessageText('')
      void refreshThreadMap() // now these deals route to their conversation
    } catch (err) {
      flash(err instanceof Error ? err.message : t('messageErr'))
    } finally {
      setMessageSending(false)
    }
  }

  // A saved-filter chip and the ad-hoc Filters panel are mutually exclusive (both narrow the feed
  // server-side); selecting one clears the other so exactly one query path runs.
  const toggleSavedFilter = (id: string) => {
    setActiveFilterId((cur) => (cur === id ? null : id))
    setFilters(EMPTY_FILTERS)
  }

  const applyFilters = (f: OpenDealFilters) => {
    setFilters(f)
    setActiveFilterId(null)
  }
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  // "Save Filter" from the sidepanel persists a reusable saved filter (also shows in Settings) and
  // starts counting toward match-% scoring, so refetch to reflect it.
  const handleSaveFilter = async (input: SavedFilterInput) => {
    try {
      await createSavedFilter(supabase, input)
      setDbFilters(await listSavedFilters(supabase))
      flash(t('saveFilterToast', { name: input.name }))
      if (refetchOnSaveFilter) {
        const adHocActive = countActiveFilters(filters) > 0
        ;(adHocActive ? fetchFiltered(supabase, filters) : fetchAll(supabase, activeFilterId))
          .then(setDeals)
          .catch(() => {})
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : t('saveFilterErr'))
    }
  }

  const bulkSelected = Array.from(selectedIds)

  // Round 3 offer prefill: when the Make Offer dialog targets a single deal, seed the offer's
  // product from that deal (the remembered last response fills the rest; comments always cleared).
  const offerPrefillProduct =
    offerTarget?.length === 1
      ? deals.find((d) => d.id === offerTarget[0])?.mortgageProduct ?? null
      : null

  return {
    // data
    deals, loading, loadError, visibleDeals, paginated,
    // search + filters
    searchTerm, setSearchTerm, showFilters, setShowFilters,
    filters, activeFilterCount, applyFilters, clearFilters, handleSaveFilter,
    dbFilters, activeFilterId, toggleSavedFilter,
    // selection
    selectedIds, setSelectedIds, toggleSelect, toggleSelectAll,
    pendingDeals, allSelected, someSelected, bulkSelected,
    lenderStatus,
    // pagination
    currentPage, setCurrentPage, totalPages, startIndex,
    // dialogs + actions
    offerTarget, setOfferTarget, handleMakeOffer, onOfferSent, offerPrefillProduct,
    declineTarget, setDeclineTarget, confirmDecline,
    messageTarget, setMessageTarget, messageText, setMessageText,
    messageSending, messageShowError, setMessageShowError, sendMessage,
    openMessage, threadByDeal,
    // misc
    feedback,
  }
}
