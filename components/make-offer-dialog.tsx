"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FieldError } from "@/components/field-error"
import { createClient } from "@/lib/supabase/client"
import { makeOffer, editOffer } from "@/lib/queries/offers"
import { scanContact } from "@/lib/queries/anti-contact"
import { useT } from "@/components/i18n-provider"
import { useEnums } from "@/lib/use-enums"
import { PRODUCT_TERM_YEARS, platformBpsFor } from "@/lib/queries/deals"
import { BRAND, LEGAL_ENTITY } from "@/lib/brand"
import type { Database } from "@/lib/database.types"

type MortgageProduct = Database["public"]["Enums"]["mortgage_product"]

/** The dialog's form as entered (strings). Shared with the submitted-offers Edit action. */
export type OfferFormValues = {
  mortgageProduct: string
  rate: string
  rateLockDays: string
  commissionBps: string
  commitmentDays: string
  docReviewDays: string
  comments: string
  lenderFeePct: string
}

const EMPTY: OfferFormValues = {
  mortgageProduct: "",
  rate: "",
  rateLockDays: "",
  commissionBps: "",
  commitmentDays: "",
  docReviewDays: "",
  comments: "",
  lenderFeePct: "",
}

// Round 3 "remember last response": the last offer the lender sent, minus the comments (those are
// ALWAYS cleared per the client spec). Local to this browser — a convenience prefill, not data.
const LAST_OFFER_KEY = "ll_last_offer"

