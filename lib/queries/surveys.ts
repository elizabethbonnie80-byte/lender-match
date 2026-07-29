import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>

export type PendingSurvey = {
  id: string
  dealId: string
  dealNumber: string | null
  /** The accepted lender's institution — revealed to the broker post-acceptance, so safe to show. */
  lenderInstitution: string | null
}

const SELECT =
  "id, deal_id, deals(deal_number), lender_institutions!surveys_lender_institution_id_fkey(name)"

function mapRow(s: {
  id: string
  deal_id: string
  deals: { deal_number: string | null } | { deal_number: string | null }[] | null
  lender_institutions: { name: string } | { name: string }[] | null
}): PendingSurvey {
  const deal = Array.isArray(s.deals) ? s.deals[0] : s.deals
  const inst = Array.isArray(s.lender_institutions) ? s.lender_institutions[0] : s.lender_institutions
  return {
    id: s.id,
    dealId: s.deal_id,
    dealNumber: deal?.deal_number ?? null,
    lenderInstitution: inst?.name ?? null,
  }
}

/**
 * The current user's OWN not-yet-completed closing surveys (the ones THEY must answer). Scoped
 * explicitly to broker_id = auth.uid(): the surveys_broker RLS already limits a broker to their own,
 * but an admin (surveys_admin) can read every survey — without this filter the admin Deal Room banner
 * would count other brokers' pending surveys even though the admin has no deals of their own.
 */
export async function listPendingSurveys(supabase: DB): Promise<PendingSurvey[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from("surveys")
    .select(SELECT)
    .eq("is_completed", false)
    .eq("broker_id", user.id)
    .order("created_at")
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/** The pending survey for a specific deal, or null (used by the deal-detail survey prompt). */
export async function getPendingSurveyForDeal(supabase: DB, dealId: string): Promise<PendingSurvey | null> {
  const { data, error } = await supabase
    .from("surveys")
    .select(SELECT)
    .eq("deal_id", dealId)
    .eq("is_completed", false)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data) : null
}

/** Optional free-text note for the platform admin (client 2026-07-28, B-3) — never shown to the lender. */
type SurveyComments = { comments?: string }

export type SurveyAnswers =
  | ({
      closedWithLender: true
      commitmentOnTime: boolean
      docReviewOnTime: boolean
      fundedOnTime: boolean
      satisfaction: number // 1–5
    } & SurveyComments)
  | ({
      closedWithLender: false
      notClosedReason: string
    } & SurveyComments)

/** Submit the closing survey via the security-definer RPC (Q0 gates the rest; atomic). */
export async function submitSurvey(supabase: DB, surveyId: string, answers: SurveyAnswers) {
  const { error } = await supabase.rpc(
    "submit_survey",
    answers.closedWithLender
      ? {
          p_survey_id: surveyId,
          p_closed_with_lender: true,
          p_commitment_on_time: answers.commitmentOnTime,
          p_doc_review_on_time: answers.docReviewOnTime,
          p_funded_on_time: answers.fundedOnTime,
          p_satisfaction: answers.satisfaction,
          p_comments: answers.comments || undefined,
        }
      : {
          p_survey_id: surveyId,
          p_closed_with_lender: false,
          p_not_closed_reason: answers.notClosedReason,
          p_comments: answers.comments || undefined,
        },
  )
  if (error) throw new Error(error.message)
}
