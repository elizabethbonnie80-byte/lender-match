"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Star } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useT } from "@/components/i18n-provider"
import { submitSurvey, type PendingSurvey } from "@/lib/queries/surveys"
import { FieldError, RequiredFieldsNote } from "@/components/field-error"

function YesNo({
  value,
  onChange,
  invalid,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  invalid?: boolean
}) {
  const t = useT("survey")
  return (
    <div className="flex gap-2">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : invalid
                ? "bg-background text-foreground border-destructive"
                : "bg-background text-foreground border-border hover:border-primary/50"
          }`}
        >
          {opt ? t("yes") : t("no")}
        </button>
      ))}
    </div>
  )
}

export function SurveyDialog({
  survey,
  onClose,
  onSubmitted,
}: {
  survey: PendingSurvey
  onClose: () => void
  onSubmitted: () => void
}) {
  const t = useT("survey")
  const supabase = createClient()
  const lender = survey.lenderInstitution ?? t("fallbackLender")

  const [closedWith, setClosedWith] = useState<boolean | null>(null)
  const [commitment, setCommitment] = useState<boolean | null>(null)
  const [docReview, setDocReview] = useState<boolean | null>(null)
  const [funded, setFunded] = useState<boolean | null>(null)
  const [satisfaction, setSatisfaction] = useState(0)
  const [reason, setReason] = useState("")
  const [comments, setComments] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    closedWith === false
      ? true
      : closedWith === true &&
        commitment !== null &&
        docReview !== null &&
        funded !== null &&
        satisfaction >= 1

  const handleSubmit = async () => {
    if (submitting) return
    if (!canSubmit) {
      setShowErrors(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (closedWith) {
        await submitSurvey(supabase, survey.id, {
          closedWithLender: true,
          commitmentOnTime: commitment!,
          docReviewOnTime: docReview!,
          fundedOnTime: funded!,
          satisfaction,
          comments: comments.trim(),
        })
      } else {
        await submitSurvey(supabase, survey.id, {
          closedWithLender: false,
          notClosedReason: reason.trim(),
          comments: comments.trim(),
        })
      }
      onSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { deal: survey.dealNumber ?? t("fallbackDeal") })}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Q0 gate */}
          <div className="space-y-2">
            <Label>{t("q0", { lender })} <span className="text-destructive">*</span></Label>
            <YesNo value={closedWith} onChange={setClosedWith} invalid={showErrors && closedWith === null} />
            <FieldError show={showErrors && closedWith === null} />
          </div>

          {closedWith === true && (
            <>
              <div className="space-y-2">
                <Label>{t("qCommitment")} <span className="text-destructive">*</span></Label>
                <YesNo value={commitment} onChange={setCommitment} invalid={showErrors && commitment === null} />
                <FieldError show={showErrors && commitment === null} />
              </div>
              <div className="space-y-2">
                <Label>{t("qDocReview")} <span className="text-destructive">*</span></Label>
                <YesNo value={docReview} onChange={setDocReview} invalid={showErrors && docReview === null} />
                <FieldError show={showErrors && docReview === null} />
              </div>
              <div className="space-y-2">
                <Label>{t("qFunded")} <span className="text-destructive">*</span></Label>
                <YesNo value={funded} onChange={setFunded} invalid={showErrors && funded === null} />
                <FieldError show={showErrors && funded === null} />
              </div>
              <div className="space-y-2">
                <Label>{t("qSatisfaction", { lender })} <span className="text-destructive">*</span></Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSatisfaction(n)}
                      aria-label={n === 1 ? t("starAriaOne") : t("starAria", { n })}
                      className="p-0.5"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          n <= satisfaction ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <FieldError show={showErrors && satisfaction < 1} />
              </div>
            </>
          )}

          {closedWith === false && (
            <div className="space-y-2">
              <Label htmlFor="reason">{t("qReason")}</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={t("reasonPlaceholder")}
              />
            </div>
          )}

          {/* Client 2026-07-28 (B-3): free-text comments, read by the platform admin only — never by
              the lender being rated. Optional in both branches. */}
          {closedWith !== null && (
            <div className="space-y-2">
              <Label htmlFor="survey-comments">{t("qComments")}</Label>
              <Textarea
                id="survey-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                placeholder={t("commentsPlaceholder")}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <RequiredFieldsNote />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className={!canSubmit ? "opacity-50" : ""}>
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
