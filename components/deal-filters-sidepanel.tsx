'use client'

import { useEffect, useMemo, useState } from 'react'
import { useT } from '@/components/i18n-provider'
import { useEnums } from '@/lib/use-enums'
import { type Option } from '@/lib/enums'
import { EMPTY_FILTER_CRITERIA, type FilterCriteria, type SavedFilterInput } from '@/lib/queries/saved-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError } from '@/components/field-error'
import { EnumField, NumberField, RangeField } from '@/components/filter-fields'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ─── Field primitives ───────────────────────────────────────────────────────────
// EnumField / NumberField / RangeField now live in components/filter-fields.tsx (shared with the
// lender Settings saved-filter editor). The exclude-grids below stay local — they're sidepanel-only.

/** A "check to EXCLUDE" checkbox grid — checked means the deal must NOT have this value, per the
 *  reference panel's red hint copy. */
function ExcludeCheckboxGrid<T extends string>({ options, excluded, onChange }: {
  options: Option<T>[]; excluded: T[]; onChange: (v: T[]) => void
}) {
  const toggle = (v: T) =>
    onChange(excluded.includes(v) ? excluded.filter((x) => x !== v) : [...excluded, v])
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
          <Checkbox checked={excluded.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** Same idea, but for the 20 named boolean deal-flag columns (DEAL_INFO_FLAGS + PROPERTY_FLAGS). */
function ExcludeFlagGrid({ flags, values, onToggle }: {
  flags: [string, string][]; values: Record<string, boolean>; onToggle: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
      {flags.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
          <Checkbox checked={!!values[key]} onCheckedChange={() => onToggle(key)} />
          {label}
        </label>
      ))}
    </div>
  )
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="pt-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">{children}</h3>
      {hint && <p className="text-xs text-destructive font-medium mt-0.5">{hint}</p>}
    </div>
  )
}

// The 20 "Others" exclude flags, keyed by their `deals` column name (shared with the RPC's
// p_others_excluded / SavedFilterInput's individual exclude* booleans).
const OTHERS_FLAG_KEYS = [
  'excludeFthb', 'excludeNewToCanada', 'excludeNetworthProgram', 'excludeMedicalProfessional',
  'excludeCollateralTransfer', 'excludeCashback', 'excludeBridgeLoan', 'excludePurchasePlusImprovements',
  'excludeFirstAndHeloc', 'excludeHeloc', 'excludeFixedSecond', 'excludeCosignorOccupying',
  'excludeCosignorNotOccupying', 'excludeGuarantor', 'excludePrequal', 'excludeNewBuild',
  'excludeRecreational', 'excludeHobbyFarm', 'excludeWellWater', 'excludeSeptic',
  'excludeReverseMortgage', 'excludeMarriedOrCommonLaw', 'excludeSpouseNotOnApplication',
  'excludeTransunion',
] as const
type OthersFlagKey = (typeof OTHERS_FLAG_KEYS)[number]
// Maps a `deals` column key (from lib/enums.ts DEAL_INFO_FLAGS/PROPERTY_FLAGS) to its FilterCriteria field.
const DEAL_COL_TO_FLAG_KEY: Record<string, OthersFlagKey> = {
  fthb: 'excludeFthb',
  new_to_canada: 'excludeNewToCanada',
  networth_program: 'excludeNetworthProgram',
  medical_professional: 'excludeMedicalProfessional',
  collateral_transfer: 'excludeCollateralTransfer',
  cashback: 'excludeCashback',
  bridge_loan_needed: 'excludeBridgeLoan',
  purchase_plus_improvements: 'excludePurchasePlusImprovements',
  first_and_heloc: 'excludeFirstAndHeloc',
  heloc: 'excludeHeloc',
  fixed_second: 'excludeFixedSecond',
  cosignor_occupying: 'excludeCosignorOccupying',
  cosignor_not_occupying: 'excludeCosignorNotOccupying',
  guarantor: 'excludeGuarantor',
  prequal: 'excludePrequal',
  new_build: 'excludeNewBuild',
  recreational_property: 'excludeRecreational',
  hobby_farm: 'excludeHobbyFarm',
  well_water: 'excludeWellWater',
  septic: 'excludeSeptic',
  reverse_mortgage: 'excludeReverseMortgage',
  // Client 2026-07-25 (B-21): "We don't need this as a filter - please remove". Dropped from the
  // OTHERS map only — married_or_common_law stays in DEAL_INFO_FLAG_TABLE so the deal detail keeps
  // SHOWING it, and saved_filters.exclude_married_or_common_law stays in the schema so any filter a
  // lender already saved with it set keeps behaving as they set it.
  spouse_not_on_application: 'excludeSpouseNotOnApplication',
  transunion_being_used: 'excludeTransunion',
}

const MAX_DOORS_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

// ─── Main sidepanel ─────────────────────────────────────────────────────────────

