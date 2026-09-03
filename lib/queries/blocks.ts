import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type Org = { id: string; name: string }

// ── Broker ⟶ blocks lender institutions (broker_blocked_institutions) ───────────
// A block hides the broker's deals from every lender at that institution (lender_can_see_deal).

/**
 * Round 4 (2026-09-03): each broker may have at most this many ACTIVE blocked institutions at once.
 * Enforced server-side (race-safely) inside the block_lender_institution() RPC — migration
 * 20260903000078 — this constant only drives the UI (disabling the add control, the "N of 5" label).
 * Keep in sync with that migration's hardcoded `5` if it ever changes; there is no single source of
 * truth shared between SQL and TS for this one (same as NEW_DEAL_MAX_AGE_DAYS mirrors SQL elsewhere).
 */
export const MAX_BLOCKED_INSTITUTIONS = 5

/** Active lender institutions on the platform (the broker's block dropdown). Readable via lookup RLS. */
export async function listLenderInstitutions(supabase: DB): Promise<Org[]> {
  const { data, error } = await supabase.from("lender_institutions").select("id, name").eq("is_active", true).order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Institution ids the current broker has blocked (RLS scopes to their own rows). */
export async function listBlockedInstitutions(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase.from("broker_blocked_institutions").select("institution_id")
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.institution_id)
}

/**
 * Round 4: routes through block_lender_institution() instead of a raw insert — the RPC is the only
 * write path now (RLS no longer grants a broker's own client a direct INSERT on
 * broker_blocked_institutions, migration 20260903000078), so the 5-per-broker cap can't be bypassed by
 * calling the table directly. On a cap hit the RPC raises the bare code 'BLOCK_LIMIT_REACHED'; the
 * `.includes(...)` normalization mirrors the existing 'DUPLICATE_INSTITUTION_OFFER' pattern in
 * lib/queries/offers.ts, since PostgREST sometimes wraps the raised text rather than passing it as-is.
 */
export async function blockInstitution(supabase: DB, institutionId: string): Promise<void> {
  const { error } = await supabase.rpc("block_lender_institution", { p_institution_id: institutionId })
  if (error) throw new Error(error.message.includes("BLOCK_LIMIT_REACHED") ? "BLOCK_LIMIT_REACHED" : error.message)
}

export async function unblockInstitution(supabase: DB, institutionId: string): Promise<void> {
  // RLS (bbi_owner) restricts the delete to the caller's own rows.
  const { error } = await supabase.from("broker_blocked_institutions").delete().eq("institution_id", institutionId)
  if (error) throw new Error(error.message)
}

// ── Lender ⟶ blocks brokerages (lender_blocked_brokerages) ──────────────────────
// A block hides every deal from that brokerage from the lender's feeds (lender_can_see_deal).

/** Active brokerages on the platform (the lender's block dropdown). */
export async function listBrokerages(supabase: DB): Promise<Org[]> {
  const { data, error } = await supabase.from("brokerages").select("id, name").eq("is_active", true).order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Brokerage ids the current lender has blocked. */
export async function listBlockedBrokerages(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase.from("lender_blocked_brokerages").select("brokerage_id")
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.brokerage_id)
}

export async function blockBrokerage(supabase: DB, brokerageId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("You must be signed in.")
  const { error } = await supabase.from("lender_blocked_brokerages").insert({ lender_id: user.id, brokerage_id: brokerageId })
  if (error) throw new Error(error.message)
}

export async function unblockBrokerage(supabase: DB, brokerageId: string): Promise<void> {
  const { error } = await supabase.from("lender_blocked_brokerages").delete().eq("brokerage_id", brokerageId)
  if (error) throw new Error(error.message)
}
