"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PortalHeader } from "@/components/portal-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { FieldError } from "@/components/field-error"
import { Toaster, toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
  createAndSubmitDeal,
  createDealDraft,
  getDealDraft,
  updateAndSubmitDeal,
  updateDealDraft,
  updateSubmittedDeal,
  type DealDraftInput,
} from "@/lib/queries/deals"
import { scanContact } from "@/lib/queries/anti-contact"
import {
  listDealDocuments,
  uploadDealDocument,
  deleteDealDocument,
  signedDealDocumentUrl,
  matchDocumentName,
  type DealDocument,
  type DocumentKind,
} from "@/lib/queries/deal-documents"
import { useT } from "@/components/i18n-provider"
import { useEnums } from "@/lib/use-enums"
import type { Database } from "@/lib/database.types"
import {
  User,
  FileText,
  ClipboardCheck,
  Home,
  Calendar,
  DollarSign,
  Percent,
  MapPin,
  ChevronRight,
  Save,
  Info,
  Upload,
  Paperclip,
  X,
  Loader2,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Sentinel for "no transaction type" (E-5). A Radix SelectItem may not carry an empty value, so the
 * blank state needs a stand-in; it is mapped back to "" on the way into the form state and never
 * reaches the database. Same trick as the `any` option in components/filter-fields.tsx.
 */
const TRANSACTION_TYPE_NONE = "none"

/** Small (i) info button that pops up client-provided help copy — used for GDS/TDS + the 4 notes. */
function InfoHint({ title, text, ariaLabel }: { title: string; text: string; ariaLabel: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground align-middle ml-1"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-sm">
        <p className="font-medium mb-1">{title}</p>
        <p className="text-muted-foreground">{text}</p>
      </PopoverContent>
    </Popover>
  )
}

type Enums = Database["public"]["Enums"]
type Section = "client" | "deal" | "qualifying" | "property"

/** parse a form string to a number, or null when blank/invalid. */
function num(value: string): number | null {
  if (value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Toggle a value in/out of an array — for "check all that apply" multi-selects. */
function toggleIn<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]
}

/** Display a whole-dollar amount grouped with commas (state stores digits only). */
function groupThousands(value: string): string {
  const digits = value.replace(/[^\d]/g, "")
  return digits === "" ? "" : Number(digits).toLocaleString("en-US")
}

/** Cap a percentage entry at 100 (partial/decimal entries under 100 pass through untouched). */
function clampPct(value: string): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 100 ? "100" : value
}

