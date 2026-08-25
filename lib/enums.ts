import type { Database } from "@/lib/database.types"
import type { Locale } from "@/lib/i18n/config"

/**
 * Display labels for every closed-set enum in the schema — now bilingual (EN/FR).
 *
 * The DB stores the CLEAN enum value (e.g. `5_year_fixed`); the UI shows the label. Select components
 * bind their value to the enum, not the label — so no reverse lookup is needed on input. Labels mirror
 * the Bubble option-set display text (docs/extracted/data-model.md §2), NOT Bubble's db_values.
 *
 * Each label is a `[en, fr]` tuple. `getEnums(locale)` builds the localized OPTION arrays + LABEL maps;
 * client components use the `useEnums()` hook (`lib/use-enums.ts`). The static exports below are the
 * EN bundle, kept for back-compat / server use so un-migrated call sites keep working in English.
 */

type Enums = Database["public"]["Enums"]
export type Option<T extends string> = { value: T; label: string }

type Bi = readonly [en: string, fr: string]
const IDX: Record<Locale, 0 | 1> = { en: 0, fr: 1 }
const pick = (bi: Bi, locale: Locale) => bi[IDX[locale]]

// ── Bilingual label tables (insertion order = display order) ────────────────────

const OCCUPANCY: Record<Enums["occupancy_type"], Bi> = {
  owner_occupied: ["Owner Occupied", "Occupé par le propriétaire"],
  rental_1_unit: ["Rental 1 Unit", "Locatif 1 logement"],
  rental_2_4_units: ["Rental 2-4 Units", "Locatif 2-4 logements"],
  second_home: ["Second Home", "Résidence secondaire"],
}

const TRANSACTION_PURPOSE: Record<Enums["transaction_purpose"], Bi> = {
  purchase: ["Purchase", "Achat"],
  refinance: ["Refinance", "Refinancement"],
  renewal: ["Renewal", "Renouvellement"],
}

const TRANSACTION_TYPE: Record<Enums["transaction_type"], Bi> = {
  prime: ["Prime", "Prime"],
  alt: ["Alt", "Alt"],
  private: ["Private", "Privé"],
}

const MORTGAGE_PRODUCT: Record<Enums["mortgage_product"], Bi> = {
  "5_year_fixed": ["5 Year Fixed", "Fixe 5 ans"],
  "5_year_arm_vrm": ["5 Year ARM/VRM", "ARM/VRM 5 ans"],
  "3_year_fixed": ["3 Year Fixed", "Fixe 3 ans"],
  "3_year_arm_vrm": ["3 Year ARM/VRM", "ARM/VRM 3 ans"],
  "4_year_fixed": ["4 Year Fixed", "Fixe 4 ans"],
  "2_year_fixed": ["2 Year Fixed", "Fixe 2 ans"],
  "1_year_fixed": ["1 Year Fixed", "Fixe 1 an"],
  "6_month_convertible": ["6 Month Convertible", "Convertible 6 mois"],
  open: ["Open", "Ouvert"],
  "7_year_fixed": ["7 Year Fixed", "Fixe 7 ans"],
  "10_year_fixed": ["10 Year Fixed", "Fixe 10 ans"],
}

const MORTGAGE_POSITION: Record<Enums["mortgage_position"], Bi> = {
  first: ["1st Mortgage", "1re hypothèque"],
  second: ["2nd Mortgage", "2e hypothèque"],
  third: ["3rd Mortgage", "3e hypothèque"],
}

