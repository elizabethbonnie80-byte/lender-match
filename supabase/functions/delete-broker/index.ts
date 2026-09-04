// LenderMatch — Delete Account (soft-delete + Auth ban) for a broker.
//
// "Delete Account" means disable, never physical deletion or personal-data erasure (Round 4, approved
// 2026-09-04): profiles/deals/offers/invoices/messages/audit history are all left completely intact.
// This function does the one thing Postgres itself cannot do — call the Supabase Auth Admin API to
// ban the account — alongside setting the DB-side is_deleted flag.
//
// Two Supabase clients, same pattern as invoice-pdf:
//   asUser  — anon key + the caller's own forwarded JWT, so admin_soft_delete_broker() enforces
//             is_admin() exactly the same way it would for a direct RPC call from the browser.
//   admin   — service role, required for the Auth Admin API ban.
//
// Session revocation: deliberately NOT attempted here. An earlier version of this function also
// called an admin_revoke_broker_sessions() RPC that deleted directly from GoTrue's own internal
// auth.sessions / auth.refresh_tokens tables. Removed on review: this repo could not verify, from
// this environment, whether the installed @supabase/supabase-js (^2.110.0) exposes a supported,
// documented Admin API method for "revoke every session belonging to user X" (no node_modules, no
// internet access to check), and reaching directly into GoTrue's internal schema — whose column
// shapes have changed across versions — was judged too risky to ship unverified. The ban below is
// independently sufficient for stopping all FUTURE sign-ins and token refreshes on its own;
// is_currently_deleted() (migration 20260904000080) is the defense-in-depth layer inside submit_deal()
// / send_deal_message() for the narrow residual window where an already-issued, still-valid access
// token could otherwise keep working until it naturally expires. If immediate session revocation is
// wanted later, confirm a real Admin API method (or a GoTrue admin REST endpoint) against the actual
// deployed version first, rather than guessing.
//
// Ban duration: GoTrue's ban_duration accepts a duration string; there is no literal "forever" value
// in most versions, so a very long duration (~100 years) is the standard "effectively permanent" idiom.
// Reactivating (clearing the ban / is_deleted) is deliberately NOT built here — out of scope for this
// round per the approved plan ("do not add an ordinary Undelete button at this stage").
//
// Deploy:  supabase functions deploy delete-broker

import { createClient } from "npm:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const PERMANENT_BAN_DURATION = "876000h" // ~100 years

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

type Body = { broker_id?: string; reason?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return json(401, { error: "not authenticated" })

  const { broker_id, reason }: Body = await req.json().catch(() => ({}))
  if (!broker_id?.trim()) return json(400, { error: "broker_id is required" })
  if (!reason?.trim()) return json(400, { error: "a reason is required" })

  // Runs as the calling admin — is_admin() is enforced inside the RPC exactly as it would be for any
  // other admin RPC call. A non-admin caller gets the RPC's own "admin only" error here, and the Auth
  // ban below never runs.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { error: dbErr } = await asUser.rpc("admin_soft_delete_broker", { p_broker_id: broker_id, p_reason: reason })
  if (dbErr) return json(403, { error: dbErr.message })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { error: banErr } = await admin.auth.admin.updateUserById(broker_id, {
    ban_duration: PERMANENT_BAN_DURATION,
  })
  if (banErr) {
    // The DB is already marked deleted, and is_currently_deleted() already blocks submit_deal() /
    // send_deal_message() regardless of the ban's outcome — but login itself is NOT yet blocked if
    // this step failed. Surface this clearly rather than silently reporting success, so the admin
    // knows to retry rather than assuming the account is fully locked out.
    return json(502, { error: `Account flagged as deleted, but the Auth ban failed: ${banErr.message}. Retry Delete Account for this broker.` })
  }

  return json(200, { ok: true })
})
