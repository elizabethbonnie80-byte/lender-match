import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type DocType = Database["public"]["Enums"]["legal_doc_type"]

/**
 * Client revision A-3 — re-agreement when a legal document changes. `legal_documents` versions the docs;
 * `legal_acceptances` (migration 61) records which version each user accepted, and this is the read/write
 * pair the prompt uses. See `components/legal-reagreement-gate.tsx`.
 */
export type PendingLegalDoc = {
  id: string
  docType: DocType
  version: string
}

/**
 * The published documents the signed-in user has NOT accepted. Empty in the normal case — it only fills
 * after an admin publishes a new version, which is exactly when the prompt should appear.
 *
 * Returns [] rather than throwing on error: this drives a blocking modal, so a transient failure must not
 * be able to lock a user out of the app. A miss here is caught the next time the page loads.
 */
export async function listPendingLegalDocs(supabase: DB): Promise<PendingLegalDoc[]> {
  const { data, error } = await supabase.rpc("pending_legal_documents")
  if (error) return []
  return (data ?? []).map((d) => ({ id: d.id, docType: d.doc_type, version: d.version }))
}

/** Accept every currently published document in one call. Idempotent (migration 61). */
export async function acceptPublishedLegalDocs(supabase: DB): Promise<void> {
  const { error } = await supabase.rpc("accept_published_legal_documents")
  if (error) throw new Error(error.message)
}