const CREDIT_ISSUE: Record<Enums["credit_issue"], Bi> = {
  lates_30_plus: ["30+ Day Lates (non-mortgage)", "Retards de 30+ jours (hors hypothèque)"],
  lates_60_plus: ["60+ Day Lates (non-mortgage)", "Retards de 60+ jours (hors hypothèque)"],
  lates_90_plus: ["90+ Day Lates (non-mortgage)", "Retards de 90+ jours (hors hypothèque)"],
  mortgage_lates: ["Mortgage Lates", "Retards hypothécaires"],
  closed_collections: ["Closed Collections", "Recouvrements fermés"],
  open_collections: ["Open Collections", "Recouvrements ouverts"],
  foreclosure: ["Foreclosure", "Saisie hypothécaire"],
  bankruptcy_closed_2y_plus: ["Bankruptcy (Discharged 2+ yrs)", "Faillite (libérée depuis 2+ ans)"],
  bankruptcy_closed_under_2y: ["Bankruptcy (Discharged < 2 yrs)", "Faillite (libérée depuis < 2 ans)"],
  active_bankruptcy: ["Active Bankruptcy", "Faillite active"],
  consumer_proposal_closed_2y_plus: ["Consumer Proposal (Completed 2+ yrs)", "Proposition de consommateur (complétée 2+ ans)"],
  consumer_proposal_closed_under_2y: ["Consumer Proposal (Completed < 2 yrs)", "Proposition de consommateur (complétée < 2 ans)"],
  active_consumer_proposal: ["Active Consumer Proposal", "Proposition de consommateur active"],
  repossession: ["Repossession", "Reprise de possession"],
  judgement: ["Judgement", "Jugement"],
  garnishment: ["Garnishment", "Saisie-arrêt"],
  tax_lien: ["Tax Lien", "Privilège fiscal"],
}

const INCOME_TYPE: Record<Enums["income_type"], Bi> = {
  salary_no_ot: ["Salary (no OT/Bonus)", "Salaire (sans heures supp./boni)"],
  hourly_no_ot: ["Hourly (Guaranteed hours, no OT/Bonus)", "Horaire (sans heures supp./boni)"],
  salary_hourly_with_ot_2y_avg: ["Salary/Hourly with OT (2y avg)", "Salaire/horaire avec heures supp. (moy. 2 ans)"],
  casual_seasonal_2y_avg: ["Casual/seasonal/part-time income (2y avg)", "Revenu occasionnel/saisonnier/à temps partiel (moy. 2 ans)"],
  commission: ["Commission", "Commission"],
  self_employed_full_doc: ["Self-Employed (Full Doc)", "Travailleur autonome (doc. complète)"],
  self_employed_stated: ["Self-Employed (Stated)", "Travailleur autonome (revenu déclaré)"],
  // Client 2026-07-22: keep BOTH, restoring the fuller Bubble wording that says what each one covers.
  passive_income: ["Passive Income (dividends/interest etc.)", "Revenu passif (dividendes/intérêts, etc.)"],
  passive_retired_income: [
    "Passive retired income (CPP/OAS/RRIF/Pension etc.)",
    "Revenu passif de retraite (RPC/SV/FERR/rente, etc.)",
  ],
  ccb_under_15: ["CCB (under 15 years old)", "ACE (moins de 15 ans)"],
  rental_income: ["Rental Income", "Revenu locatif"],
  child_support_alimony: ["Child Support/Alimony", "Pension alimentaire"],
  long_term_disability: ["Long-Term Disability", "Invalidité de longue durée"],
  short_term_disability: ["Short-Term Disability", "Invalidité de courte durée"],
  workers_comp: ["Workers' Compensation", "Indemnisation des accidentés du travail"],
  foreign_income: ["Foreign Income", "Revenu étranger"],
}

const RESIDENCY_STATUS: Record<Enums["residency_status"], Bi> = {
  canadian_citizen: ["Canadian Citizen", "Citoyen canadien"],
  permanent_resident: ["Permanent Resident", "Résident permanent"],
  work_permit_cuaet: ["Work Permit – CUAET", "Permis de travail – CUAET"],
  work_permit_non_cuaet: ["Work Permit – Non-CUAET", "Permis de travail – hors CUAET"],
}

const DOWN_PAYMENT_SOURCE: Record<Enums["down_payment_source"], Bi> = {
  seasoned_funds_3m: ["Seasoned Funds (3+ months)", "Fonds accumulés (3+ mois)"],
  fthb_rrsp_fhsa: ["FTHB RRSP/FHSA", "REER/CELIAPP (premier acheteur)"],
  gift_from_family: ["Gift from Family", "Don de la famille"],
  sale_of_existing_property: ["Sale of Existing Property", "Vente d'une propriété existante"],
  borrowed: ["Borrowed Downpayment", "Mise de fonds empruntée"],
  foreign_funds: ["Foreign Funds", "Fonds étrangers"],
  rent_to_own_credit: ["Rent-to-Own Credit", "Crédit location-achat"],
}

