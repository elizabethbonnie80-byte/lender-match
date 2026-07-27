// LenderMatch — Round 3 Phase 3: retention purge for deal documents (deploy-gated).
//
// Brokers upload a consent form + photo ID per deal into the private `deal-documents` bucket. The
// retention rule itself lives in SQL — `documents_to_purge()` (migration 52) — so this function holds
// no policy of its own: 120 days after the deal's closing date, or 120 days after upload when there
// is no closing date (a prequal, which may stay active in the broker's Deal Room indefinitely), with
// a hard ceiling of 240 days after upload.
//
// This function is invoked daily by the `purge_expired_documents` pg_cron job (migration 45) via
// pg_net, using the service-role key. It removes the objects from Storage (the SDK's .remove() deletes
// the actual bytes, not just the metadata row), then deletes the tracking rows. Purely server-side;
// `documents_to_purge()` is revoked from anon/authenticated, so the anon key cannot even enumerate.
//
// Wiring at deploy (values are secrets — NOT committed):
//   supabase functions deploy purge-documents
//   select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-documents', 'purge_documents_url');
//   -- reuses the existing 'notify_service_role_key' vault secret for the bearer guard.
// Locally (no cron config) it never fires on its own; invoke it directly for testing.

import { createClient } from "npm:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  // Only the cron job (holding the service-role key) may invoke this — it deletes user files.
  const authHeader = req.headers.get("Authorization")
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) return json(401, { error: "unauthorized" })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Documents whose retention has lapsed — the rule is defined in SQL, not here.
  const { data: rows, error } = await admin.rpc("documents_to_purge")
  if (error) return json(500, { error: error.message })
  if (!rows || rows.length === 0) return json(200, { purged: 0 })

  const paths = rows.map((r) => r.storage_path)
  const ids = rows.map((r) => r.id)

  const { error: rmErr } = await admin.storage.from("deal-documents").remove(paths)
  if (rmErr) return json(502, { error: `storage remove failed: ${rmErr.message}` })

  const { error: delErr } = await admin.from("deal_documents").delete().in("id", ids)
  if (delErr) return json(500, { error: delErr.message })

  return json(200, { purged: ids.length })
})
