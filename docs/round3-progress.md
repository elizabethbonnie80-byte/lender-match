# Round 3 — implementation progress

**Phase 1 (21 h): COMPLETE** as of 2026-07-13 — all 18 items landed, `pnpm check` green, full
`pnpm smoke:quick` suite green (20/20). New migrations: 36 (Create Deal schema fields + Credit
Issues/Down Payment Source junction tables), 37 (feed RPCs: multi-select columns + 2–14d Maturing
window), 38 (`make_offer` + `lender_fee_pct`), 39 (`profiles_brokerage_admin_read` RLS policy).

**Phase 2 (19 h): COMPLETE + LIVE ON PROD.** All 8 items landed. 6 buildable items as of 2026-07-15
(`pnpm check` green, full `pnpm smoke:quick` suite green 20/20 with functions served); the **rebrand +
domain-connect** items closed 2026-07-17 (rebrand = app-side flip to LenderMatch™; the client then supplied
the logo, so headers render a `BrandMark` [icon + text], the favicon package is wired, and the invoice PDF
carries the logo too; domain done at the infra level by the client). New migrations: 40 (edit submitted deal
until first offer + delete until accepted), 41 (`edit_offer`), 42 (one-step accept — `confirm_lender` dropped,
switch deletes the invoice + no lender notify), 43 (Round 3 fields as saved-filter criteria + filtered-feed
params). **Deployed to BOTH staging AND prod 2026-07-17**: staging Phase 2 smoke QA 5/5 green, then migrations
36–43 applied to prod (43/43, advisors 0 ERROR), `contact-us`/`invoice-pdf` deployed to prod, `staging`→`main`
merged → `www.lendermatch.ca` live on Phase 1+2. Post-deploy, a **browser (Chrome MCP) smoke QA on staging**
confirmed the Phase 2 UI end-to-end: broker Deal Room Edit/Delete matrix (Submitted→Edit+Delete, Offer
Received→Delete-only, Confirmed→neither), one-step accept dialog (identity reveal + invoice immediately, no
Confirm Lender), Create Deal Round 3 fields; lender Make Offer bps preview + Lender Fee % + product prefill,
Filters sidepanel new fields, switched→Declined (no "Switched" status), and the Edit Offer prefilled dialog.
The "Confirm signup" Auth email template lives in the Supabase dashboard, not in git; it was updated to
LenderMatch™ on both envs on 2026-07-22, closing the last manual rebrand step.

Tracks execution of `docs/LenderMatch_Round3_Change_Request.pdf` (Rev.3, firm 64 h, approved by the
client in writing on 2026-07-13). Update the checkboxes as items land; keep `CLAUDE.md`'s "Wired /
Still mock" lists in sync when a phase completes. Do not reorder phases — Phase 3 is sequenced last
because it's the highest-risk/most technical content (documents, AI matching, auto-offer, prequal).

## Phase 1 — Quick wins, field changes & alignment (21 h)

- [x] Rename First/Last Name → "Primary Borrower First/Last Name" (i18n only, `createDeal` namespace)
- [x] "Married or common law" checkbox + conditional "Is the spouse on the application?" (credit notes
      become mandatory if spouse not on application) — `deals.married_or_common_law` / `spouse_not_on_application`
- [x] "Reverse Mortgage" checkbox (Deal Information checkboxes) — `deals.reverse_mortgage`
- [x] "Total value of assets (liquid)" + "Total value of all assets" — required when Networth checked —
      `deals.assets_liquid_value` / `assets_total_value`