const PROVINCE: Record<Enums["province"], Bi> = {
  alberta: ["Alberta", "Alberta"],
  british_columbia: ["British Columbia", "Colombie-Britannique"],
  manitoba: ["Manitoba", "Manitoba"],
  new_brunswick: ["New Brunswick", "Nouveau-Brunswick"],
  newfoundland_and_labrador: ["Newfoundland and Labrador", "Terre-Neuve-et-Labrador"],
  northwest_territories: ["Northwest Territories", "Territoires du Nord-Ouest"],
  nova_scotia: ["Nova Scotia", "Nouvelle-Écosse"],
  nunavut: ["Nunavut", "Nunavut"],
  ontario: ["Ontario", "Ontario"],
  prince_edward_island: ["Prince Edward Island", "Île-du-Prince-Édouard"],
  quebec: ["Quebec", "Québec"],
  saskatchewan: ["Saskatchewan", "Saskatchewan"],
  yukon: ["Yukon", "Yukon"],
}

const LOCATION_TYPE: Record<Enums["location_type"], Bi> = {
  urban: ["Urban", "Urbain"],
  rural: ["Rural", "Rural"],
}

// Key order IS the dropdown order. The three RETIRED values sit at the end: they keep their labels so
// a historical deal still renders, but RETIRED_DWELLING_TYPES removes them from the options (client
// 2026-07-22 — "Hobby Farm"/"Recreational Property" were never dwelling types, they are the property
// checkboxes below; "Condo Apartment" was dropped in favour of the two Apartment entries).
const DWELLING_TYPE: Record<Enums["dwelling_type"], Bi> = {
  detached: ["Detached", "Isolée"],
  semi_detached: ["Semi-Detached", "Jumelée"],
  townhouse: ["Townhouse", "Maison en rangée"],
  condo_townhouse: ["Condo Townhouse", "Maison en rangée en copropriété"],
  duplex: ["Duplex", "Duplex"],
  duplex_detached: ["Duplex - Detached", "Duplex – isolé"],
  duplex_semi_detached: ["Duplex - Semi-Detached", "Duplex – jumelé"],
  triplex: ["Triplex", "Triplex"],
  fourplex: ["Fourplex", "Quadruplex"],
  apartment_low_rise: ["Apartment Low Rise", "Appartement – faible hauteur"],
  apartment_high_rise: ["Apartment High Rise", "Appartement – tour d'habitation"],
  mobile_home: ["Mobile Home", "Maison mobile"],
  modular_home: ["Modular Home", "Maison modulaire"],
  // ── retired: labelled for historical rows, never offered ──
  condo_apartment: ["Condo Apartment", "Appartement en copropriété"],
  farm: ["Hobby Farm", "Ferme d'agrément"],
  recreational: ["Recreational Property", "Propriété récréative"],
}

/** Dwelling types kept for historical rows but withdrawn from every picker (migration 51). */
const RETIRED_DWELLING_TYPES = new Set<Enums["dwelling_type"]>(["condo_apartment", "farm", "recreational"])

const DEAL_STATUS: Record<Enums["deal_status"], Bi> = {
  draft: ["Draft", "Brouillon"],
  submitted: ["Submitted", "Soumis"],
  offer_received: ["Offer Received", "Offre reçue"],
  accepted: ["Accepted", "Accepté"],
  confirmed: ["Confirmed", "Confirmé"],
  funded: ["Funded", "Financé"],
  expired: ["Expired", "Expiré"],
  cancelled: ["Cancelled", "Annulé"],
}

const FAQ_CATEGORY: Record<Enums["faq_category"], Bi> = {
  getting_started: ["Getting Started", "Pour commencer"],
  deals_and_offers: ["Deals & Offers", "Dossiers et offres"],
  rates_and_fees: ["Rates & Fees", "Taux et frais"],
  timelines_and_notifications: ["Timelines & Notifications", "Délais et notifications"],
  compliance_and_privacy: ["Compliance & Privacy", "Conformité et confidentialité"],
  support_and_account: ["Support & Account", "Soutien et compte"],
}

type DealCol = keyof Database["public"]["Tables"]["deals"]["Row"]