export default function CreateDealPage() {
  const t = useT("createDeal")
  const {
    OCCUPANCY_OPTIONS,
    TRANSACTION_PURPOSE_OPTIONS,
    TRANSACTION_TYPE_OPTIONS,
    MORTGAGE_PRODUCT_OPTIONS,
    MORTGAGE_POSITION_OPTIONS,
    CREDIT_ISSUE_OPTIONS,
    INCOME_TYPE_OPTIONS,
    RESIDENCY_STATUS_OPTIONS,
    DOWN_PAYMENT_SOURCE_OPTIONS,
    PROVINCE_OPTIONS,
    LOCATION_TYPE_OPTIONS,
    DWELLING_TYPE_OPTIONS,
  } = useEnums()
  const router = useRouter()
  const supabase = createClient()
  const [activeSection, setActiveSection] = useState<Section>("client")
  const [isSaving, setIsSaving] = useState(false)
  // Set when resuming an existing draft (/create-deal?draft=<id>) → save/submit update in place.
  const [draftId, setDraftId] = useState<string | null>(null)
  // Round 3: editing a SUBMITTED deal (no offers yet). Loaded the same way but saved via
  // updateSubmittedDeal (status untouched — the deal keeps its number and stays in the feeds).
  const [editingSubmitted, setEditingSubmitted] = useState(false)
  // Sections the user tried to leave/submit while incomplete — turns on inline (red border + text) errors.
  const [attempted, setAttempted] = useState<Record<Section, boolean>>({
    client: false,
    deal: false,
    qualifying: false,
    property: false,
  })

  // Client Information
  const [clientFirstName, setClientFirstName] = useState("")
  const [clientLastName, setClientLastName] = useState("")
  const [occupancyType, setOccupancyType] = useState<Enums["occupancy_type"] | "">("")
  const [transactionPurpose, setTransactionPurpose] = useState<Enums["transaction_purpose"] | "">("")
  const [transactionType, setTransactionType] = useState<Enums["transaction_type"] | "">("")
  const [marriedOrCommonLaw, setMarriedOrCommonLaw] = useState(false)
  const [spouseNotOnApplication, setSpouseNotOnApplication] = useState(false)

  // Deal Information
  const [closingDate, setClosingDate] = useState("")
  const [isFlexible, setIsFlexible] = useState(false)
  const [cofDate, setCofDate] = useState("")
  const [mortgageProduct, setMortgageProduct] = useState<Enums["mortgage_product"] | "">("")
  const [isInsured, setIsInsured] = useState(false)
  const [ltv, setLtv] = useState("")
  const [loanAmount, setLoanAmount] = useState("")
  const [amortization, setAmortization] = useState("")
  const [mortgagePosition, setMortgagePosition] = useState<Enums["mortgage_position"] | "">("")
  const [previouslyDeclined, setPreviouslyDeclined] = useState(false)
  const [previouslyDeclinedReason, setPreviouslyDeclinedReason] = useState("")
  const [firstTimeBuyer, setFirstTimeBuyer] = useState(false)
  const [newToCanada, setNewToCanada] = useState(false)
  const [medicalPrograms, setMedicalPrograms] = useState(false)
  const [cashback, setCashback] = useState(false)
  const [collateralTransfer, setCollateralTransfer] = useState(false)
  const [firstAndHeloc, setFirstAndHeloc] = useState(false)
  const [heloc, setHeloc] = useState(false)
  const [fixedSecond, setFixedSecond] = useState(false)
  const [cosignorOccupying, setCosignorOccupying] = useState(false)
  const [cosignorNotOccupying, setCosignorNotOccupying] = useState(false)
  const [guarantor, setGuarantor] = useState(false)
  const [bridgeLoanNeeded, setBridgeLoanNeeded] = useState(false)
  const [purchasePlusImprovements, setPurchasePlusImprovements] = useState(false)
  const [networthProgram, setNetworthProgram] = useState(false)
  const [reverseMortgage, setReverseMortgage] = useState(false)

  // Qualifying Information
  const [creditScore, setCreditScore] = useState("")
  const [coBorrowerCreditScore, setCoBorrowerCreditScore] = useState("")
  const [creditIssues, setCreditIssues] = useState<Enums["credit_issue"][]>([])
  const [incomeTypes, setIncomeTypes] = useState<Enums["income_type"][]>([])
  const [gds, setGds] = useState("")
  const [tds, setTds] = useState("")
  const [foreignIncomeCountry, setForeignIncomeCountry] = useState("")
  const [ownsOtherProperties, setOwnsOtherProperties] = useState(false)
  const [doorCount, setDoorCount] = useState("")
  const [doorTitlesCount, setDoorTitlesCount] = useState("")
  const [residencyStatuses, setResidencyStatuses] = useState<Enums["residency_status"][]>([])
  const [downPaymentSources, setDownPaymentSources] = useState<Enums["down_payment_source"][]>([])
  const [assetsLiquidValue, setAssetsLiquidValue] = useState("")
  const [assetsTotalValue, setAssetsTotalValue] = useState("")
  const [transunionBeingUsed, setTransunionBeingUsed] = useState(false)
  // Starts checked: a fresh form has all 4 notes empty. Auto-recomputed on note edits (see onNoteChange).
  const [noLenderExceptionsRequired, setNoLenderExceptionsRequired] = useState(true)
  const [creditNotes, setCreditNotes] = useState("")
  const [qualifyingNotes, setQualifyingNotes] = useState("") // income notes
  const [downPaymentNotes, setDownPaymentNotes] = useState("")

  // Property Information
  const [propertyAddress, setPropertyAddress] = useState("")
  const [city, setCity] = useState("")
  const [province, setProvince] = useState<Enums["province"] | "">("")
  const [location, setLocation] = useState<Enums["location_type"] | "">("")
  const [propertyValue, setPropertyValue] = useState("")
  const [squareFootage, setSquareFootage] = useState("")
  const [dwellingType, setDwellingType] = useState<Enums["dwelling_type"] | "">("")
  const [acres, setAcres] = useState("")
  const [propertyNotes, setPropertyNotes] = useState("")
  const [preQualification, setPreQualification] = useState(false)
  const [newConstruction, setNewConstruction] = useState(false)
  const [hasWell, setHasWell] = useState(false)
  const [hasSeptic, setHasSeptic] = useState(false)
  const [recreationalProperty, setRecreationalProperty] = useState(false)
  const [hobbyFarm, setHobbyFarm] = useState(false)

  // Round 3 Phase 3: required documents (consent form + photo ID). A deal cannot be submitted until
  // both are uploaded — the submit_deal RPC enforces it too (data-layer backstop).
  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null)
  const hasDoc = (kind: DocumentKind) => documents.some((d) => d.kind === kind)
  /**
   * A checked document that belongs to a different person. Blocks the step (client 2026-08-07, H-1) —
   * a preferred-name variance (`nameMatches === true && nameVariance`) deliberately does NOT, that is
   * the client's own rule from migration 46. `=== false` and not falsiness: `null` means unchecked.
   */
  const mismatchedDoc = () => documents.find((d) => d.nameMatches === false)

  // Resume an existing draft (?draft=<id>) or edit a submitted deal (?edit=<id>): load it and
  // prefill the whole form. The loaded status decides the mode, not the param name.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const id = search.get("draft") ?? search.get("edit")
    if (!id) return
    getDealDraft(supabase, id)
      .then(({ input, status }) => {
        setDraftId(id)
        setEditingSubmitted(status === "submitted")
        listDealDocuments(supabase, id).then(setDocuments).catch(() => {})
        setClientFirstName(input.borrowerFirstName ?? "")
        setClientLastName(input.borrowerLastName ?? "")
        setOccupancyType(input.occupancy ?? "")
        setTransactionPurpose(input.purpose ?? "")
        setTransactionType(input.transactionType ?? "")
        setMarriedOrCommonLaw(!!input.marriedOrCommonLaw)
        setSpouseNotOnApplication(!!input.spouseNotOnApplication)
        setClosingDate(input.closingDate ?? "")
        setIsFlexible(!!input.closingDateFlexible)
        setCofDate(input.cofDate ?? "")
        setMortgageProduct(input.mortgageProduct ?? "")
        setIsInsured(!!input.insured)
        setLtv(input.ltv != null ? String(input.ltv) : "")
        setLoanAmount(input.loanAmount != null ? String(Math.round(Number(input.loanAmount))) : "")
        setAmortization(input.amortizationYears != null ? String(input.amortizationYears) : "")
        setMortgagePosition(input.mortgagePosition ?? "")
        setPreviouslyDeclined(!!input.previouslyDeclined)
        setPreviouslyDeclinedReason(input.previouslyDeclinedReason ?? "")
        setFirstTimeBuyer(!!input.fthb)
        setNewToCanada(!!input.newToCanada)
        setMedicalPrograms(!!input.medicalProfessional)
        setCashback(!!input.cashback)
        setCollateralTransfer(!!input.collateralTransfer)
        setFirstAndHeloc(!!input.firstAndHeloc)
        setHeloc(!!input.heloc)
        setFixedSecond(!!input.fixedSecond)
        setCosignorOccupying(!!input.cosignorOccupying)
        setCosignorNotOccupying(!!input.cosignorNotOccupying)
        setGuarantor(!!input.guarantor)
        setBridgeLoanNeeded(!!input.bridgeLoanNeeded)
        setPurchasePlusImprovements(!!input.purchasePlusImprovements)
        setNetworthProgram(!!input.networthProgram)
        setReverseMortgage(!!input.reverseMortgage)
        setCreditScore(input.primaryCreditScore != null ? String(input.primaryCreditScore) : "")
        setCoBorrowerCreditScore(input.coBorrowerCreditScore != null ? String(input.coBorrowerCreditScore) : "")
        setCreditIssues(input.creditIssues ?? [])
        setIncomeTypes(input.incomeTypes ?? [])
        setGds(input.gds != null ? String(input.gds) : "")
        setTds(input.tds != null ? String(input.tds) : "")
        setForeignIncomeCountry(input.foreignIncomeCountry ?? "")
        setOwnsOtherProperties(!!input.ownsOtherProperties)
        setDoorCount(input.doorCount != null ? String(input.doorCount) : "")
        setDoorTitlesCount(input.doorTitlesCount != null ? String(input.doorTitlesCount) : "")
        setResidencyStatuses(input.residencyStatuses ?? [])
        setDownPaymentSources(input.downPaymentSources ?? [])
        setAssetsLiquidValue(input.assetsLiquidValue != null ? String(Math.round(Number(input.assetsLiquidValue))) : "")
        setAssetsTotalValue(input.assetsTotalValue != null ? String(Math.round(Number(input.assetsTotalValue))) : "")
        setTransunionBeingUsed(!!input.transunionBeingUsed)
        setNoLenderExceptionsRequired(!!input.noLenderExceptionsRequired)
        setCreditNotes(input.creditNotes ?? "")
        setQualifyingNotes(input.incomeNotes ?? "")
        setDownPaymentNotes(input.downPaymentNotes ?? "")
        setPropertyAddress(input.propertyAddress ?? "")
        setCity(input.city ?? "")
        setProvince(input.province ?? "")
        setLocation(input.locationType ?? "")
        setPropertyValue(input.propertyValue != null ? String(Math.round(Number(input.propertyValue))) : "")
        setSquareFootage(input.squareFootage != null ? String(input.squareFootage) : "")
        setDwellingType(input.dwellingType ?? "")
        setAcres(input.acres != null ? String(input.acres) : "")
        setPropertyNotes(input.generalNotes ?? "")
        setPreQualification(!!input.prequal)
        setNewConstruction(!!input.newBuild)
        setHasWell(!!input.wellWater)
        setHasSeptic(!!input.septic)
        setRecreationalProperty(!!input.recreationalProperty)
        setHobbyFarm(!!input.hobbyFarm)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : t("errDraftLoad")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "No lender exceptions required" auto-checks itself whenever all 4 notes sections are empty
  // (still user-togglable — e.g. to manually uncheck it even with empty notes). Recomputed only on
  // USER edits to a note — not in an effect — so resuming a draft keeps its saved checkbox value
  // instead of overwriting it with the recomputation.
  function onNoteChange(setter: (v: string) => void, value: string, otherNotes: string[]) {
    setter(value)
    setNoLenderExceptionsRequired(!value.trim() && otherNotes.every((n) => !n.trim()))
  }

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "client", label: t("secClient"), icon: <User className="h-4 w-4" /> },
    { id: "deal", label: t("secDeal"), icon: <FileText className="h-4 w-4" /> },
    { id: "qualifying", label: t("secQualifying"), icon: <ClipboardCheck className="h-4 w-4" /> },
    { id: "property", label: t("secProperty"), icon: <Home className="h-4 w-4" /> },
  ]

  /** Collect all sections into the DB-shaped draft input. Empty selects become null. */
  function collectInput(): DealDraftInput {
    return {
      borrowerFirstName: clientFirstName,
      borrowerLastName: clientLastName,
      occupancy: occupancyType || null,
      purpose: transactionPurpose || null,
      transactionType: transactionType || null,
      marriedOrCommonLaw,
      spouseNotOnApplication: marriedOrCommonLaw ? spouseNotOnApplication : false,
      closingDate: closingDate,
      closingDateFlexible: isFlexible,
      cofDate: cofDate,
      mortgageProduct: mortgageProduct || null,
      insured: isInsured,
      ltv: num(ltv),
      loanAmount: num(loanAmount),
      amortizationYears: num(amortization),
      mortgagePosition: mortgagePosition || null,
      previouslyDeclined,
      previouslyDeclinedReason: previouslyDeclined ? previouslyDeclinedReason : null,
      fthb: firstTimeBuyer,
      newToCanada,
      medicalProfessional: medicalPrograms,
      cashback,
      collateralTransfer,
      firstAndHeloc,
      heloc,
      fixedSecond,
      cosignorOccupying,
      cosignorNotOccupying,
      guarantor,
      bridgeLoanNeeded,
      purchasePlusImprovements,
      networthProgram,
      reverseMortgage,
      primaryCreditScore: num(creditScore),
      coBorrowerCreditScore: num(coBorrowerCreditScore),
      creditIssues,
      incomeTypes,
      gds: num(gds),
      tds: num(tds),
      ownsOtherProperties,
      doorCount: ownsOtherProperties ? num(doorCount) : null,
      doorTitlesCount: ownsOtherProperties ? num(doorTitlesCount) : null,
      residencyStatuses,
      downPaymentSources,
      // Saved whether or not Networth is checked — the fields are always available (2026-07-20 #4).
      assetsLiquidValue: num(assetsLiquidValue),
      assetsTotalValue: num(assetsTotalValue),
      transunionBeingUsed,
      noLenderExceptionsRequired,
      foreignIncomeCountry,
      creditNotes,
      incomeNotes: qualifyingNotes,
      downPaymentNotes,
      propertyAddress,
      city,
      province: province || null,
      locationType: location || null,
      propertyValue: num(propertyValue),
      squareFootage: num(squareFootage),
      acres: num(acres),
      dwellingType: dwellingType || null,
      generalNotes: propertyNotes,
      prequal: preQualification,
      newBuild: newConstruction,
      recreationalProperty,
      hobbyFarm,
      wellWater: hasWell,
      septic: hasSeptic,
    }
  }

  // ── Required-field gating (mirrors Bubble's red-asterisk fields) ──────────────
  const SECTION_ORDER: Section[] = ["client", "deal", "qualifying", "property"]

  /** Whether a step's REQUIRED fields are all filled. Drafts ignore this; advancing/submitting doesn't. */
  function sectionComplete(section: Section): boolean {
    switch (section) {
      case "client":
        // E-5 (client 2026-07-30): transactionType is deliberately NOT required — a broker who is unsure
        // which lender type fits should be able to submit without guessing, and the deal then reaches
        // all three (migration 63).
        return !!clientFirstName.trim() && !!clientLastName.trim() && !!occupancyType && !!transactionPurpose
      case "deal":
        // Round 3 Phase 3: a prequal has no closing date yet — it gets one at "Move to Live Deal".
        return (!!closingDate || preQualification) && !!mortgageProduct && !!mortgagePosition && !!loanAmount.trim() && !!ltv.trim()
          && !!amortization.trim() && (!previouslyDeclined || !!previouslyDeclinedReason.trim())
      case "qualifying": {
        const needsForeignCountry = downPaymentSources.includes("foreign_funds") || incomeTypes.includes("foreign_income")
        return !!creditScore.trim() && !!gds.trim() && !!tds.trim() && residencyStatuses.length > 0
          && (!(marriedOrCommonLaw && spouseNotOnApplication) || !!creditNotes.trim())
          && (!networthProgram || (!!assetsLiquidValue.trim() && !!assetsTotalValue.trim()))
          && (!needsForeignCountry || !!foreignIncomeCountry.trim())
      }
      case "property":
        // Round 3 Phase 3 (OQ#41 / client feedback #7): no property address ⇒ the deal must be a
        // prequal. submit_deal enforces the same rule at the data layer.
        // A document that failed the name check blocks the step (client 2026-08-07, H-1). Property is
        // the LAST step, so this gates Submit without ever trapping the broker mid-wizard — and
        // submit_deal refuses it at the data layer regardless of what the wizard allows.
        return (!!propertyAddress.trim() || preQualification)
          && !!city.trim() && !!province && !!location && !!propertyValue.trim() && !!squareFootage.trim() && !!dwellingType
          && hasDoc("consent") && hasDoc("photo_id") && !mismatchedDoc()
    }
  }

  /** Any data entered at all — gates whether "Save Draft" is available (draft needs at least something). */
  const hasAnyData =
    [clientFirstName, clientLastName, closingDate, cofDate, loanAmount, ltv, amortization, creditScore,
      coBorrowerCreditScore, gds, tds, foreignIncomeCountry, creditNotes, qualifyingNotes, downPaymentNotes,
      propertyAddress, city, propertyValue, squareFootage, acres, propertyNotes,
      doorTitlesCount, assetsLiquidValue, assetsTotalValue]
      .some((v) => v.trim() !== "") ||
    [occupancyType, transactionPurpose, transactionType, mortgageProduct, mortgagePosition,
      province, location, dwellingType].some((v) => v !== "") ||
    incomeTypes.length > 0 || residencyStatuses.length > 0 || creditIssues.length > 0 || downPaymentSources.length > 0 ||
    [isFlexible, isInsured, previouslyDeclined, firstTimeBuyer, newToCanada, medicalPrograms, cashback,
      collateralTransfer, firstAndHeloc, heloc, fixedSecond, cosignorOccupying, cosignorNotOccupying, guarantor,
      bridgeLoanNeeded, purchasePlusImprovements, networthProgram, reverseMortgage, marriedOrCommonLaw,
      transunionBeingUsed, ownsOtherProperties, preQualification,
      newConstruction, recreationalProperty, hobbyFarm, hasWell, hasSeptic].some(Boolean)

  /** Inline error: a required field is empty AND the user already tried to leave/submit this step. */
  function invalid(section: Section, value: string | boolean): boolean {
    return attempted[section] && (typeof value === "string" ? value.trim() === "" : !value)
  }

  /** Navigate to a step. Going back is free; jumping forward requires the in-between steps be complete. */
  function goToStep(target: Section) {
    const targetIdx = SECTION_ORDER.indexOf(target)
    if (targetIdx <= SECTION_ORDER.indexOf(activeSection)) {
      setActiveSection(target)
      return
    }
    const blocker = SECTION_ORDER.slice(0, targetIdx).find((s) => !sectionComplete(s))
    if (blocker) {
      setAttempted((a) => ({ ...a, [blocker]: true }))
      setActiveSection(blocker)
      return
    }
    setActiveSection(target)
  }

  /** "Next" button: only advance when the current step's required fields are filled. */
  function advanceTo(next: Section) {
    if (!sectionComplete(activeSection)) {
      setAttempted((a) => ({ ...a, [activeSection]: true }))
      return
    }
    setActiveSection(next)
  }

  const Req = () => <span className="text-destructive ml-0.5">*</span>
  /** Error-border class helper for inputs / select triggers. */
  const errCls = (bad: boolean) => (bad ? "border-destructive focus-visible:ring-destructive" : "")

  /**
   * Anti-contact pre-check on the free-text notes (anonymity holds until acceptance). Records an
   * admin alert and returns a field-scoped message when contact info is found; the DB triggers are
   * the backstop that block the write regardless. Returns null when clean.
   */
  const notesContactIssue = async (): Promise<string | null> => {
    const checks: [string | null | undefined, Database["public"]["Enums"]["alert_source"], string][] = [
      [creditNotes, "deal_credit_notes", "labelCreditNotes"],
      [qualifyingNotes, "deal_income_notes", "labelIncomeNotes"],
      [downPaymentNotes, "deal_down_payment_notes", "labelDownPaymentNotes"],
      [propertyNotes, "deal_general_notes", "labelGeneralNotes"],
    ]
    for (const [text, source, labelKey] of checks) {
      const reason = await scanContact(supabase, text, source)
      if (reason) return t("notesBlocked", { label: t(labelKey), reason })
    }
    return null
  }

  /**
   * Documents must attach to a persisted deal (they need a deal_id for the storage path + FK), so the
   * first upload silently persists the current form as a draft if it isn't saved yet. Returns the id.
   */
  const ensureDraft = async (): Promise<string> => {
    if (draftId) return draftId
    const id = await createDealDraft(supabase, collectInput())
    setDraftId(id)
    return id
  }

  type NameCheck = Pick<DealDocument, "nameMatches" | "nameVariance" | "extractedName">
  const UNCHECKED: NameCheck = { nameMatches: null, nameVariance: null, extractedName: null }

  /**
   * Run the AI name-check for one document and reflect the outcome on it. Never throws: the check is
   * fail-open, so an unreachable edge function resolves as UNCHECKED rather than stopping the broker.
   */
  const applyNameCheck = async (docId: string): Promise<NameCheck> => {
    try {
      const r = await matchDocumentName(supabase, docId)
      if (!r.checked) return UNCHECKED
      const outcome: NameCheck = {
        nameMatches: r.nameMatches ?? null,
        nameVariance: r.nameVariance ?? null,
        extractedName: r.extractedName ?? null,
      }
      setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, ...outcome } : d)))
      return outcome
    } catch {
      return UNCHECKED
    }
  }

  /**
   * Resolve every document whose check has not landed yet, so Submit decides on real results instead
   * of on the NULLs that a still-in-flight check leaves behind (client 2026-08-07, H-1). Returns false
   * when any document belongs to a different person.
   *
   * An unavailable AI still resolves to null and still passes — `submit_deal` is fail-open on NULL on
   * purpose (an Anthropic outage must not halt every submission on the platform, see migration 65).
   * This function is what makes that NULL mean "the AI is down" rather than "the broker was fast".
   */
  const documentsPassNameCheck = async (): Promise<boolean> => {
    const results = await Promise.all(
      documents.map((d) => (d.nameMatches === null ? applyNameCheck(d.id).then((r) => r.nameMatches) : d.nameMatches)),
    )
    return !results.includes(false)
  }

  const handleUpload = async (kind: DocumentKind, file: File | undefined) => {
    if (!file || uploadingKind) return
    setUploadingKind(kind)
    try {
      const id = await ensureDraft()
      const doc = await uploadDealDocument(supabase, id, kind, file)
      setDocuments((prev) => [...prev.filter((d) => d.kind !== kind), doc])
      toast.success(t("docUploaded"))
      // AI name-match. Fire-and-forget so the upload feels instant; handleSubmit awaits anything still
      // pending, so a mismatch cannot slip through just because the broker submitted before Claude
      // answered (client 2026-08-07, H-1). Its progress is deliberately not shown — see the card.
      applyNameCheck(doc.id).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docUploadError"))
    } finally {
      setUploadingKind(null)
    }
  }

  const handleRemoveDoc = async (kind: DocumentKind) => {
    if (!draftId) return
    try {
      await deleteDealDocument(supabase, draftId, kind)
      setDocuments((prev) => prev.filter((d) => d.kind !== kind))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docUploadError"))
    }
  }

  const handleViewDoc = async (storagePath: string) => {
    try {
      const url = await signedDealDocumentUrl(supabase, storagePath)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docUploadError"))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    // Submitting requires every step's required fields — jump to the first incomplete one.
    const blocker = SECTION_ORDER.find((s) => !sectionComplete(s))
    if (blocker) {
      setAttempted({ client: true, deal: true, qualifying: true, property: true })
      setActiveSection(blocker)
      return
    }
    setIsSaving(true)
    try {
      // Client 2026-08-07 (H-1): resolve any name-check still in flight, then refuse on a mismatch.
      // submit_deal raises on the same condition — this is the legible version of that backstop.
      // Deliberately NOT in handleSaveDraft: a draft is private and unfinished, and holding one
      // hostage would leave the broker with nowhere to put the work while they chase a better scan.
      if (!(await documentsPassNameCheck())) {
        setAttempted((a) => ({ ...a, property: true }))
        setActiveSection("property")
        toast.error(t("docNameMismatchBlocks"))
        return
      }
      const issue = await notesContactIssue()
      if (issue) {
        toast.error(issue)
        return
      }
      if (editingSubmitted && draftId) {
        // Round 3: save changes in place — the deal stays 'submitted' and keeps its number.
        await updateSubmittedDeal(supabase, draftId, collectInput())
        toast.success(t("dealUpdated"))
      } else {
        const deal = draftId
          ? await updateAndSubmitDeal(supabase, draftId, collectInput())
          : await createAndSubmitDeal(supabase, collectInput())
        toast.success(t("dealSubmitted", { number: deal?.deal_number ?? "" }))
      }
      router.push("/deal-room")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errSubmit"))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const issue = await notesContactIssue()
      if (issue) {
        toast.error(issue)
        return
      }
      if (draftId) await updateDealDraft(supabase, draftId, collectInput())
      else await createDealDraft(supabase, collectInput())
      toast.success(t("draftSaved"))
      router.push("/deal-room")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errDraft"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader />
      <Toaster richColors position="top-right" />

      {/* Main Content */}
      <main className="flex-1 py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {editingSubmitted ? t("editTitle") : draftId ? t("resumeTitle") : t("title")}
            </h1>
          </div>

          {/* Section Navigation — full-width stepper (icons + connectors + labels) */}
          <div className="flex items-center mb-8">
            {sections.map((section, index) => {
              const idx = SECTION_ORDER.indexOf(section.id)
              const activeIdx = SECTION_ORDER.indexOf(activeSection)
              const state = section.id === activeSection ? "active" : idx < activeIdx ? "done" : "todo"
              return (
                <div key={section.id} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => goToStep(section.id)}
                    className="flex flex-col items-center gap-1.5 shrink-0"
                  >
                    <span
                      className={`flex items-center justify-center h-10 w-10 rounded-full border-2 transition-colors ${
                        state === "active"
                          ? "bg-primary border-primary text-primary-foreground"
                          : state === "done"
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      {section.icon}
                    </span>
                    <span
                      className={`text-xs font-medium text-center hidden sm:block ${
                        state === "todo" ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {section.label}
                    </span>
                  </button>
                  {index < sections.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-2 -mt-6 ${idx < activeIdx ? "bg-primary" : "bg-border"}`} />
                  )}
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit}>
            {/* Client Information Section */}
            {activeSection === "client" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secClient")}</h2>
                    <p className="text-sm text-muted-foreground">{t("clientDesc")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="clientFirstName">{t("firstName")}<Req /></Label>
                    <Input
                      id="clientFirstName"
                      placeholder={t("firstNamePlaceholder")}
                      value={clientFirstName}
                      onChange={(e) => setClientFirstName(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("client", clientFirstName))}`}
                    />
                    <FieldError show={invalid("client", clientFirstName)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientLastName">{t("lastName")}<Req /></Label>
                    <Input
                      id="clientLastName"
                      placeholder={t("lastNamePlaceholder")}
                      value={clientLastName}
                      onChange={(e) => setClientLastName(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("client", clientLastName))}`}
                    />
                    <FieldError show={invalid("client", clientLastName)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="occupancyType">{t("occupancy")}<Req /></Label>
                    <Select value={occupancyType} onValueChange={(v) => setOccupancyType(v as Enums["occupancy_type"])}>
                      <SelectTrigger id="occupancyType" className={`w-full bg-muted/50 ${errCls(invalid("client", occupancyType))}`}>
                        <SelectValue placeholder={t("selectOccupancy")} />
                      </SelectTrigger>
                      <SelectContent>
                        {OCCUPANCY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("client", occupancyType)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="transactionPurpose">{t("purpose")}<Req /></Label>
                    <Select value={transactionPurpose} onValueChange={(v) => setTransactionPurpose(v as Enums["transaction_purpose"])}>
                      <SelectTrigger id="transactionPurpose" className={`w-full bg-muted/50 ${errCls(invalid("client", transactionPurpose))}`}>
                        <SelectValue placeholder={t("selectPurpose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_PURPOSE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("client", transactionPurpose)} />
                  </div>
                  {/* E-5 (client 2026-07-30): optional, with a visible note rather than an InfoHint —
                      the whole point is that an unsure broker sees it without having to open anything.
                      "Not specified" is a sentinel because a shadcn SelectItem cannot hold an empty
                      value, and without it the field would be write-once: pick Prime on a draft and
                      there would be no way back to blank. */}
                  <div className="space-y-2">
                    <Label htmlFor="transactionType">{t("transactionType")}</Label>
                    <Select
                      value={transactionType || TRANSACTION_TYPE_NONE}
                      onValueChange={(v) =>
                        setTransactionType(v === TRANSACTION_TYPE_NONE ? "" : (v as Enums["transaction_type"]))
                      }
                    >
                      <SelectTrigger id="transactionType" className="w-full bg-muted/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TRANSACTION_TYPE_NONE}>{t("transactionTypeNone")}</SelectItem>
                        {TRANSACTION_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("transactionTypeHint")}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="marriedOrCommonLaw"
                      checked={marriedOrCommonLaw}
                      onCheckedChange={(checked) => setMarriedOrCommonLaw(checked as boolean)}
                    />
                    <Label htmlFor="marriedOrCommonLaw" className="text-sm font-normal cursor-pointer">
                      {t("marriedOrCommonLaw")}
                    </Label>
                  </div>
                  {marriedOrCommonLaw && (
                    <div className="pl-6 space-y-2">
                      <p className="text-sm text-muted-foreground">{t("spouseOnApplicationQuestion")}</p>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="spouseNotOnApplication"
                          checked={spouseNotOnApplication}
                          onCheckedChange={(checked) => setSpouseNotOnApplication(checked as boolean)}
                        />
                        <Label htmlFor="spouseNotOnApplication" className="text-sm font-normal cursor-pointer">
                          {t("checkIfNo")}
                        </Label>
                      </div>
                      {spouseNotOnApplication && (
                        <p className="text-sm text-muted-foreground">{t("spouseNotOnApplicationHint")}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <span />
                  <div className="flex gap-3">
                    {!editingSubmitted && (
                      <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                        <Save className="mr-2 h-4 w-4" />
                        {t("saveDraft")}
                      </Button>
                    )}
                    <Button type="button" onClick={() => advanceTo("deal")}>
                      {t("nextDeal")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Deal Information Section */}
            {activeSection === "deal" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secDeal")}</h2>
                    <p className="text-sm text-muted-foreground">{t("dealDesc")}</p>
                  </div>
                </div>

                {/* Round 3 Phase 3: a prequal has no property and no closing date yet, so this has to
                    be decided HERE — it is what makes the closing date (below) and the property
                    address (Property step) optional. */}
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Checkbox
                    id="preQualification"
                    checked={preQualification}
                    onCheckedChange={(c) => setPreQualification(c as boolean)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="preQualification" className="text-sm font-normal cursor-pointer">
                      {t("prequal")}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t("prequalHint")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="closingDate">
                      {t("closingDate")}
                      {/* Round 3 Phase 3: a prequal gets its closing date at "Move to Live Deal" */}
                      {!preQualification && <Req />}
                    </Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="closingDate"
                        type="date"
                        value={closingDate}
                        onChange={(e) => setClosingDate(e.target.value)}
                        className={`pl-10 bg-muted/50 ${errCls(!preQualification && invalid("deal", closingDate))}`}
                      />
                    </div>
                    <FieldError show={!preQualification && invalid("deal", closingDate)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cofDate">{t("cofDate")}</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="cofDate"
                        type="date"
                        value={cofDate}
                        onChange={(e) => setCofDate(e.target.value)}
                        className="pl-10 bg-muted/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox id="isFlexible" checked={isFlexible} onCheckedChange={(checked) => setIsFlexible(checked as boolean)} />
                    <Label htmlFor="isFlexible" className="text-sm font-normal cursor-pointer">{t("flexible")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="isInsured" checked={isInsured} onCheckedChange={(checked) => setIsInsured(checked as boolean)} />
                    <Label htmlFor="isInsured" className="text-sm font-normal cursor-pointer">{t("insured")}</Label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="mortgageProduct">{t("mortgageProduct")}<Req /></Label>
                    <Select value={mortgageProduct} onValueChange={(v) => setMortgageProduct(v as Enums["mortgage_product"])}>
                      <SelectTrigger id="mortgageProduct" className={`w-full bg-muted/50 ${errCls(invalid("deal", mortgageProduct))}`}>
                        <SelectValue placeholder={t("selectProduct")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MORTGAGE_PRODUCT_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("deal", mortgageProduct)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mortgagePosition">{t("mortgagePosition")}<Req /></Label>
                    <Select value={mortgagePosition} onValueChange={(v) => setMortgagePosition(v as Enums["mortgage_position"])}>
                      <SelectTrigger id="mortgagePosition" className={`w-full bg-muted/50 ${errCls(invalid("deal", mortgagePosition))}`}>
                        <SelectValue placeholder={t("selectPosition")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MORTGAGE_POSITION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("deal", mortgagePosition)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="loanAmount">{t("loanAmount")}<Req /></Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="loanAmount"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("phLoanAmount")}
                        value={groupThousands(loanAmount)}
                        onChange={(e) => setLoanAmount(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("deal", loanAmount))}`}
                      />
                    </div>
                    <FieldError show={invalid("deal", loanAmount)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ltv">{t("ltv")}<Req /></Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ltv"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phLtv")}
                        value={ltv}
                        onChange={(e) => setLtv(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("deal", ltv))}`}
                      />
                    </div>
                    <FieldError show={invalid("deal", ltv)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amortization">{t("amortization")}<Req /></Label>
                    <Input
                      id="amortization"
                      type="number"
                      placeholder={t("phAmortization")}
                      value={amortization}
                      onChange={(e) => setAmortization(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("deal", amortization))}`}
                    />
                    <FieldError show={invalid("deal", amortization)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="previouslyDeclined"
                      checked={previouslyDeclined}
                      onCheckedChange={(checked) => setPreviouslyDeclined(checked as boolean)}
                    />
                    <Label htmlFor="previouslyDeclined" className="text-sm font-normal cursor-pointer">{t("previouslyDeclined")}</Label>
                  </div>
                  {previouslyDeclined && (
                    <div className="space-y-2">
                      <Label htmlFor="previouslyDeclinedReason">{t("declinedReason")}<Req /></Label>
                      <Input
                        id="previouslyDeclinedReason"
                        placeholder={t("declinedReasonPlaceholder")}
                        value={previouslyDeclinedReason}
                        onChange={(e) => setPreviouslyDeclinedReason(e.target.value)}
                        className={`bg-muted/50 ${errCls(invalid("deal", previouslyDeclinedReason))}`}
                      />
                      <FieldError show={invalid("deal", previouslyDeclinedReason)} />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("checkAllApply")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(
                      [
                        // Client 2026-07-25 (B-8): "the 2 co-signer options and the guarantor to be
                        // together. Perhaps on the very right?" They are the LAST three entries, so the
                        // grid keeps them adjacent at any column count — pinning them to column 4 would
                        // scatter them again at the md/sm breakpoints.
                        ["fthb", firstTimeBuyer, setFirstTimeBuyer, "firstTimeBuyer"],
                        ["collateralTransfer", collateralTransfer, setCollateralTransfer, "collateralTransfer"],
                        ["firstAndHeloc", firstAndHeloc, setFirstAndHeloc, "firstAndHeloc"],
                        ["newToCanada", newToCanada, setNewToCanada, "newToCanada"],
                        ["cashback", cashback, setCashback, "cashback"],
                        ["heloc", heloc, setHeloc, "heloc"],
                        ["networthProgram", networthProgram, setNetworthProgram, "networthProgram"],
                        ["bridgeLoanNeeded", bridgeLoanNeeded, setBridgeLoanNeeded, "bridgeLoanNeeded"],
                        ["fixedSecond", fixedSecond, setFixedSecond, "fixedSecond"],
                        ["medicalPrograms", medicalPrograms, setMedicalPrograms, "medicalProfessional"],
                        ["purchasePlusImprovements", purchasePlusImprovements, setPurchasePlusImprovements, "purchasePlusImprovements"],
                        ["reverseMortgage", reverseMortgage, setReverseMortgage, "reverseMortgage"],
                        ["cosignorOccupying", cosignorOccupying, setCosignorOccupying, "cosignorOccupying"],
                        ["cosignorNotOccupying", cosignorNotOccupying, setCosignorNotOccupying, "cosignorNotOccupying"],
                        ["guarantor", guarantor, setGuarantor, "guarantor"],
                      ] as [string, boolean, (v: boolean) => void, string][]
                    ).map(([id, checked, set, labelKey]) => (
                      <div key={id} className="flex items-center gap-2">
                        <Checkbox id={id} checked={checked} onCheckedChange={(c) => set(c as boolean)} />
                        <Label htmlFor={id} className="text-sm font-normal cursor-pointer leading-tight">{t(labelKey)}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("client")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    {!editingSubmitted && (
                      <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                        <Save className="mr-2 h-4 w-4" />
                        {t("saveDraft")}
                      </Button>
                    )}
                    <Button type="button" onClick={() => advanceTo("qualifying")}>
                      {t("nextQualifying")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Qualifying Information Section */}
            {activeSection === "qualifying" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secQualifying")}</h2>
                    <p className="text-sm text-muted-foreground">{t("qualifyingDesc")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="creditScore">{t("creditScore")}<Req /></Label>
                    <Input
                      id="creditScore"
                      type="number"
                      placeholder={t("phCreditScore")}
                      value={creditScore}
                      onChange={(e) => setCreditScore(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("qualifying", creditScore))}`}
                    />
                    <FieldError show={invalid("qualifying", creditScore)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coBorrowerCreditScore">{t("coBorrowerCreditScore")}</Label>
                    <Input
                      id="coBorrowerCreditScore"
                      type="number"
                      placeholder={t("phCoBorrower")}
                      value={coBorrowerCreditScore}
                      onChange={(e) => setCoBorrowerCreditScore(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                {/* Credit Issues on its own row — the label needs the full width (was cramped in a 3-col grid).
                    The old "(Choose most severe…)" hint was removed per client feedback 2026-07-20 (#1): it no
                    longer applies now that Credit Issues is a multi-select. */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("creditIssuesMulti")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {CREDIT_ISSUE_OPTIONS.map((o) => (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`credit-issue-${o.value}`}
                          checked={creditIssues.includes(o.value)}
                          onCheckedChange={() => setCreditIssues((prev) => toggleIn(prev, o.value))}
                        />
                        <Label htmlFor={`credit-issue-${o.value}`} className="text-sm font-normal cursor-pointer leading-tight">
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("incomeTypeMulti")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {INCOME_TYPE_OPTIONS.map((o) => (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`income-${o.value}`}
                          checked={incomeTypes.includes(o.value)}
                          onCheckedChange={() => setIncomeTypes((prev) => toggleIn(prev, o.value))}
                        />
                        <Label htmlFor={`income-${o.value}`} className="text-sm font-normal cursor-pointer leading-tight">
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="gds">
                      {t("gds")}<Req />
                      <InfoHint title={t("infoGdsTitle")} text={t("infoGds")} ariaLabel={t("infoButtonLabel")} />
                    </Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="gds"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phGds")}
                        value={gds}
                        onChange={(e) => setGds(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("qualifying", gds))}`}
                      />
                    </div>
                    <FieldError show={invalid("qualifying", gds)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tds">
                      {t("tds")}<Req />
                      <InfoHint title={t("infoTdsTitle")} text={t("infoTds")} ariaLabel={t("infoButtonLabel")} />
                    </Label>
                    <div className="relative">
                      <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="tds"
                        type="number"
                        min={0}
                        max={100}
                        placeholder={t("phTds")}
                        value={tds}
                        onChange={(e) => setTds(clampPct(e.target.value))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("qualifying", tds))}`}
                      />
                    </div>
                    <FieldError show={invalid("qualifying", tds)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("residencyStatusMulti")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {RESIDENCY_STATUS_OPTIONS.map((o) => (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`residency-${o.value}`}
                          checked={residencyStatuses.includes(o.value)}
                          onCheckedChange={() => setResidencyStatuses((prev) => toggleIn(prev, o.value))}
                        />
                        <Label htmlFor={`residency-${o.value}`} className="text-sm font-normal cursor-pointer leading-tight">
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <FieldError show={invalid("qualifying", residencyStatuses.length > 0)} />
                  {(residencyStatuses.includes("work_permit_cuaet") || residencyStatuses.includes("work_permit_non_cuaet")) && (
                    <p className="text-xs text-destructive">{t("workPermitWarning")}</p>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("downPaymentSourceMulti")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {DOWN_PAYMENT_SOURCE_OPTIONS.map((o) => (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`down-payment-source-${o.value}`}
                          checked={downPaymentSources.includes(o.value)}
                          onCheckedChange={() => setDownPaymentSources((prev) => toggleIn(prev, o.value))}
                        />
                        <Label htmlFor={`down-payment-source-${o.value}`} className="text-sm font-normal cursor-pointer leading-tight">
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="foreignIncomeCountry">
                      {t("foreignIncomeCountry")}
                      {(downPaymentSources.includes("foreign_funds") || incomeTypes.includes("foreign_income")) && <Req />}
                    </Label>
                    <Input
                      id="foreignIncomeCountry"
                      placeholder={t("foreignIncomeCountryPlaceholder")}
                      value={foreignIncomeCountry}
                      onChange={(e) => setForeignIncomeCountry(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("qualifying", !(downPaymentSources.includes("foreign_funds") || incomeTypes.includes("foreign_income")) || foreignIncomeCountry))}`}
                    />
                    <FieldError show={invalid("qualifying", !(downPaymentSources.includes("foreign_funds") || incomeTypes.includes("foreign_income")) || foreignIncomeCountry)} />
                  </div>
                </div>

                {/* Assets are ALWAYS available (client feedback 2026-07-20 #4) — they're only MANDATORY
                    when the Networth program is checked, so the asterisk + inline error are gated on it. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="assetsLiquidValue">{t("assetsLiquidValue")}{networthProgram && <Req />}</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="assetsLiquidValue"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("assetsLiquidValuePlaceholder")}
                        value={groupThousands(assetsLiquidValue)}
                        onChange={(e) => setAssetsLiquidValue(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(networthProgram && invalid("qualifying", assetsLiquidValue))}`}
                      />
                    </div>
                    <FieldError show={networthProgram && invalid("qualifying", assetsLiquidValue)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="assetsTotalValue">{t("assetsTotalValue")}{networthProgram && <Req />}</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="assetsTotalValue"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("assetsTotalValuePlaceholder")}
                        value={groupThousands(assetsTotalValue)}
                        onChange={(e) => setAssetsTotalValue(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(networthProgram && invalid("qualifying", assetsTotalValue))}`}
                      />
                    </div>
                    <FieldError show={networthProgram && invalid("qualifying", assetsTotalValue)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="ownsOtherProperties"
                      checked={ownsOtherProperties}
                      onCheckedChange={(checked) => setOwnsOtherProperties(checked as boolean)}
                    />
                    <Label htmlFor="ownsOtherProperties" className="text-sm font-normal cursor-pointer">
                      {t("ownsOtherProperties")}
                    </Label>
                  </div>
                  {ownsOtherProperties && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="doorCount">{t("howManyDoors")}</Label>
                        <Input
                          id="doorCount"
                          type="number"
                          placeholder={t("howManyDoorsPlaceholder")}
                          value={doorCount}
                          onChange={(e) => setDoorCount(e.target.value)}
                          className="bg-muted/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doorTitlesCount">{t("doorTitlesCount")}</Label>
                        <Input
                          id="doorTitlesCount"
                          type="number"
                          placeholder={t("doorTitlesCountPlaceholder")}
                          value={doorTitlesCount}
                          onChange={(e) => setDoorTitlesCount(e.target.value)}
                          className="bg-muted/50"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creditNotes">
                    {t("creditNotes")}
                    {marriedOrCommonLaw && spouseNotOnApplication && <Req />}
                    <InfoHint title={t("infoCreditNotesTitle")} text={t("infoCreditNotes")} ariaLabel={t("infoButtonLabel")} />
                  </Label>
                  <Textarea
                    id="creditNotes"
                    placeholder={t("creditNotesPlaceholder")}
                    value={creditNotes}
                    onChange={(e) => onNoteChange(setCreditNotes, e.target.value, [qualifyingNotes, downPaymentNotes, propertyNotes])}
                    className={`bg-muted/50 min-h-20 ${errCls(invalid("qualifying", !(marriedOrCommonLaw && spouseNotOnApplication) || creditNotes))}`}
                  />
                  <FieldError show={invalid("qualifying", !(marriedOrCommonLaw && spouseNotOnApplication) || creditNotes)} />
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="transunionBeingUsed"
                      checked={transunionBeingUsed}
                      onCheckedChange={(checked) => setTransunionBeingUsed(checked as boolean)}
                    />
                    <Label htmlFor="transunionBeingUsed" className="text-sm font-normal cursor-pointer leading-tight">
                      {t("transunionBeingUsed")}
                    </Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="qualifyingNotes">
                    {t("incomeNotes")}
                    <InfoHint title={t("infoIncomeNotesTitle")} text={t("infoIncomeNotes")} ariaLabel={t("infoButtonLabel")} />
                  </Label>
                  <Textarea
                    id="qualifyingNotes"
                    placeholder={t("incomeNotesPlaceholder")}
                    value={qualifyingNotes}
                    onChange={(e) => onNoteChange(setQualifyingNotes, e.target.value, [creditNotes, downPaymentNotes, propertyNotes])}
                    className="bg-muted/50 min-h-20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="downPaymentNotes">
                    {t("downPaymentNotes")}
                    <InfoHint title={t("infoDownPaymentNotesTitle")} text={t("infoDownPaymentNotes")} ariaLabel={t("infoButtonLabel")} />
                  </Label>
                  <Textarea
                    id="downPaymentNotes"
                    placeholder={t("downPaymentNotesPlaceholder")}
                    value={downPaymentNotes}
                    onChange={(e) => onNoteChange(setDownPaymentNotes, e.target.value, [creditNotes, qualifyingNotes, propertyNotes])}
                    className="bg-muted/50 min-h-20"
                  />
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("deal")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    {!editingSubmitted && (
                      <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                        <Save className="mr-2 h-4 w-4" />
                        {t("saveDraft")}
                      </Button>
                    )}
                    <Button type="button" onClick={() => advanceTo("property")}>
                      {t("nextProperty")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Property Information Section */}
            {activeSection === "property" && (
              <div className="bg-card rounded-lg border border-border p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Home className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{t("secProperty")}</h2>
                    <p className="text-sm text-muted-foreground">{t("propertyDesc")}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="propertyAddress">
                    {t("propertyAddress")}
                    {/* Round 3 Phase 3: required unless the deal is submitted as a prequal */}
                    {!preQualification && <Req />}
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="propertyAddress"
                      placeholder={t("propertyAddressPlaceholder")}
                      value={propertyAddress}
                      onChange={(e) => setPropertyAddress(e.target.value)}
                      className={`pl-10 bg-muted/50 ${errCls(!preQualification && invalid("property", propertyAddress))}`}
                    />
                  </div>
                  {!preQualification && invalid("property", propertyAddress)
                    ? <p className="text-xs text-destructive">{t("addressOrPrequal")}</p>
                    : <p className="text-xs text-muted-foreground">{t("addressPrequalHint")}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="city">{t("city")}<Req /></Label>
                    <Input
                      id="city"
                      placeholder={t("cityPlaceholder")}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("property", city))}`}
                    />
                    <FieldError show={invalid("property", city)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="province">{t("province")}<Req /></Label>
                    <Select value={province} onValueChange={(v) => setProvince(v as Enums["province"])}>
                      <SelectTrigger id="province" className={`w-full bg-muted/50 ${errCls(invalid("property", province))}`}>
                        <SelectValue placeholder={t("selectProvince")} />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVINCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("property", province)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">{t("locationType")}<Req /></Label>
                    <Select value={location} onValueChange={(v) => setLocation(v as Enums["location_type"])}>
                      <SelectTrigger id="location" className={`w-full bg-muted/50 ${errCls(invalid("property", location))}`}>
                        <SelectValue placeholder={t("selectLocation")} />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCATION_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError show={invalid("property", location)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="propertyValue">{t("propertyValue")}<Req /></Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="propertyValue"
                        type="text"
                        inputMode="numeric"
                        placeholder={t("phPropertyValue")}
                        value={groupThousands(propertyValue)}
                        onChange={(e) => setPropertyValue(e.target.value.replace(/[^\d]/g, ""))}
                        className={`pl-10 bg-muted/50 ${errCls(invalid("property", propertyValue))}`}
                      />
                    </div>
                    <FieldError show={invalid("property", propertyValue)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="squareFootage">{t("squareFootage")}<Req /></Label>
                    <Input
                      id="squareFootage"
                      type="number"
                      placeholder={t("phSquareFootage")}
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                      className={`bg-muted/50 ${errCls(invalid("property", squareFootage))}`}
                    />
                    <FieldError show={invalid("property", squareFootage)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="acres">{t("acres")}</Label>
                    <Input
                      id="acres"
                      type="number"
                      step="0.01"
                      placeholder={t("phAcres")}
                      value={acres}
                      onChange={(e) => setAcres(e.target.value)}
                      className="bg-muted/50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dwellingType">{t("dwellingType")}<Req /></Label>
                  <Select value={dwellingType} onValueChange={(v) => setDwellingType(v as Enums["dwelling_type"])}>
                    <SelectTrigger id="dwellingType" className={`w-full bg-muted/50 ${errCls(invalid("property", dwellingType))}`}>
                      <SelectValue placeholder={t("selectDwelling")} />
                    </SelectTrigger>
                    <SelectContent>
                      {DWELLING_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError show={invalid("property", dwellingType)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="propertyNotes">
                    {t("generalNotes")}
                    <InfoHint title={t("infoGeneralNotesTitle")} text={t("infoGeneralNotes")} ariaLabel={t("infoButtonLabel")} />
                  </Label>
                  <Textarea
                    id="propertyNotes"
                    placeholder={t("generalNotesPlaceholder")}
                    value={propertyNotes}
                    onChange={(e) => onNoteChange(setPropertyNotes, e.target.value, [creditNotes, qualifyingNotes, downPaymentNotes])}
                    className="bg-muted/50 min-h-24"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">{t("propertyCharacteristics")}</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(
                      [
                        // "Pre-Qualification" lives on the Deal step — it gates the closing date there.
                        ["hobbyFarm", hobbyFarm, setHobbyFarm, "hobbyFarm"],
                        ["newConstruction", newConstruction, setNewConstruction, "newBuild"],
                        ["hasWell", hasWell, setHasWell, "wellWater"],
                        ["recreationalProperty", recreationalProperty, setRecreationalProperty, "recreational"],
                        ["hasSeptic", hasSeptic, setHasSeptic, "septic"],
                      ] as [string, boolean, (v: boolean) => void, string][]
                    ).map(([id, checked, set, labelKey]) => (
                      <div key={id} className="flex items-center gap-2">
                        <Checkbox id={id} checked={checked} onCheckedChange={(c) => set(c as boolean)} />
                        <Label htmlFor={id} className="text-sm font-normal cursor-pointer leading-tight">{t(labelKey)}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Round 3 Phase 3: required documents — consent form + photo ID. A deal can't be
                    submitted until both are uploaded. */}
                <div className="space-y-3 pt-2">
                  <Label className="text-sm font-medium">
                    {t("docsTitle")}<Req />
                  </Label>
                  <p className="text-xs text-muted-foreground -mt-1">{t("docsHint")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["consent", "docConsent"],
                        ["photo_id", "docPhotoId"],
                      ] as [DocumentKind, string][]
                    ).map(([kind, labelKey]) => {
                      const doc = documents.find((d) => d.kind === kind)
                      const busy = uploadingKind === kind
                      // A mismatch is a blocking error now, so the card is outlined like a missing one.
                      const missing = (attempted.property && !doc) || doc?.nameMatches === false
                      return (
                        <div
                          key={kind}
                          className={`rounded-lg border p-3 ${missing ? "border-destructive" : "border-border"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{t(labelKey)}</span>
                            {doc && (
                              <button
                                type="button"
                                onClick={() => handleRemoveDoc(kind)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={t("docRemove")}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {doc ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleViewDoc(doc.storagePath)}
                                className="mt-2 flex items-center gap-1.5 text-sm text-primary hover:underline"
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                                <span className="truncate max-w-[180px]">{doc.fileName ?? t("docView")}</span>
                              </button>
                              {/* The name-check result is deliberately NOT narrated to the broker
                                  (client 2026-08-11, I-2: "better that the users don't see that it's
                                  just scanning for a name"). Two states only: uploaded, or blocked.
                                  The blocking one has to stay visible — it is the whole point of H-1,
                                  and a Submit that refuses without saying why is worse than silence.
                                  Verified/variance/in-flight/unchecked all read as a plain success:
                                  none of them stops the broker, so none of them needs its own copy.
                                  The result itself is still stored, still blocks in submit_deal, still
                                  shows in /admin/documents, and a variance still prints both names on
                                  the invoice — only this line changed. */}
                              {doc.nameMatches === false ? (
                                <p className="mt-1 text-xs text-destructive">{t("docNameMismatch")}</p>
                              ) : (
                                <p className="mt-1 text-xs text-muted-foreground">{t("docUploadSuccess")}</p>
                              )}
                            </>
                          ) : (
                            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              <span>{busy ? t("docUploading") : t("docChoose")}</span>
                              <input
                                type="file"
                                accept="application/pdf,image/*"
                                className="hidden"
                                disabled={busy}
                                onChange={(e) => {
                                  handleUpload(kind, e.target.files?.[0])
                                  e.target.value = ""
                                }}
                              />
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {attempted.property && (!hasDoc("consent") || !hasDoc("photo_id")) && (
                    <p className="text-xs text-destructive">{t("docsRequired")}</p>
                  )}
                  {mismatchedDoc() && (
                    <p className="text-xs text-destructive">{t("docNameMismatchBlocks")}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    id="noLenderExceptionsRequired"
                    checked={noLenderExceptionsRequired}
                    onCheckedChange={(checked) => setNoLenderExceptionsRequired(checked as boolean)}
                  />
                  <Label htmlFor="noLenderExceptionsRequired" className="text-sm font-normal cursor-pointer">
                    {t("noLenderExceptionsRequired")}
                  </Label>
                </div>

                {/* Client-supplied confirmation, bottom of the last page (2026-07-25, B-36) */}
                <p className="text-xs leading-relaxed text-muted-foreground border-t border-border pt-4">
                  {t("accuracyConfirmation")}
                </p>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => setActiveSection("qualifying")}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    {!editingSubmitted && (
                      <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSaving || !hasAnyData}>
                        <Save className="mr-2 h-4 w-4" />
                        {t("saveDraft")}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={isSaving}
                      className={SECTION_ORDER.every((s) => sectionComplete(s)) ? "" : "opacity-50"}
                    >
                      {isSaving
                        ? editingSubmitted ? t("savingChanges") : t("submitting")
                        : editingSubmitted ? t("saveChanges") : t("submitDeal")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}
