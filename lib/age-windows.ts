/**
 * Client-side deal age-window helpers.
 *
 * The AUTHORITATIVE partitioning of deals into New / Maturing / Expired lives in the SQL feed
 * functions (maturing_deals_for_lender uses a 2-day New→Maturing boundary and a 15-day
 * Maturing→Expired boundary — Round 3, migration 37). The New Deals page receives every open deal
 * from open_deals_for_lender and highlights the recently-submitted ones client-side, so it needs the
 * same New boundary in TS. Keep this in sync with the SQL — it can't be imported from Postgres.
 * Define it ONCE here; never inline a raw day-count or (worse) an absolute calendar date at a call site.
 *
 * Round 3 (approved 2026-07-13, supersedes OQ#18): New = 0–1 days / Maturing = 2–14 days / Expired = 15+.
 */
export const NEW_DEAL_MAX_AGE_DAYS = 2

/**
 * How long a deal stays on the lender queues. A live deal simply expires at this age
 * (job_expire_old_deals); a PREQUAL does not — it leaves the lender side but stays active in the
 * broker's Deal Room until they delete it (client 2026-07-27), which lender_can_see_deal enforces off
 * `created_at`. Mirrors the 15-day boundary in migrations 04/37/52.
 */
export const LENDER_QUEUE_MAX_AGE_DAYS = 15

/** Whole days elapsed between `iso` and now (floored, so "today" = 0). */
export function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** A deal is "new" while it is younger than the New→Maturing boundary (rolling, not a fixed date). */
export function isNewDeal(submittedAt: string): boolean {
  return ageInDays(submittedAt) < NEW_DEAL_MAX_AGE_DAYS
}

/** Whether a deal has aged out of the lender queues. Only meaningful for a prequal, which survives it. */
export function isLenderQueueClosed(submittedAt: string): boolean {
  return ageInDays(submittedAt) >= LENDER_QUEUE_MAX_AGE_DAYS
}

/**
 * Broker-facing status wording (Round 4, approved 2026-08-30) for a deal still in `submitted` /
 * `offer_received` — draft/accepted/confirmed/funded/expired/cancelled keep their existing labels,
 * decided by the caller before calling this. Deliberately reuses NEW_DEAL_MAX_AGE_DAYS / isNewDeal —
 * the SAME 2-day boundary the lender-side Maturing Deals feed uses off `deals.created_at` — but adds
 * a genuinely separate condition (zero CURRENTLY PENDING offers) that lender Maturing Deals does NOT
 * require: that feed is a per-lender relevance window (it only hides a deal once THIS lender's own
 * institution has offered), not a deal-wide "nobody has offered" signal. Reusing the age constant
 * while keeping the offer condition separate avoids inventing a second competing definition of
 * "maturing" for the two audiences, which mean genuinely different things.
 *
 * `pendingOffersCount` must be the count of offers with status = 'pending' specifically — NOT
 * deals.status (which flips to 'offer_received' permanently on the first offer and never reverts,
 * including after a withdrawal) and NOT a raw count(*) of the offers table (which still includes
 * withdrawn rows, since withdrawal is a retained status, not a delete). A deal whose only offer was
 * later withdrawn must read as "live"/"live_maturing" again, not "offer(s)_received".
 */
export type BrokerLiveStatusKey = "live" | "live_maturing" | "offer_received" | "offers_received"

export function brokerLiveStatusKey(createdAt: string, pendingOffersCount: number): BrokerLiveStatusKey {
  if (pendingOffersCount === 0) {
    return isNewDeal(createdAt) ? "live" : "live_maturing"
  }
  return pendingOffersCount === 1 ? "offer_received" : "offers_received"
}

/**
 * `common` namespace translation keys for each BrokerLiveStatusKey — exported once here (rather than
 * redefined per page) so the Deal Room list and Deal Detail page cannot silently drift apart on which
 * key maps to which wording.
 */
export const BROKER_LIVE_STATUS_LABEL_KEY: Record<BrokerLiveStatusKey, string> = {
  live: "liveStatus",
  live_maturing: "liveMaturingStatus",
  offer_received: "offerReceivedStatus",
  offers_received: "offersReceivedStatus",
}