const DEAL_INFO_FLAG_TABLE: [DealCol, Bi][] = [
  ["fthb", ["First Time Home Buyer", "Premier acheteur"]],
  ["new_to_canada", ["New to Canada", "Nouvel arrivant au Canada"]],
  ["networth_program", ["Net Worth Program", "Programme valeur nette"]],
  ["medical_professional", ["Medical Professionals Program (Projected income)", "Programme professionnels de la santé (revenu prévisionnel)"]],
  ["collateral_transfer", ["Collateral Transfer", "Transfert collatéral"]],
  ["cashback", ["Cashback", "Remise en argent"]],
  ["bridge_loan_needed", ["Bridge Loan Needed", "Prêt-relais requis"]],
  ["purchase_plus_improvements", ["Purchase Plus Improvements", "Achat plus rénovations"]],
  ["first_and_heloc", ["1st and HELOC", "1re et marge hypothécaire"]],
  ["heloc", ["HELOC", "Marge hypothécaire (HELOC)"]],
  ["fixed_second", ["Fixed 2nd", "2e fixe"]],
  // E-6 (client 2026-07-30): "co-signor" → "Co-signer". LABELS only — the `cosignor_*` keys are DB
  // column names and also travel as literals in the `p_others_excluded` RPC protocol, so they stay.
  ["cosignor_occupying", ["Co-signer Occupying", "Cosignataire occupant"]],
  ["cosignor_not_occupying", ["Co-signer Not Occupying", "Cosignataire non occupant"]],
  ["guarantor", ["Guarantor", "Garant"]],
  // Round 3 Create Deal flags, replicated as lender filter criteria (migration 43).
  ["reverse_mortgage", ["Reverse Mortgage", "Hypothèque inversée"]],
  ["married_or_common_law", ["Married / Common Law", "Marié(e) / conjoint de fait"]],
  ["spouse_not_on_application", ["Spouse Not on Application", "Conjoint absent de la demande"]],
  ["transunion_being_used", ["TransUnion Being Used", "TransUnion utilisé"]],
]

const PROPERTY_FLAG_TABLE: [DealCol, Bi][] = [
  ["prequal", ["Prequal", "Préqualification"]],
  ["new_build", ["New Build", "Construction neuve"]],
  ["recreational_property", ["Recreational Property", "Propriété récréative"]],
  ["hobby_farm", ["Hobby Farm", "Ferme d'agrément"]],
  ["well_water", ["Well Water", "Eau de puits"]],
  ["septic", ["Septic", "Fosse septique"]],
]

// ── Builders ────────────────────────────────────────────────────────────────

function options<T extends string>(table: Record<T, Bi>, locale: Locale): Option<T>[] {
  return (Object.keys(table) as T[]).map((v) => ({ value: v, label: pick(table[v], locale) }))
}
function labelMapOf<T extends string>(table: Record<T, Bi>, locale: Locale): Record<T, string> {
  return Object.fromEntries((Object.keys(table) as T[]).map((v) => [v, pick(table[v], locale)])) as Record<T, string>
}
// Loose variant for the LABELS bundle — read-only lookups often index with a plain `string`.
function looseLabels<T extends string>(table: Record<T, Bi>, locale: Locale): Record<string, string> {
  return Object.fromEntries((Object.keys(table) as T[]).map((v) => [v, pick(table[v], locale)]))
}
function flagsOf(table: [DealCol, Bi][], locale: Locale): [DealCol, string][] {
  return table.map(([col, bi]) => [col, pick(bi, locale)])
}