export function DealFiltersSidepanel({
  open, onOpenChange, filters, onApply, onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: FilterCriteria
  onApply: (f: FilterCriteria) => void
  onSave: (input: SavedFilterInput) => void
}) {
  const t = useT('newDeals')
  const enums = useEnums()
  const anyLabel = t('anyOption')

  // Local draft — editing here doesn't touch the applied feed until "View Result".
  const [draft, setDraft] = useState<FilterCriteria>(filters)
  useEffect(() => { if (open) setDraft(filters) }, [open, filters])

  const patch = <K extends keyof FilterCriteria>(k: K, v: FilterCriteria[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  // Only flags that DEAL_COL_TO_FLAG_KEY maps to a filter field are offered here. A flag can be shown
  // on a deal without being filterable — married_or_common_law is exactly that since B-21 — and without
  // this guard it would still render a checkbox that silently does nothing.
  const othersFlags = useMemo(
    () =>
      ([...enums.DEAL_INFO_FLAGS, ...enums.PROPERTY_FLAGS] as [string, string][]).filter(
        ([dealCol]) => dealCol in DEAL_COL_TO_FLAG_KEY,
      ),
    [enums],
  )

  const toggleOthersFlag = (dealCol: string) => {
    const key = DEAL_COL_TO_FLAG_KEY[dealCol]
    if (!key) return
    patch(key, !draft[key] as FilterCriteria[typeof key])
  }
  const othersFlagValues: Record<string, boolean> = useMemo(
    () => Object.fromEntries(Object.entries(DEAL_COL_TO_FLAG_KEY).map(([dealCol, key]) => [dealCol, !!draft[key]])),
    [draft],
  )

  const handleReset = () => setDraft({ ...EMPTY_FILTER_CRITERIA })
  const handleViewResult = () => { onApply(draft); onOpenChange(false) }

  // ── Save Filter (name prompt) ── AlertDialogAction closes the dialog on click by default; when the
  // name is empty we preventDefault so it stays open and shows the inline "required" error instead.
  const [savePromptOpen, setSavePromptOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveNameShowError, setSaveNameShowError] = useState(false)

  const handleSaveConfirm = (e: React.MouseEvent) => {
    const name = saveName.trim()
    if (!name) {
      e.preventDefault()
      setSaveNameShowError(true)
      return
    }
    setSavePromptOpen(false)
    setSaveName('')
    setSaveNameShowError(false)
    onSave({ ...draft, name, isActive: true })
    onOpenChange(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="border-b border-border">
            <SheetTitle>{t('filters')}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EnumField label={t('fProvince')} anyLabel={anyLabel} options={enums.PROVINCE_OPTIONS}
                value={draft.province} onChange={(v) => patch('province', v)} />
              <EnumField label={t('fProduct')} anyLabel={anyLabel} options={enums.MORTGAGE_PRODUCT_OPTIONS}
                value={draft.mortgageProduct} onChange={(v) => patch('mortgageProduct', v)} />
              <EnumField label={t('fTransactionType')} anyLabel={anyLabel} options={enums.TRANSACTION_TYPE_OPTIONS}
                value={draft.transactionType} onChange={(v) => patch('transactionType', v)} />
              <EnumField label={t('fPurpose')} anyLabel={anyLabel} options={enums.TRANSACTION_PURPOSE_OPTIONS}
                value={draft.purpose} onChange={(v) => patch('purpose', v)} />
              <EnumField label={t('fMortgagePosition')} anyLabel={anyLabel} options={enums.MORTGAGE_POSITION_OPTIONS}
                value={draft.mortgagePosition} onChange={(v) => patch('mortgagePosition', v)} />
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer select-none">
              <Checkbox checked={!!draft.insured} onCheckedChange={(v) => patch('insured', v ? true : null)} />
              {t('fInsured')}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EnumField label={t('fOccupancy')} anyLabel={anyLabel} options={enums.OCCUPANCY_OPTIONS}
                value={draft.occupancy} onChange={(v) => patch('occupancy', v)} />
            </div>

            <RangeField label={t('fAmortization')} min={draft.amortizationMin} max={draft.amortizationMax}
              onMinChange={(v) => patch('amortizationMin', v)} onMaxChange={(v) => patch('amortizationMax', v)}
              minPlaceholder={t('min')} maxPlaceholder={t('max')} />
            <RangeField label={t('fLoan')} min={draft.loanAmountMin} max={draft.loanAmountMax}
              onMinChange={(v) => patch('loanAmountMin', v)} onMaxChange={(v) => patch('loanAmountMax', v)}
              minPlaceholder={t('min')} maxPlaceholder={t('max')} />
            <RangeField label={t('fLtv')} min={draft.ltvMin} max={draft.ltvMax}
              onMinChange={(v) => patch('ltvMin', v)} onMaxChange={(v) => patch('ltvMax', v)}
              minPlaceholder={t('min')} maxPlaceholder={t('max')} />

            <div className="grid grid-cols-2 gap-4">
              <NumberField label={t('fGds')} value={draft.gdsMax} onChange={(v) => patch('gdsMax', v)} placeholder={t('max')} />
              <NumberField label={t('fTds')} value={draft.tdsMax} onChange={(v) => patch('tdsMax', v)} placeholder={t('max')} />
            </div>

            <NumberField label={t('fCreditScoreMin')} value={draft.creditScoreMin}
              onChange={(v) => patch('creditScoreMin', v)} placeholder={t('min')} />

            <SectionTitle hint={t('fCreditIssuesHint')}>{t('fCreditIssues')}</SectionTitle>
            <ExcludeCheckboxGrid options={enums.CREDIT_ISSUE_OPTIONS} excluded={draft.creditIssuesExcluded}
              onChange={(v) => patch('creditIssuesExcluded', v)} />

            <SectionTitle hint={t('fDownPaymentHint')}>{t('fDownPayment')}</SectionTitle>
            <ExcludeCheckboxGrid options={enums.DOWN_PAYMENT_SOURCE_OPTIONS} excluded={draft.downPaymentSourcesExcluded}
              onChange={(v) => patch('downPaymentSourcesExcluded', v)} />

            <div className="grid grid-cols-2 gap-4">
              <NumberField label={t('fAssetsLiquidMin')} value={draft.assetsLiquidMin}
                onChange={(v) => patch('assetsLiquidMin', v)} placeholder={t('min')} />
              <NumberField label={t('fAssetsTotalMin')} value={draft.assetsTotalMin}
                onChange={(v) => patch('assetsTotalMin', v)} placeholder={t('min')} />
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer select-none">
              <Checkbox checked={draft.requireNoExceptions}
                onCheckedChange={(v) => patch('requireNoExceptions', !!v)} />
              {t('fRequireNoExceptions')}
            </label>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">{t('fMaxDoors')}</Label>
              <Select
                value={draft.maxDoors === null ? 'any' : String(draft.maxDoors)}
                onValueChange={(v) => patch('maxDoors', v === 'any' ? null : Number(v))}
              >
                <SelectTrigger className="bg-muted/50 h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{anyLabel}</SelectItem>
                  {MAX_DOORS_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <NumberField label={t('fMaxDoorTitles')} value={draft.maxDoorTitles}
              onChange={(v) => patch('maxDoorTitles', v)} placeholder={t('max')} />

            <SectionTitle hint={t('fResidencyHint')}>{t('fResidency')}</SectionTitle>
            <ExcludeCheckboxGrid options={enums.RESIDENCY_STATUS_OPTIONS} excluded={draft.residencyStatusesExcluded}
              onChange={(v) => patch('residencyStatusesExcluded', v)} />

            <EnumField label={t('fLocationType')} anyLabel={anyLabel} options={enums.LOCATION_TYPE_OPTIONS}
              value={draft.locationType} onChange={(v) => patch('locationType', v)} />

            <RangeField label={t('fPropertyValue')} min={draft.propertyValueMin} max={draft.propertyValueMax}
              onMinChange={(v) => patch('propertyValueMin', v)} onMaxChange={(v) => patch('propertyValueMax', v)}
              minPlaceholder={t('min')} maxPlaceholder={t('max')} />

            <NumberField label={t('fSquareFootage')} value={draft.squareFootageMin}
              onChange={(v) => patch('squareFootageMin', v)} placeholder={t('min')} />
            <NumberField label={t('fAcres')} value={draft.acresMax}
              onChange={(v) => patch('acresMax', v)} placeholder={t('max')} />

            {/* A-1 (2026-07-23): dwelling type moved from a single-value include to exclusion
                checkboxes — "We need to be able to exclude certain types." */}
            <SectionTitle hint={t('fDwellingHint')}>{t('fDwelling')}</SectionTitle>
            <ExcludeCheckboxGrid options={enums.DWELLING_TYPE_OPTIONS} excluded={draft.dwellingTypesExcluded}
              onChange={(v) => patch('dwellingTypesExcluded', v)} />

            <SectionTitle hint={t('fIncomeTypeHint')}>{t('fIncomeType')}</SectionTitle>
            <ExcludeCheckboxGrid options={enums.INCOME_TYPE_OPTIONS} excluded={draft.incomeTypesExcluded}
              onChange={(v) => patch('incomeTypesExcluded', v)} />

            <SectionTitle hint={t('fOthersHint')}>{t('fOthers')}</SectionTitle>
            <ExcludeFlagGrid
              flags={othersFlags}
              values={othersFlagValues}
              onToggle={toggleOthersFlag}
            />
          </div>

          <SheetFooter className="border-t border-border flex-row justify-between gap-2">
            <Button variant="ghost" onClick={handleReset}>{t('reset')}</Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setSavePromptOpen(true)}>{t('saveFilterBtn')}</Button>
              <Button onClick={handleViewResult}>{t('viewResult')}</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={savePromptOpen} onOpenChange={setSavePromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('saveFilterTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('saveFilterDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Label htmlFor="save-filter-name" className="sr-only">{t('saveFilterNamePlaceholder')}</Label>
            <Input
              id="save-filter-name"
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t('saveFilterNamePlaceholder')}
              aria-invalid={saveNameShowError && !saveName.trim()}
              className="bg-muted/50"
            />
            <FieldError show={saveNameShowError && !saveName.trim()} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setSaveName(''); setSaveNameShowError(false) }}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveConfirm} className={!saveName.trim() ? 'opacity-50' : ''}>
              {t('saveFilterBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
