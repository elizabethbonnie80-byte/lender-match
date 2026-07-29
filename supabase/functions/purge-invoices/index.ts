// LenderMatch — retention purge for archived invoices (client 2026-07-28, A-25; deploy-gated).
//
// The client asked to archive paid invoices for 7 years and delete them after that. The rule lives in
// SQL — `invoices_to_purge()` (migration 60) — so this function holds no policy: it deletes what that
// function returns. Same split as purge-documents: the row can be deleted in SQL, but the generated PDF
// lives in the private `invoices` bucket and only the Storage API can remove the bytes.
//
// Invoked monthly by the `purge_archived_invoices` pg_cron job via pg_net with the service-role key.
// `invoices_to_purge()` is revoked from PUBLIC (Security invariant #6), so no user token can enumerate
// the platform's billing history through it.
//
// ⚠️ pdf_path is nullable — an invoice only gets one once someone downloads the PDF. Rows without one
// are deleted just the same; only the non-null paths go to Storage.
//
// Wiring at deploy (values are secrets — NOT committed):
//   supabase functions deploy purge-invoices
//   select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-invoices', 'purge_invoices_url');
//   -- reuses the existing 'notify_service_role_key' vault secret for the bearer guard.
// Locally there is no cron config, so it never fires on its own; invoke it directly to test.

import { createClient } from "npm:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  // Only the cron job (holding the service-role key) may invoke this — it destroys financial records.
  const authHeader = req.headers.get("Authorization")
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) return json(401, { error: "unauthorized" })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data: rows, error } = await admin.rpc("invoices_to_purge")
  if (error) return json(500, { error: error.message })
  if (!rows || rows.length === 0) return json(200, { purged: 0 })

  const ids = rows.map((r) => r.id)
  const paths = rows.map((r) => r.pdf_path).filter((p): p is string => !!p)

  // Storage first: if the row went first and this failed, the bytes would be orphaned with nothing
  // left pointing at them.
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from("invoices").remove(paths)
    if (rmErr) return json(502, { error: `storage remove failed: ${rmErr.message}` })
  }

  const { error: delErr } = await admin.from("invoices").delete().in("id", ids)
  if (delErr) return json(500, { error: delErr.message })

  return json(200, { purged: ids.length, pdfs: paths.length })
})
