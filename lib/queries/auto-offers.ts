import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type Enums = Database["public"]["Enums"]
type Row = Database["public"]["Tables"]["auto_offers"]["Row"]

/**
 * Round 3 Phase 3 — a lender's saved "standard offer" (migration 47). It rides on one of the lender's
 * saved filters: when a submitted deal matches that filter in full AND has no notes AND has the
 * "No lender exceptions required" box checked, `send_auto_offers` posts these terms as a real offer.
 *
 * There is deliberately no comments field — offer comments pass the anti-contact trigger, and an
 * auto-offer is inserted inside the BROKER's submit transaction, so stored text could block someone
 * else's submission. Comments can be added afterwards through Edit Offer.
 */
export type AutoOfferInput = {
  name: string
  savedFilterId: string
  mortgageProduct: Enums["mortgage_product"]
  rate: number
  rateLockDays: number
  commissionBps: number
  commitmentTurnTimeDays: number | null
  docReviewTurnTimeDays: number | null
  lenderFeePct: number | null
  isActive: boolean
  /** Optional: stop auto-sending after this date (inclusive). */
  endDate: string | null
  /**
   * Client 2026-07-28 (B-33): only auto-offer when the closing date is at least this many days out.
   * Defaults to 30. A deal with no closing date (a prequal) is not constrained by it.
   */
  minClosingDays: number
}

export type AutoOfferRow = AutoOfferInput & {
  id: string
  sentCount: number
  lastSentAt: string | null
  /** Name of the linked saved filter, for the list row. */
  filterName: string
}

export const EMPTY_AUTO_OFFER: AutoOfferInput = {
  name: "",
  savedFilterId: "",
  mortgageProduct: "5_year_fixed",
  rate: 0,
  rateLockDays: 90,
  commissionBps: 0,
  commitmentTurnTimeDays: null,
  docReviewTurnTimeDays: null,
  lenderFeePct: null,
  isActive: true,
  endDate: null,
  minClosingDays: 30,
}

function rowToInput(r: Row): AutoOfferInput {
  return {
    name: r.name,
    savedFilterId: r.saved_filter_id,
    mortgageProduct: r.mortgage_product,
    rate: Number(r.rate),
    rateLockDays: r.rate_lock_days,
    commissionBps: r.commission_bps,
    commitmentTurnTimeDays: r.commitment_turn_time_days,
    docReviewTurnTimeDays: r.doc_review_turn_time_days,
    lenderFeePct: r.lender_fee_pct === null ? null : Number(r.lender_fee_pct),
    isActive: r.is_active,
    endDate: r.end_date,
    minClosingDays: r.min_closing_days,
  }
}

function inputToColumns(input: AutoOfferInput) {
  return {
    name: input.name.trim(),
    saved_filter_id: input.savedFilterId,
    mortgage_product: input.mortgageProduct,
    rate: input.rate,
    rate_lock_days: input.rateLockDays,
    commission_bps: input.commissionBps,
    commitment_turn_time_days: input.commitmentTurnTimeDays,
    doc_review_turn_time_days: input.docReviewTurnTimeDays,
    lender_fee_pct: input.lenderFeePct,
    is_active: input.isActive,
    end_date: input.endDate,
    min_closing_days: input.minClosingDays,
  }
}

/** The current lender's auto-offers (RLS: auto_offers_owner), newest last. */
export async function listAutoOffers(supabase: DB): Promise<AutoOfferRow[]> {
  const { data, error } = await supabase
    .from("auto_offers")
    .select("*, saved_filters!auto_offers_saved_filter_id_fkey(name)")
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const f = Array.isArray(r.saved_filters) ? r.saved_filters[0] : r.saved_filters
    return {
      id: r.id,
      ...rowToInput(r),
      sentCount: r.sent_count,
      lastSentAt: r.last_sent_at,
      filterName: f?.name ?? "—",
    }
  })
}

export async function createAutoOffer(supabase: DB, input: AutoOfferInput) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error("You must be signed in.")
  const { error } = await supabase
    .from("auto_offers")
    .insert({ ...inputToColumns(input), lender_id: user.id })
  if (error) throw new Error(error.message)
}

export async function updateAutoOffer(supabase: DB, id: string, input: AutoOfferInput) {
  const { error } = await supabase.from("auto_offers").update(inputToColumns(input)).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function setAutoOfferActive(supabase: DB, id: string, isActive: boolean) {
  const { error } = await supabase.from("auto_offers").update({ is_active: isActive }).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function deleteAutoOffer(supabase: DB, id: string) {
  const { error } = await supabase.from("auto_offers").delete().eq("id", id)
  if (error) throw new Error(error.message)
}

/**
 * The lender-level MASTER switch (E-11, migration 64) and how many auto-offers are currently able to
 * send. Distinct from `setAutoOfferActive`, which pauses ONE saved offer: master off stops everything
 * without touching — or forgetting — the per-offer pause state.
 *
 * `activeCount` counts rows that would fire if the master were on (active, and not past their end
 * date), so the strip can say "2 active" rather than just "on".
 */
export type AutoOfferStatus = { enabled: boolean; activeCount: number }

export async function getAutoOfferStatus(supabase: DB): Promise<AutoOfferStatus> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { enabled: false, activeCount: 0 }

  const today = new Date().toISOString().slice(0, 10)
  const [{ data: profile, error: pErr }, { count, error: cErr }] = await Promise.all([
    supabase.from("profiles").select("auto_offers_enabled").eq("id", user.id).single(),
    supabase
      .from("auto_offers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .or(`end_date.is.null,end_date.gte.${today}`),
  ])
  if (pErr) throw new Error(pErr.message)
  if (cErr) throw new Error(cErr.message)
  return { enabled: profile?.auto_offers_enabled ?? true, activeCount: count ?? 0 }
}

export async function setAutoOffersEnabled(supabase: DB, enabled: boolean) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const { error } = await supabase
    .from("profiles")
    .update({ auto_offers_enabled: enabled })
    .eq("id", user.id)
  if (error) throw new Error(error.message)
}