function loadLastOffer(): Partial<OfferFormValues> {
  try {
    const raw = localStorage.getItem(LAST_OFFER_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<OfferFormValues>
    return { ...parsed, comments: "" }
  } catch {
    return {}
  }
}

function saveLastOffer(form: OfferFormValues) {
  try {
    const { comments: _comments, ...rest } = form
    localStorage.setItem(LAST_OFFER_KEY, JSON.stringify(rest))
  } catch {
    // storage unavailable (private mode) — the prefill is best-effort
  }
}

/** An existing pending offer being edited (Round 3: offers are editable until accepted). */
export type OfferEditTarget = {
  offerId: string
  dealId: string
  values: OfferFormValues
}

/**
 * Shared offer dialog (New Deals + Maturing Deals + Submitted Offers "Edit"). Collects the offer
 * (commission always in bps), runs the anti-contact pre-check on the comment, then calls make_offer
 * for each target deal — or edit_offer when `edit` is set (Round 3: pending offers stay editable
 * until accepted; the broker is notified on edit). Batch-capable: pass one id (Maturing) or several
 * (New Deals bulk). On success it calls onSuccess so the host page updates its own row state;
 * identity stays hidden until the broker accepts.
 *
 * Round 3 prefill: a new offer starts from the lender's remembered last response (comments always
 * cleared); `prefillProduct` (the target deal's own product, when a single deal is targeted) wins
 * over the remembered product.
 *
 * Validation mirrors the Create Deal wizard: every field is required except the comments — required
 * fields carry a red asterisk and, once the lender tries to send while incomplete, show a red border +
 * "this field is required" line.
 */
export function MakeOfferDialog({
  dealIds,
  edit = null,
  prefillProduct = null,
  onClose,
  onSuccess,
}: {
  dealIds: string[] | null
  edit?: OfferEditTarget | null
  prefillProduct?: MortgageProduct | null
  onClose: () => void
  onSuccess: (ids: string[], message: string) => void
}) {
  const t = useT("makeOffer")
  const { MORTGAGE_PRODUCT_OPTIONS } = useEnums()
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const isEdit = edit !== null
  const open = isEdit || dealIds !== null
  const count = dealIds?.length ?? 0

  // Initialize the form when the dialog opens: the offer being edited, or (new offer) the
  // remembered last response overlaid with the target deal's product.
  useEffect(() => {
    if (!open) return
    if (edit) {
      setForm(edit.values)
    } else {
      setForm({
        ...EMPTY,
        ...loadLastOffer(),
        ...(prefillProduct ? { mortgageProduct: prefillProduct } : {}),
      })
    }
    setError(null)
    setAttempted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit?.offerId])

  // Every field except comments is required (same rule as the Create Deal wizard). Derived so it can
  // both gate submit and dim the button while incomplete (faux-disabled: the button stays clickable).
  const missing =
    !form.mortgageProduct ||
    !form.rate.trim() ||
    !form.commissionBps.trim() ||
    !form.rateLockDays.trim() ||
    !form.commitmentDays.trim() ||
    !form.docReviewDays.trim()

  const close = () => {
    setForm(EMPTY)
    setError(null)
    setAttempted(false)
    onClose()
  }

  const submit = async () => {
    if ((!dealIds && !edit) || submitting) return
    if (missing) {
      setAttempted(true)
      setError(t("fillRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    const supabase = createClient()
    try {
      // Anti-contact pre-check on the comment (logs an alert + blocks; DB trigger is the backstop).
      const scanDealId = edit ? edit.dealId : dealIds![0]
      const reason = await scanContact(supabase, form.comments, "offer_comments", scanDealId)
      if (reason) {
        setError(t("commentBlocked", { reason }))
        return
      }
      const fields = {
        mortgageProduct: form.mortgageProduct as MortgageProduct,
        rate: Number(form.rate),
        rateLockDays: Number(form.rateLockDays),
        commissionBps: Number(form.commissionBps),
        commitmentTurnTimeDays: Number(form.commitmentDays),
        docReviewTurnTimeDays: Number(form.docReviewDays),
        comments: form.comments || null,
        lenderFeePct: form.lenderFeePct.trim() === "" ? null : Number(form.lenderFeePct),
      }
      let ids: string[]
      let msg: string
      if (edit) {
        await editOffer(supabase, { offerId: edit.offerId, ...fields })
        ids = [edit.dealId]
        msg = t("editSaved")
      } else {
        for (const dealId of dealIds!) {
          await makeOffer(supabase, { dealId, ...fields })
        }
        saveLastOffer(form)
        ids = dealIds!
        msg = count === 1 ? t("sentOne") : t("sentMany", { count })
      }
      setForm(EMPTY)
      setAttempted(false)
      onSuccess(ids, msg)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"))
    } finally {
      setSubmitting(false)
    }
  }

  const invalid = (v: string) => attempted && v.trim() === ""
  const Req = () => <span className="text-destructive ml-0.5">*</span>
  const errCls = (bad: boolean) => (bad ? "border-destructive focus-visible:ring-destructive" : "")

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-w-lg" aria-describedby={isEdit ? undefined : ""}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("editTitle") : count > 1 ? t("titleMany", { count }) : t("title")}
          </DialogTitle>
          {/* Client 2026-07-23 (A-8): the "commission is in bps / your identity stays hidden" line was
              removed. Only the edit-mode description remains. */}
          {isEdit && <DialogDescription>{t("editDescription")}</DialogDescription>}
        </DialogHeader>

        {/* Round 3 Phase 3: nothing is different for a LENDER bidding on a prequal (client 2026-07-27
            — "There is nothing different for a lender when they're sending an offer on a prequal").
            The pre-qualification disclaimer is shown to the BROKER when they view the offers, on
            app/(broker)/deal-detail/[id]. The card in the feed already badges the deal PREQUAL. */}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="offerProduct">{t("product")}<Req /></Label>
            <Select value={form.mortgageProduct} onValueChange={(v) => setForm((f) => ({ ...f, mortgageProduct: v }))}>
              <SelectTrigger id="offerProduct" className={`w-full ${errCls(invalid(form.mortgageProduct))}`}>
                <SelectValue placeholder={t("productPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {MORTGAGE_PRODUCT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError show={invalid(form.mortgageProduct)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerRate">{t("rate")}<Req /></Label>
            <Input id="offerRate" type="number" step="0.01" placeholder={t("ratePlaceholder")} className={errCls(invalid(form.rate))}
              value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            <FieldError show={invalid(form.rate)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerCommission">{t("commission")}<Req /></Label>
            <Input id="offerCommission" type="number" placeholder={t("commissionPlaceholder")} className={errCls(invalid(form.commissionBps))}
              value={form.commissionBps} onChange={(e) => setForm((f) => ({ ...f, commissionBps: e.target.value }))} />
            <FieldError show={invalid(form.commissionBps)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerLenderFeePct">{t("lenderFeePct")}</Label>
            <Input id="offerLenderFeePct" type="number" step="0.1" placeholder={t("lenderFeePctPlaceholder")}
              value={form.lenderFeePct} onChange={(e) => setForm((f) => ({ ...f, lenderFeePct: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerRateLock">{t("rateLock")}<Req /></Label>
            <Input id="offerRateLock" type="number" placeholder={t("rateLockPlaceholder")} className={errCls(invalid(form.rateLockDays))}
              value={form.rateLockDays} onChange={(e) => setForm((f) => ({ ...f, rateLockDays: e.target.value }))} />
            <FieldError show={invalid(form.rateLockDays)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerCommitment">{t("commitment")}<Req /></Label>
            <Input id="offerCommitment" type="number" placeholder={t("commitmentPlaceholder")} className={errCls(invalid(form.commitmentDays))}
              value={form.commitmentDays} onChange={(e) => setForm((f) => ({ ...f, commitmentDays: e.target.value }))} />
            <FieldError show={invalid(form.commitmentDays)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offerDocReview">{t("docReview")}<Req /></Label>
            <Input id="offerDocReview" type="number" placeholder={t("docReviewPlaceholder")} className={errCls(invalid(form.docReviewDays))}
              value={form.docReviewDays} onChange={(e) => setForm((f) => ({ ...f, docReviewDays: e.target.value }))} />
            <FieldError show={invalid(form.docReviewDays)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="offerComments">{t("comments")}</Label>
            <Textarea id="offerComments" placeholder={t("commentsPlaceholder")}
              value={form.comments} onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))} />
          </div>
        </div>

        {form.mortgageProduct && form.commissionBps.trim() !== "" && !Number.isNaN(Number(form.commissionBps)) && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            {(() => {
              const grossBps = Number(form.commissionBps)
              const product = form.mortgageProduct as MortgageProduct
              const platformBps = platformBpsFor(product)
              const netBps = Math.max(0, grossBps - platformBps)
              // Two label/amount rows rather than three spans on one line: the fee label is long
              // enough to wrap in the dialog's width, which used to squeeze the amounts together.
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("platformDeduction", { brand: BRAND, term: PRODUCT_TERM_YEARS[product] })}
                    </span>
                    <span className="text-destructive whitespace-nowrap">-{platformBps} bps</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                    <span className="font-semibold text-foreground">{t("finalCommissionAmount")}</span>
                    <span className="font-semibold text-foreground whitespace-nowrap">{netBps} bps</span>
                  </div>
                </div>
              )
            })()}
            <p className="text-xs text-muted-foreground">{t("commissionFinePrint", { entity: LEGAL_ENTITY })}</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={submitting} className={missing ? "opacity-50" : ""}>
            {submitting
              ? isEdit ? t("savingEdit") : t("sending")
              : isEdit ? t("saveEdit") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
