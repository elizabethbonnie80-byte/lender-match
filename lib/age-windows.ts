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