const CACHE: Partial<Record<Locale, ReturnType<typeof build>>> = {}
function build(locale: Locale) {
  return {
    OCCUPANCY_OPTIONS: options(OCCUPANCY, locale),
    TRANSACTION_PURPOSE_OPTIONS: options(TRANSACTION_PURPOSE, locale),
    TRANSACTION_TYPE_OPTIONS: options(TRANSACTION_TYPE, locale),
    MORTGAGE_PRODUCT_OPTIONS: options(MORTGAGE_PRODUCT, locale),
    MORTGAGE_POSITION_OPTIONS: options(MORTGAGE_POSITION, locale),
    CREDIT_ISSUE_OPTIONS: options(CREDIT_ISSUE, locale),
    INCOME_TYPE_OPTIONS: options(INCOME_TYPE, locale),
    RESIDENCY_STATUS_OPTIONS: options(RESIDENCY_STATUS, locale),
    DOWN_PAYMENT_SOURCE_OPTIONS: options(DOWN_PAYMENT_SOURCE, locale),
    PROVINCE_OPTIONS: options(PROVINCE, locale),
    LOCATION_TYPE_OPTIONS: options(LOCATION_TYPE, locale),
    DWELLING_TYPE_OPTIONS: options(DWELLING_TYPE, locale).filter((o) => !RETIRED_DWELLING_TYPES.has(o.value)),
    LABELS: {
      occupancy: looseLabels(OCCUPANCY, locale),
      purpose: looseLabels(TRANSACTION_PURPOSE, locale),
      transaction_type: looseLabels(TRANSACTION_TYPE, locale),
      mortgage_product: looseLabels(MORTGAGE_PRODUCT, locale),
      mortgage_position: looseLabels(MORTGAGE_POSITION, locale),
      credit_issue: looseLabels(CREDIT_ISSUE, locale),
      income_type: looseLabels(INCOME_TYPE, locale),
      residency_status: looseLabels(RESIDENCY_STATUS, locale),
      down_payment_source: looseLabels(DOWN_PAYMENT_SOURCE, locale),
      province: looseLabels(PROVINCE, locale),
      location_type: looseLabels(LOCATION_TYPE, locale),
      dwelling_type: looseLabels(DWELLING_TYPE, locale),
    },
    DEAL_STATUS_LABEL: labelMapOf(DEAL_STATUS, locale),
    FAQ_CATEGORY_LABEL: labelMapOf(FAQ_CATEGORY, locale),
    DEAL_INFO_FLAGS: flagsOf(DEAL_INFO_FLAG_TABLE, locale),
    PROPERTY_FLAGS: flagsOf(PROPERTY_FLAG_TABLE, locale),
  }
}

/** Localized enum bundle (OPTIONS + LABEL maps + status/faq/flags). Cached per locale. */
export function getEnums(locale: Locale) {
  return (CACHE[locale] ??= build(locale))
}

// ── Back-compat static EN exports (server / un-migrated call sites) ─────────────
const EN = getEnums("en")
export const OCCUPANCY_OPTIONS = EN.OCCUPANCY_OPTIONS
export const TRANSACTION_PURPOSE_OPTIONS = EN.TRANSACTION_PURPOSE_OPTIONS
export const TRANSACTION_TYPE_OPTIONS = EN.TRANSACTION_TYPE_OPTIONS
export const MORTGAGE_PRODUCT_OPTIONS = EN.MORTGAGE_PRODUCT_OPTIONS
export const MORTGAGE_POSITION_OPTIONS = EN.MORTGAGE_POSITION_OPTIONS
export const CREDIT_ISSUE_OPTIONS = EN.CREDIT_ISSUE_OPTIONS
export const INCOME_TYPE_OPTIONS = EN.INCOME_TYPE_OPTIONS
export const RESIDENCY_STATUS_OPTIONS = EN.RESIDENCY_STATUS_OPTIONS
export const DOWN_PAYMENT_SOURCE_OPTIONS = EN.DOWN_PAYMENT_SOURCE_OPTIONS
export const PROVINCE_OPTIONS = EN.PROVINCE_OPTIONS
export const LOCATION_TYPE_OPTIONS = EN.LOCATION_TYPE_OPTIONS
export const DWELLING_TYPE_OPTIONS = EN.DWELLING_TYPE_OPTIONS
export const LABELS = EN.LABELS
export const DEAL_STATUS_LABEL = EN.DEAL_STATUS_LABEL
export const FAQ_CATEGORY_LABEL = EN.FAQ_CATEGORY_LABEL
export const DEAL_INFO_FLAGS = EN.DEAL_INFO_FLAGS
export const PROPERTY_FLAGS = EN.PROPERTY_FLAGS

/** FAQ category canonical display order (locale-independent). */
export const FAQ_CATEGORY_ORDER: Enums["faq_category"][] = [
  "getting_started",
  "deals_and_offers",
  "rates_and_fees",
  "timelines_and_notifications",
  "compliance_and_privacy",
  "support_and_account",
]