- [x] "How many titles are the doors on?" numeric input (after doors) — `deals.door_titles_count`
- [x] Credit Issues → checkboxes, multi-select junction table `deal_credit_issues` (the "Multiple" typo
      from the client's raw request doesn't exist in this rebuild — clean labels were written from the
      spec, not migrated from Bubble's misspelled display text, so there was nothing to fix here)
- [x] Down Payment Source → checkboxes (multi-select junction table `deal_down_payment_sources`;
      `borrowed_down_payment` boolean column dropped — folded into the source list as `'borrowed'`)
- [x] "TransUnion is being used" checkbox + note prompt — `deals.transunion_being_used`
- [x] Rename → "Foreign Income / Down Payment Country" (required on foreign funds OR foreign income)
- [x] Info (i) popups for GDS, TDS, and the 4 notes (client-provided copy, EN/FR)
- [x] Yukon / Northwest Territories / Nunavut — already present in the schema enum + `lib/enums.ts`
      from the initial build; nothing to do
- [x] Option-set alignment — Residency Status converted from forced single-select to true multi-select
      checkboxes (OQ#28), matching the already-multi-capable `deal_residency_statuses` junction table
- [x] "No lender exceptions required" checkbox (auto-checked when the 4 notes are empty — recomputed
      on note edits, so a resumed draft keeps its saved value; still user-togglable) —
      `deals.no_lender_exceptions_required`
- [x] "Lender Fee % if applicable" input (optional, one decimal, display-only) — `offers.lender_fee_pct`
      (migration 36) wired through `make_offer` (migration 38), the Make Offer dialog, and shown to the
      broker on deal-detail (accepted offer + pending offers list) when set
- [x] bps auto-deduct display + "Final Commission Amount" label + contract fine print — live preview in
      the Make Offer dialog via `platformBpsFor()` (`lib/queries/deals.ts`, mirrors SQL `platform_bps_for`)
- [x] Broker-admin field: which broker submitted the deal — `listBrokerDeals` no longer hardcoded
      `.eq('broker_id', self)`; a broker-admin now gets the whole brokerage's deals (RLS
      `deals_brokerage_admin` already allowed the read, the query just wasn't using it) with a new
      "Submitted By" column, backed by a new `profiles_brokerage_admin_read` RLS policy (migration 39)
- [x] Wire Contact-Us forms → support@lendermatch.ca + footer line — new `contact-us` edge function
      (Resend, mirrors `notify-email`'s provider call) + `lib/queries/contact.ts`; both Contact-Us pages
      (shared `components/contact-page.tsx`) submit for real now, with an "Or email support@lendermatch.ca"
      line. `lib/brand.ts` `SUPPORT_EMAIL` flipped to the real address now (this task, not the full
      rebrand) — `BRAND`/`DOMAIN` stay interim until their Phase 2 items land
- [x] List windows → New 0–1 / Maturing 2–14 / Expired 15+ (supersedes OQ#18) — `lib/age-windows.ts`
      constant + `maturing_deals_for_lender`/`maturing_deals_filtered` SQL window (migration 37)

## Phase 2 — Standard features, acceptance rework & rebrand (19 h)

- [x] Broker can edit a submitted deal until it has an offer — migration 40
      (`deals_broker_update_submitted_no_offers` + `deal_has_offers()` helper); Deal Room "Edit" action →
      `/create-deal?edit=<id>`, wizard edit mode saves via `updateSubmittedDeal` (status untouched, deal
      number kept; Save Draft hidden). Covered in `smoke-delete-draft`.
- [x] Submissions/drafts deletable until an offer is accepted (auto-remove from lender portal if submitted)
      — migration 40 (`deals_broker_delete_unaccepted` replaces the draft-only policy; offers/chats cascade);
      `deleteDeal` replaces `deleteDraft`, Deal Room Delete action for draft/submitted/offer_received with
      per-case dialog copy.
- [x] Offer entry prefill (deal/filter values) + remember-last-response (comments always cleared) — the
      shared MakeOfferDialog seeds the product from the target deal (single-target) and the rest from the
      lender's remembered last offer (`ll_last_offer` in localStorage, saved on each successful send;
      comments never remembered).
- [x] Offers editable until accepted; notify broker on edit — migration 41 (`edit_offer` RPC, pending-only,
      anti-contact re-scan, identity-safe broker notification); "Edit Offer" action on Submitted Offers
      reuses MakeOfferDialog in edit mode. Covered in `smoke-offers`.
- [x] Remove "Confirm Lender": Accept = reveal lender + create invoice + confirm in lender portal, one step
      (supersedes OQ#21). Switch cancels/deletes the invoice + marks portal "Declined" (no lender notify).
      — migration 42 (`accept_offer(uuid)` one-step, `confirm_lender` dropped, `switch_offer` deletes the
      invoice [paid invoice blocks] + notifies no one); deal-detail loses the Confirm button (Switch stays
      until funded/paid), the lender portal maps `switched` → "Declined". Covered in
      `smoke-offers`/`smoke-switch`.
- [x] Replicate all new Create Deal fields in the lender filter section — migration 43 (`saved_filters`
      columns + `saved_filter_matches` + trailing params on `open_deals_filtered`/`maturing_deals_filtered`);
      Filters sidepanel gains Credit Issues + Down Payment Source exclusion grids, the 4 new "Others" flags,
      liquid/total asset minimums, max door titles, and a "no exceptions only" checkbox — saved-filter chips
      created from the panel enforce them too. Covered in `smoke-open-filtered`.
- [x] Rebrand Loan Link → LenderMatch™ across app + emails (2026-07-17) — `lib/brand.ts` `BRAND` →
      "LenderMatch™" + `DOMAIN` → "lendermatch.ca"; `invoice-pdf` edge fn `BRAND`; `confirmation.html`
      Auth email template. The wordmark is TEXT (headers render `{BRAND}`; `public/placeholder-logo.*` is
      unused), so no logo asset was required. An optional image logo can be added later if the client
      supplies one. ⚠️ Hosted: redeploy `invoice-pdf`; mirror the Confirm-signup template in each
      Supabase dashboard (Auth → Email Templates).
- [x] Connect lendermatch.ca domain — done at the infra level (Vercel domain + Supabase Auth redirect URLs;
      confirmed by the client). The app-side `DOMAIN` constant flipped with the rebrand above.

**Phase 3 (24 h): all 5 items COMPLETE on `dev`** (2026-07-21) — `pnpm check` green, `pnpm build` green,
full smoke suite green (23/23 with the edge runtime served). New migrations: 45 (documents), 46 (AI
name-match), 47 (auto-offers), 48 (prequal → live deal), 49 (feed RPCs expose `prequal`), 50 (login
logos).

**Phase 3 is LIVE ON STAGING *AND* PROD (2026-07-22)** — `staging.lendermatch.ca` and
`www.lendermatch.ca`, main/staging/dev in sync. Migrations applied to both (**51/51**, advisors 0 ERROR),
`match-document-name` + `purge-documents` deployed and `notify-email` + `invoice-pdf` redeployed on both,
`APP_URL` secret set and `purge_documents_url` added to Vault on both (7 cron jobs active each).
**Round 3 is complete.**

**Staging browser QA (2026-07-22)** — verified end to end, not just by inspection:
- **Logos**: upload / rename / reorder / hide / delete; the marquee renders on `/sign-in` and shows only
  ACTIVE rows. Bucket check from an unauthenticated client: `lender-logos` image **200**,
  `deal-documents` **400** — public and private exactly where they should be.
- **Documents + AI name-match**: submit blocked with the two cards red until both PDFs are attached;
  Claude read both — consent "Maria Gonzalez" → verified, photo ID "Mary Gonzalez" → **variance**, and
  the resulting invoice carried `client_name` "Maria Gonzalez" + `document_name` "Mary Gonzalez".
- **Prequal**: submitted with NO address and NO closing date; accepting was refused ("Move this prequal
  to a live deal…"); conversion kept the existing offer, notified the bidding lender **without the
  address**; accepting afterwards revealed the lender + invoiced 5 bps × $450k = $225, due = closing+21.
- **Auto-offers**: created from lender Settings with the net-bps preview (45 → 40 net); left paused.

Defects found and fixed during that pass (each its own commit):
1. the prequal path was **unreachable** in the wizard — see the item below;
2. `fix(offers)` — the bps-deduction banner put three spans on one flex row, so when the fee label
   wrapped the deduction and the total collapsed into each other. Now two label/amount rows, in BOTH
   places that render it (Make Offer dialog + auto-offer editor);
3. `fix(deal-detail)` — the closing date rendered **one day early** (`DATE` column → `new Date()` parses
   it as UTC midnight → previous day in every Canadian timezone). Date-only strings are now pinned to
   local noon before formatting, matching `lender/invoices`' `fmtDay`; deal-detail was the only place
   in the app doing this;
4. `fix(sign-in)` — the **logo strip never filled the strip**: the track always held the list twice and
   translated -50%, which is only seamless once ONE pass is as wide as the strip, so a short list sat
   against the left edge and then drifted off it. It now measures and either centres a short list or
   scrolls a long one. Two follow-ups on the same fix, both worth remembering: the centred row must not
   `flex-wrap` (a wrapping row always fits, so the measurement could never observe an overflow and the
   marquee would have been dead for long lists), and the measurement must not lean on `ResizeObserver`
   alone — each image re-measures on load, because the first synchronous measure can land before the
   images have any width. ⚠️ **The switch INTO scrolling was never observed in the automated browser**:
   the driven tab reports `visibilityState: "hidden"`, and browsers deliver neither rAF nor
   ResizeObserver callbacks there. Confirm it in a visible window (a narrow viewport overflows the
   6 staging logos);
5. `fix(ui)` — **hover states**. `--accent` is a strong blue, so a highlighted menu row is a solid blue
   bar: the red "Cancel" label and the green "Mark as paid" icon both stayed their own colour on top of
   it, and a select trigger showing its placeholder kept grey text there. See the ⚠️ note under
   Conventions → UI in `CLAUDE.md`; the rule is to re-state colour for the hover state, and to check
   hover rather than only the resting state.

## Phase 3 — Heavy features (24 h)

- [x] Document upload (consent PDF + photo ID) on the Property step; 120-day retention then auto-delete;
      deal → Draft if either is missing — migration 45 (`deal_documents` table + RLS [owner/admin/brokerage-admin
      read, never lenders] + private `deal-documents` bucket + object policies + `submit_deal` two-document
      gate + `purge_expired_documents` cron). `purge-documents` edge fn does the physical delete (Storage SDK)
      120 days after `closing_date`, cron-invoked via pg_net (Vault-config, fail-safe OFF until configured).
      Client: `lib/queries/deal-documents.ts` + upload/view/remove widgets on the Create Deal Property step
      (first upload auto-persists the draft); section incomplete + Submit gated until both present. i18n EN/FR.
- [x] AI name-match: document name vs Primary Borrower First+Last; show both names on invoice on variance —
      migration 46 (`deal_documents.extracted_name`/`name_matches`/`name_variance`/`checked_at` +
      `invoices.document_name`; `accept_offer` stamps the variance name onto the invoice, photo-ID preferred).
      `match-document-name` edge fn (Claude vision reads the name, nickname-tolerant same-person check, stamps
      the row) — advisory, never blocks submit; fail-open without the AI key. Client calls it after upload +
      shows a per-doc badge (verified / variance / mismatch); the invoice PDF renders a "Name on document" row
      on variance, and the lender invoices page shows a "Name variance" badge. Verified e2e (Maria→Mary → both
      names on invoice). ⚠️ Smokes updated: `submit_deal` now needs both docs — smoke-offers/slice/anti-contact
      attach `deal_documents` first (+ shared `attachDealDocuments` helper). Suite 18/20 (invoice-pdf red =
      local edge-runtime npm DNS; password-reset red = Kong stale-route flake — both pre-existing/env).
- [x] Auto-offer engine: saved standard offers per product; auto-send only when deal matches ALL of a
      saved filter AND all 4 notes empty AND "no exceptions" checked; never on blocked brokerages; daily
      confirmation email w/ edit link; optional end date; edit/delete; no daily cap — migration 47
      (`auto_offers` table + RLS [owner write, admin read] + `deal_allows_auto_offer` + `send_auto_offers`,
      called from `submit_deal`; `offers.is_auto`/`auto_offer_id`; `auto_offer_sent` notification type +
      the daily `auto_offer_digest` cron → the existing notifications→Resend channel, `notify-email` appends
      the Submitted Offers edit link when `APP_URL` is set). Guardrails beyond the spec: never a second
      offer from the same lender on one deal, never for an unapproved lender, and the OQ#25 penalty windows
      still apply. NO comments field on an auto-offer — offer comments hit the anti-contact trigger and the
      insert runs inside the BROKER's submit transaction, so stored text could block someone else's
      submission; the lender adds comments afterwards via Edit Offer. Client: `lib/queries/auto-offers.ts`
      + `components/auto-offer-manager.tsx` (lender Settings section, with the same bps-deduction preview
      as Make Offer), an "Auto" badge on Submitted Offers, i18n EN/FR. Covered by `smoke-auto-offer` (22
      checks incl. every negative gate); suite 20/21 (invoice-pdf red = local edge runtime not served).
- [x] Prequal → Live Deal flow: upload prequal, lenders bid w/ special fine print, "Move to Live Deal"
      button adds address/closing/COF, existing offers carry over, no marketplace re-entry — migration 48
      (`deals.prequal_converted_at`; `convert_prequal_to_live(deal, address, closing, cof)` SECURITY DEFINER
      [owner-gated, one-shot, notifies the bidding lenders via the new `prequal_converted` type without
      leaking the address]; **no re-entry** folded into `lender_can_see_deal` — a converted deal stays
      visible ONLY to lenders that already bid, which covers the feeds, the make_offer guard and chat in
      one place) + migration 49 (the four feed RPCs gain a `prequal` OUT column so the lender UI can tell a
      prequal apart). Two guards fall out of it: **no property address ⇒ the deal can only be submitted as
      a prequal** (OQ#41 / client feedback #7 — closes that item) and **an offer cannot be accepted while
      the deal is an unconverted prequal** (the invoice needs a closing date). Client: Deal Room "Move to
      Live Deal" action + dialog (address/closing/COF) and a Prequal badge, the wizard makes the closing
      date optional and the address required-unless-prequal, the New Deals card badges prequals and the
      Make Offer dialog shows the prequal fine print. i18n EN/FR. Covered by `smoke-prequal`
      (27 checks); suite 22/22 green.
      **Client answers (2026-07-27, migration 52):** the fine print moved — nothing is shown to the
      LENDER any more, and the client's exact copy is shown to the BROKER when they view the offers. And
      a prequal now expires **for lenders only** (15 days off the queues, active for the broker until
      they delete it), with document retention reworked to cover a prequal's missing closing date. See
      `docs/client-revisions-2026-07-27.md`.
      **QA fix (2026-07-22):** the "Pre-Qualification" checkbox was sitting in the Property step's
      characteristics grid (step 4) while the closing-date requirement it waives is on the **Deal** step
      (step 2) — and `advanceTo` blocks Next until the current step is complete, so a broker could not
      reach the checkbox without first typing a closing date, i.e. the prequal path was unreachable in the
      normal flow. The checkbox now lives on the Deal step above the dates (with a hint), the closing date
      drops its red `*` + inline error while it is checked, and the address error points at the Deal step.
      Also badged prequals on the **Maturing** cards (New Deals already did).
- [x] Scrolling lender logos on the login page + admin way to add more — migration 50 (`lender_logos`
      table + a PUBLIC `lender-logos` Storage bucket; ACTIVE rows are **anon-readable** because the login
      page is unauthenticated — same rationale as the published legal docs and the sign-up org dropdowns —
      while every write, on the table and on the bucket objects, is `is_admin()`-only). Client:
      `components/logo-marquee.tsx` (CSS marquee in `globals.css` — the track holds the list twice and
      translates -50% for a seamless loop, pauses on hover, holds still under `prefers-reduced-motion`,
      and renders NOTHING until a logo exists) on `/sign-in`, plus **`/admin/logos`** (upload, rename,
      show/hide, reorder with ↑/↓, delete — deleting removes the image too) under the admin Content group.
      `lib/queries/logos.ts` builds image URLs with `getPublicUrl` (a signed URL would expire on a public
      page). i18n EN/FR. Covered by `smoke-logos` (15 checks — the anon/admin asymmetry: anon reads active
      rows only and cannot write, a broker cannot rename/delete, admin sees hidden rows and reorders).

## Removed from scope (per client — do not build)

- Auto-block group (Merix / RMG / MCAP)
- "Declined before" lender-institution dropdown in Create Deal

## Blockers / needs client input

**None.** The last two open questions were answered by the client on **2026-07-27** and implemented in
**migration 52** — see `docs/client-revisions-2026-07-27.md` for the full record. In short:

- **Prequal fine print — ANSWERED.** *"Here is the verbiage for brokers when they view an offer. There
  is nothing different for a lender when they're sending an offer on a prequal."* So the banner was
  **removed** from the lender's Make Offer dialog (our invented copy, `makeOffer.prequalFinePrint`,
  deleted from both catalogs) and the client's exact wording now renders for the **broker** on
  `/deal-detail/[id]` above the offers list (`dealDetail.prequalOfferNotice`, EN + FR).
- **Do prequals expire — ANSWERED, and it is a split rule.** *"Prequals should expire for the lenders
  but not for the brokers… only 15 days on the lender queues but the file should stay active for the
  broker until they delete it."* A prequal therefore **never reaches status `expired`**; it drops off
  the lender side through `lender_can_see_deal` instead. Documents: 120 days after the closing date,
  **or 120 days after upload when there is no closing date**, with a hard 240-day ceiling.
