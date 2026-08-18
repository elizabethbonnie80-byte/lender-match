# Round 4 — change request, estimate & schedule (working doc)

**Status: NOT QUOTED TO THE CLIENT YET.** This is the internal inventory + sizing that the client-facing
proposal is built from. Nothing here is approved and nothing is in progress.

## Sources

| Date | From | Content | Where |
|---|---|---|---|
| 2026-08-04 | Elizabeth | Answers to the two open suspension questions (E-8) | email, quoted in §4 |
| 2026-08-17 | Bonnie (fwd Ivan, 14:05) | "Next updates" — 18 numbered feature requests | Gmail `subject:"Next updates"` |
| 2026-08-17 | Bonnie, attachment | `Document requirements.docx` → conditional document list | `docs/Document_requirements_2026-08-17.docx` |
| 2026-08-17 | Elizabeth | SendGrid + survey wording + Net Worth annual income + lender min-income filter | email, quoted in §3 |
| 2026-08-18 | client | Invoice template editing confirmed into this update, **plus sales tax per province/territory** | email, quoted in §8 |
| earlier | — | B-30 (admin-editable invoice templates) — conceded new, never quoted | `docs/client-revisions-2026-07-28.md` §B-30 |
| earlier | — | E-8 (enforceable suspension) — flagged 2026-07-31 as a second item to quote | `docs/client-revisions-2026-07-30.md` §E-8 |

Everything shipped through 2026-08-11 (batch I) is live on staging + prod, 66/66 migrations. Round 4
starts from that baseline.

---

## 1. Headline

**88 hours**, delivered in 5 phases, **2 weeks** at ~44 h/week. Round 3 was 64 h for comparison, and this
batch is materially bigger: it adds four genuinely new subsystems (rental-income qualification, the
document-requirements engine, AI lender notes, sales tax on invoicing) on top of ~25 field/label changes.

Two items are **not** in the 88 h because they cannot be quoted responsibly yet — realtor.ca scraping
(§7.2) and revealing declining lenders to the broker (§7.1). Both are flagged, both need a client answer.

| Phase | Focus | Hours |
|---|---|---|
| 1 | Create Deal fields, labels & lender-filter replication | 14 |
| 2 | Email provider, per-brokerage bps & marketplace rules | 18 |
| 3 | Suspensions & Resources (blog) | 15 |
| 4 | Rental-income module & document-requirements engine | 17 |
| 5 | AI lender notes, invoice template & sales tax | 19 |
| — | Cross-cutting QA, migrations, staging→prod deploys | 5 |
| **Total** | | **88 h** |

---

## 2. Bonnie's 18 items — sized

Numbering follows the order in her email. `J-n` is the Round 4 item id used from here on.

### J-1 · Property-tax preference checkboxes — **1 h**
Two checkboxes in the Property section ("client does NOT want the lender to pay property taxes" / "client
wants the lender to pay property taxes") + a lender filter to exclude either.
2 boolean columns, form + i18n, filter exclusion flags (the `p_others_excluded` key-list pattern from
migration 43).
⚠️ The two are mutually exclusive in reality. Radio-vs-checkbox is a client decision — see §7.3.

### J-2 · "HoldCo on title" checkbox (Property section) — **0.25 h**
New boolean. Also a precondition for two document-checklist rules (§5).

### J-3 · "Spousal buyout" + "Refinance plus improvements" checkboxes (Deal Information) — **0.5 h**
Two new booleans alongside Reverse Mortgage / FTHB in `DEAL_INFO_FLAG_TABLE`. Also preconditions for the
document checklist. Neither exists today (verified: 0 references in `lib/`, `app/`, `supabase/`).

### J-4 · Rename "First-Time Buyer" → "First Time Home Buyer" — **0.25 h**
⚠️ Two places × two locales: `lib/enums.ts` `DEAL_INFO_FLAG_TABLE` **and** `messages/{en,fr}.json`. This is
the known duplication trap (CLAUDE.md → i18n) — `pnpm check` does not catch a stale label.

### J-5 · "Foster Care Income" income type — **0.5 h**
New `income_type` enum value + junction handling + filter arrays + the doc-checklist rule. Enum values are
additive-only, so no data migration.

### J-6 · "Condo conversion" dwelling type — **0.5 h**
New `dwelling_type` value + the filter exclusion array (migration 56 pattern).
⚠️ Interacts with the retired `condo_apartment` / `farm` / `recreational` values — the checklist's "property
type is a condo" rule (§5) has to cover condo_townhouse + both apartment tiers + condo conversion.

### J-7 · TDS checkbox "child support or alimony payments are included in the TDS ratios" — **0.5 h**
Under GDS/TDS. Explicitly **no** lender filter. Also drives a doc-checklist rule.

### J-8 · Per-brokerage platform bps in the admin portal — **4.5 h**
Today `platform_bps_for(product)` is a single global 3/4/5 schedule, called from **4 SQL sites**
(`create_invoice`, the invoice RPC, migration 42's `accept_offer`, migration 46's variant) and mirrored
client-side in `platformBpsFor` for the "Final Commission Amount" preview. Per-brokerage means: an override
column/table on `brokerages`, threading the brokerage through every call site, the client mirror reading the
deal's brokerage, an admin editor on `/admin/organizations`, and a smoke.
"Automatically affect all future invoices" = the override is read at invoice-creation time, existing
invoices untouched. ⚠️ Open: one flat override, or a full per-term 3/4/5 triple? See §7.4.

### J-9 · Show the broker which lenders declined, after 2 days with zero matches — **3 h, BLOCKED**
⚠️ **This breaks the platform's core invariant** (identities hidden until acceptance — CLAUDE.md → Security
invariants #1). `deal_declines` already stores who declined; surfacing the institution name to the broker
pre-acceptance is a deliberate reversal of the product's central rule, not an implementation detail.
Not included in the 88 h. See §7.1.

### J-10 · Down-payment section conditional on purpose — **1.25 h**
Hide "Source of down payment" + "Down payment notes" when purpose is Refinance or Renewal; show on Purchase.
Label "Foreign Income / Down Payment Country" collapses to "Foreign Income" on refi/renewal.
Includes: validation must not demand hidden fields, and edit-mode on an existing deal must not silently drop
values already captured.

### J-11 · Mobile home → year built + CSA seal (+ lender filters) — **1.25 h**
Conditional numeric "year built" + "Has CSA seal?" checkbox when dwelling type is mobile home. Lender side
gets a MIN criterion (oldest year built accepted) and an exclusion (no CSA seal).
⚠️ The MIN/MAX null-safety rule from migration 54 applies — a deal with no year built must not silently
disappear from every lender who set the criterion.

### J-12 · Broker suspension — **see §4, quoted there**
Bonnie's item 8 and Elizabeth's 2026-08-04 answer are the same feature; sized once in §4.

### J-13 · Label changes + work-permit warning — **0.75 h**
- "Medical Professional" → "Medical Professionals Program (Projected income)"
- "Hourly (no OT/Bonus)" → "Hourly (Guaranteed hours, no OT/Bonus)"
- "Networth Program" → "Net Worth Program"
- New red note under either work-permit checkbox: *"Ensure 183 days left on the work permit from the closing
  date of the loan"*

⚠️ Same duplication trap as J-4, three times over: `medical_professional` and `networth_program` each appear
in `lib/enums.ts` **and** `messages/en.json` (`createDeal.medicalProfessional`, `createDeal.networthProgram`),
and every one needs its FR pair. This is why a "rename 3 labels" line is three quarters of an hour rather
than fifteen minutes — the renames are trivial, finding all four copies of each is not.

### J-14 · Declined-before lender dropdown + RMG/MERIX/MCAP auto-block — **5 h**
The item **deferred out of Round 3** (§1.2 of that proposal), now back. Full scope:
- lender-institution dropdown after the "previously declined" checkbox, populated from the same list the
  sign-up page uses;
- required **unless** the new "Lender not shown" checkbox is ticked;
- the selected institution must not see the deal → a new exclusion table + a clause in
  `lender_can_see_deal` (which covers the 4 feeds, the `make_offer` guard and chat in one place);
- the owned-group rule: selecting RMG, MERIX or MCAP hides the deal from **all three**. Built as an
  admin-editable institution-group table, not three hardcoded names — they will not be the last group.

### J-15 · Lender first-login "set your filters" popup — **1.25 h**
Modal on the lender landing page with a "Set Filters Now" button routing to the filters tab; stops appearing
once the lender has ≥ 1 saved filter.
Note: the app already mounts one non-dismissable modal (the legal re-agreement gate). This one is
conditional and self-terminating, so it does not repeat the pattern we pushed back on in E-7.

### J-16 · "Select Lender" label on the create-account page — **0.25 h**

### J-17 · "Not on the list? Email us at support@lendermatch.ca" under both sign-up dropdowns — **0.25 h**

### J-18 · AI-generated lender notes on acceptance — **6.5 h** (+ realtor.ca, see §7.2)
A Claude edge function that composes the broker's hand-off notes from the deal record, in her 11 fixed
sections, in order, folding the broker's own notes into the matching section, with her disclaimer above and
the fixed closing paragraph that must not be AI-edited. Delivered on the deal page **only after an offer is
accepted**, with a copy-to-clipboard control.
Sizing: prompt + section engine + deterministic ordering 4 h · UI, copy control, disclaimer 1.5 h · guardrails
so the model cannot invent facts not in the record 0.5 h · QA across deal shapes 0.5 h.
The edge-function pattern is established (`anti-contact`, `match-document-name`) — this is a prompt and a
renderer, not new plumbing.
⚠️ The realtor.ca scraping half is **excluded** — §7.2.

### J-19 · Document-requirements list — **8 h**, see §5

### J-20 · Resources / blog — **6.5 h**
New `resources` table + RLS (admin writes, brokers and lenders read), the existing Tiptap editor reused in
the admin portal, list + detail pages in both portals, and a "Resources" nav item in the broker and lender
headers.
⚠️ **The nav item is not free.** The headers are three-tier with thresholds measured in French
(lender full ≥1350px, broker ≥1120px, sheet below 1024px — G-1b). Adding a link changes the arithmetic and
the tiers have to be re-measured in FR, or the lender nav overflows again.
Sizing: DB + RLS 1 h · admin editor 1.5 h · portal pages 2 h · header re-measure EN+FR 1.5 h · QA 0.5 h.
The editor and the sanitize-on-write boundary already exist from `/admin/legal`, and `legal_documents` is a
working template for the table + RLS + publish flow. ⚠️ **The header re-measure stays at 1.5 h** — that cost
is measured, not guessed (G-1b), and it is what stops the lender nav overflowing in French again.

### J-21 · One offer per lender institution — **2 h**
Today the guard is per **user**; two colleagues at the same institution can each bid. Change: the guard and
the "hide deals I already offered on" clause in the four feed RPCs move from `lender_id` to
`lender_institution_id`.
⚠️ Open: does a **decline** by one colleague also remove the deal for the others? Not stated. See §7.5.

### J-22 · Rental-income module — **9 h**, see §6

---

## 3. Elizabeth's 2026-08-17 email

### J-23 · SendGrid migration — **6.5 h**
**Her question, answered:** yes for the app's own notification emails; **no** for the account emails.

- The 12 notification emails (`notify-email` edge function) can absolutely move to SendGrid **dynamic
  templates** — Bonnie and Elizabeth author each template in SendGrid, we store the template id per
  notification type and send structured data instead of a body. That is the good version of what she asked
  for, and it means future copy edits need no deploy.
- The **account** emails (signup confirmation, password reset, email change) are sent by Supabase Auth, not
  by us. Supabase Auth renders **its own** templates and can only use SendGrid as an SMTP relay — it cannot
  call a SendGrid dynamic template. Those stay editable in the Supabase dashboard, as today.
- ⚠️ **The API key is in the wrong place.** `SENDGRID_API_KEY` was added to **Vercel** environment
  variables, but the email is sent from a **Supabase edge function**, which never sees Vercel's env. It has
  to be set as a Supabase secret (`supabase secrets set`) on staging and prod. The Vercel copy is inert.
- Also required: SendGrid domain authentication DNS records, and a sender identity matching `NOTIFY_FROM`.

Sizing: rework `notify-email` + `contact-us` onto the SendGrid API 2.5 h · template-id mapping + per-type
dynamic data 1.5 h · Auth SMTP switch + template check 1.5 h · deploy and verify both environments 0.5 h ·
the template-authoring guide 0.5 h (a section in the handover doc, not a separate deliverable).
`notify-email` is 103 lines and the send is a single fetch — the work is the mapping, not the rewrite.

### J-24 · Closing-survey wording — **0.25 h**
"Was the commitment issued on time?" → "…within the quoted timeframe?" and the same for the document-review
question. `messages/en.json` `survey.qCommitment` / `qDocReview` + the FR pair.
Note: these are the two questions the **rating penalty** keys off (migration 59). Wording only — the trigger
is unchanged.

### J-25 · Net Worth Program → "Annual Income" input — **0.5 h**
Shown when Net Worth Program is checked, with the note *"Minimum income requirements for Net Worth programs
vary by lender."* Dollar amount.

### J-26 · Lender filter "Minimum income required for Net Worth Program" — **1.25 h**
A MIN criterion on `saved_filters`, enforced in `saved_filter_matches` **and** threaded through
`open_deals_filtered` / `maturing_deals_filtered`.
Her rule maps cleanly onto the existing null-safe pattern: if the lender left it empty the criterion does not
restrict anything; if set, the deal's annual income must meet or exceed it.
⚠️ Two things to get right, both of which have bitten this codebase before:
- a deal where the broker left annual income empty must not vanish for every lender who set a minimum
  (migration 54, the MAX-criterion bug, same shape);
- the criterion should only apply to deals that actually have Net Worth Program checked.

---

## 4. Suspensions (Bonnie item 8 + Elizabeth 2026-08-04) — **8.5 h**

Her 2026-08-04 answer settles the question we flagged in E-8 — what happens to live deals and offers.

**Lender suspension.** *"prevented from making offers on any deal with a closing date within 45 days or a COF
date within 14 days… should not be displayed to the suspended lender."*

⚠️ **That is exactly what the platform already does to a penalized lender.** `lender_can_see_deal` +
`penalty_settings` (45 d / 14 d, admin-configurable) is the rating-penalty effect built in migrations 23/26.
So lender "suspension" is not a new mechanism — it is a **manually triggered** version of an existing one,
which is why this line is 10 h and not 20. What is new is the manual control, the audit trail, and keeping
the two flags distinct so lifting a manual suspension does not clear a rating penalty the lender genuinely
earned (the same reasoning as the E-11 master switch vs `auto_offers.is_active`).

**Broker suspension.** *"all live and new deals to be invisible to lenders so that no offers can be
made/received until the suspension is over"*, triggered manually or by *"more than 2 attempts to share
contact info with a lender prior to accepting an offer"* — Bonnie's version says 3 separate messages.

Scope:
- `profiles` gains suspension state (active, until, reason, who set it) plus an append-only
  `suspension_events` table so "when did they get suspended" is answerable — she asked for that explicitly;
- broker effect: a clause in `lender_can_see_deal` hiding every deal owned by a suspended broker, plus a
  block in `submit_deal`;
- lender effect: reuse the penalty windows, driven by the suspension flag;
- auto-trigger: count anti-contact hits per broker from `admin_alerts` (already written by `scan_and_log`)
  and suspend on the third;
- admin UI: suspend / reinstate from `/admin/brokers` and the lender list, with reason, end date and history;
- notifications to the suspended party.

Sizing: DB + visibility clauses 2.5 h · auto-trigger 2 h · admin UI + history 2 h · notifications + copy 0.5 h ·
smokes 1.5 h. The admin screens reuse `RowActions` and the existing `/admin/brokers` + lender-approvals tables.

⚠️ Open questions in §7.6 — duration, counting window, and what happens to a suspended broker's *accepted*
deals mid-flight.

---

## 5. Document-requirements engine (the attachment) — **8 h**

`docs/Document_requirements_2026-08-17.docx`, extracted and read in full: a pop-up after **submission** (not
on drafts) listing the documents an underwriter will likely ask for, derived from what the broker entered.
~35 conditional rules over ~120 content lines, plus 4 fixed intro paragraphs and an "all deals" baseline.

**The rules depend on fields that do not exist yet.** Verified against the schema — every one of these
returns zero references today:

| Rule condition | Status |
|---|---|
| HoldCo | needs J-2 |
| Spousal buyout | needs J-3 |
| Refinance plus improvements | needs J-3 |
| Foster care income | needs J-5 |
| Child support/alimony included in TDS | needs J-7 |
| Condo (for the refi/renewal HOA rule) | needs J-6 to be handled with the retired condo values |

So **J-19 cannot ship before Phase 1.** That dependency drives the phase order.

Everything else it keys off already exists: purpose, transaction type, dwelling type, LTV, married/spouse,
reverse mortgage, cosigner/guarantor, bridge loan, medical professional, net worth, new to Canada, purchase
plus improvements, the income-type junction, the residency junction, the down-payment-source junction, and
the credit-issue junction.

Sizing: rules engine + field mapping 2.5 h · pop-up, re-open from the Deal Room, print/copy 1.5 h · content
structuring 2 h · **FR translation 2 h** · QA rides the cross-cutting line.
The engine is small because the rules are **declarative** — a table of {condition, lines}, not 35 hand-written
branches. The cost here is content entry and translation, not logic.

⚠️ **The French is a real cost, not a rounding error** — ~1,300 words of Canadian mortgage-underwriting
vocabulary (NOA, T1 General, economic rent, gross-up, CSA seal). Every user-facing string in this app is
bilingual by convention. Options: we translate (the 2 h above), Bonnie supplies the FR text (drop to 0.5 h),
or this one screen ships EN-only as a documented exception. §7.7.

---

## 6. Rental-income module — **9 h**

Her longest item, and the most structurally new. When "rental income" is checked, a sub-form opens:
- three categories (owner-occupied with suite / subject rental / non-subject rental), any combination;
- total income including rental;
- per category, a variant that depends on **transaction type** — prime uses 39/44 ratios, alt / private /
  *not specified* uses 55/55 (note it explicitly covers the untyped case, which is E-5's optional
  transaction type — good, that lines up with what we shipped);
- owner-occupied adds legal / non-legal suite and the "excluding taxes and heat" column;
- addback vs offset, four percentage tiers, and a per-category amount;
- a **cascade**: checking 50 % auto-checks 80/90/100, and so on down the ladder, independently for the
  "excluding taxes and heat" column.

Lender side: a max % for addback and a separate max % for offset, plus a taxes-and-heat exclusion checkbox,
matched against the scenarios the broker checked.

Sizing: data model (`deal_rental_details` + a scenario junction) + form + cascade 5.5 h · lender criteria +
matching + threading through the feed RPCs 2.5 h · QA 1 h.
⚠️ **This is the one line not to cut further.** The matching rule is unspecified (§7.8), and trimming hours
off a rule nobody has written down is guessing, not estimating.

⚠️ The matching semantics are **not** stated and cannot be assumed — §7.8.

---

## 7. Open questions — need a client answer before these are firm

**7.1 · J-9 breaks the anonymity invariant.** Showing the broker which lenders declined reveals lender
identity before acceptance. The whole platform — RLS, the feeds, the notification bodies, the chat
anonymization — is built around that not happening. We should ask whether she wants (a) the actual
institution names, accepting the reversal, (b) a count only ("4 lenders reviewed and passed"), or (c) names
released only after the deal closes. Also, "no matches in 2 days" is ambiguous: zero *offers*, or zero
*filter matches*? Those are different queries and different messages.

**7.2 · J-18 realtor.ca scraping.** realtor.ca is CREA's; its terms prohibit scraping, it sits behind bot
protection, and there is no open API — the legitimate route is a CREA DDF/RETS data licence, which is a
commercial agreement they would hold, not a coding task. Recommendation: build the AI notes now from the
data the broker already enters (that is the 8 h in J-18), and treat property enrichment as a separate
decision once they tell us whether they have or can get DDF access. Quoting scraping as if it were a normal
feature would be quoting something that can break the week after delivery, and that we would not want to
put in writing.

**7.3 · J-1** — the two property-tax checkboxes are mutually exclusive. Radio buttons (one always chosen),
or two checkboxes where "neither" is allowed and means "not specified"?

**7.4 · J-8** — one bps override per brokerage, or a full 3/4/5 triple by term? And confirm: future invoices
only, already-issued ones untouched.

**7.5 · J-21** — if one user at an institution **declines** a deal, is it gone for their colleagues too, or
only hidden for that user?

**7.6 · Suspensions** — (a) how long is an automatic suspension? (b) over what window are the 3 attempts
counted — per deal, per lender, or lifetime? (c) her Aug 4 note says "more than 2 attempts", Bonnie's says
"3 separate messages" — same thing, worth confirming in writing; (d) what happens to a suspended broker's
deals that already have an **accepted** offer and a live invoice — those have a lender counting on them.

**7.7 · Document list** — who writes the French?

**7.8 · Rental income** — if the broker checks 80 % addback and the lender's max addback is 90 %, is that a
match? (Presumably yes — the lender is more generous than needed.) And if the lender's max is 50 % while the
broker only checked 80 % and above, no match? Confirming the direction of the comparison, and what the
taxes-and-heat checkbox does to it, before building.

**7.9 · J-20 Resources** — one shared feed, or separate broker and lender content? Images/attachments?

**7.10 · B-30a invoice template** — "edit the template" as editable text blocks inside the current layout
(6 h, quoted), or full layout control, which is a different build (~12 h+)?

**7.11 · B-30b sales tax.** Two answers needed, and both are theirs to give:
- **Which province governs.** For a service billed to the lender, the usual rule is the recipient's business
  address — but the lender's address is not the deal's province, and we should not choose a place-of-supply
  rule on their behalf. Their accountant confirms it; we implement it.
- **Registration numbers.** Charging GST/HST means the GST/HST number prints on the invoice, and Quebec
  means a QST number as well. They supply those, plus which taxes they are registered to charge — we should
  not turn on a tax they are not registered for.
- Confirmation that tax applies from a given date forward and already-issued invoices are left alone.

---

## 8. Invoicing — template editor + sales tax (B-30, confirmed into this batch)

Confirmed by the client on 2026-08-18: *"we want to include the ability to edit the invoice template in the
admin portal as part of this update. We also need to be able to add things like sales tax and have it
calculate for each province/territory accurately."*

### B-30a · Admin-editable invoice template — **5 h**
The invoice PDF is drawn in code (`invoice-pdf`, pdf-lib, logo inlined as base64). "Admin-editable" spans a
range, and the middle option is what is quoted:
- **editable text blocks** — header line, payment terms, footer, remittance wording, tax/registration lines
  — stored in a table the admin edits, rendered into the existing layout, with a live preview: **6 h**;
- **full template control** (layout, ordering, fonts) would mean replacing pdf-lib with an HTML→PDF pipeline
  and building a layout editor: ~12 h+. Not quoted; flag if that is what she means (§7.10).

### B-30b · Sales tax by province / territory — **7.5 h**
This is the larger half and it is not just a multiplication.

⚠️ **There is nowhere to read the province from today.** `lender_institutions` holds only `name` and
`is_active`; `profiles` has no address. Since the invoice is billed to the **lender**, taxing it correctly
means first capturing a billing province for each lender institution — schema, the sign-up form, lender
settings, the admin organizations editor, and a backfill for the institutions already on the platform.

⚠️ **`invoices.platform_bps` carries `check (platform_bps in (3,4,5))`**, which J-8's per-brokerage override
also has to account for. Worth knowing before either item is built.

Scope: billing province capture + backfill 2 h · admin-editable rate table per province/territory
(GST / HST / PST / QST, effective-dated so a rate change does not rewrite history) + the registration numbers
that must print on the invoice 1.5 h · invoice math and new columns (subtotal, tax rate, tax amount, total) +
the RPC call sites and the client-side preview 1.5 h · PDF layout 1 h · admin KPIs, CSV and the lender's
invoice list showing the right figure 0.75 h · smokes and QA 0.75 h.
⚠️ **The 2 h of province capture does not compress** — there is no address anywhere in the schema today, so
it is a real migration plus three screens plus a backfill, not a lookup.

⚠️ **Two things only they can decide** (§7.11): which province governs the tax, and the registration numbers.
We should not pick a place-of-supply rule on their behalf.

**Invoicing subtotal: 12.5 h.**

---

## 9. Phasing and schedule

Ordered so the dependency (§5 needs Phase 1's fields) is respected and the client sees visible change early.

| Phase | Contents | Hours |
|---|---|---|
| **1 — Fields, labels, filters** | J-1 … J-7, J-10, J-11, J-13, J-15, J-16, J-17, J-24, J-25, J-26 + the consolidated lender-filter replication (3.5 h) | **14** |
| **2 — Email, invoicing, marketplace rules** | J-23 SendGrid (6.5), J-8 per-brokerage bps (4.5), J-14 declined-lender + owned-group block (5), J-21 one offer per institution (2) | **18** |
| **3 — Suspensions & Resources** | §4 suspensions (8.5), J-20 Resources (6.5) | **15** |
| **4 — Heavy forms** | J-22 rental-income module (9), J-19 document engine (8) | **17** |
| **5 — AI & invoicing** | J-18 AI lender notes (6.5), B-30a invoice template editor (5), B-30b sales tax by province (7.5) | **19** |
| **Cross-cutting** | migrations, EN/FR parity, smoke updates, staging→prod deploys, regression pass | **5** |
| | | **88 h** |

At ~44 h/week, from approval:

| Week | Delivered | Hours |
|---|---|---|
| **W1** | Phase 1 → staging + prod; Phase 2 → staging + prod; Phase 3 started | 44 |
| **W2** | Phase 3 finished; Phase 4; Phase 5; final regression + prod deploy | 44 |

≈ **2 weeks** (88 h ÷ 44). Round 3's 64 h ran in about nine days, so this is the pace already demonstrated,
not an optimistic one. Phases stay independently deployable and can be invoiced as delivered.

**Not in the 88 h:** J-9 (3 h, blocked on §7.1), realtor.ca enrichment (§7.2, not quotable yet).

**Schedule risk to state up front:** Phase 5's sales tax cannot start until they supply the place-of-supply
rule and their registration numbers (§7.11), and Phase 4's document list needs the §7.7 French answer. Both
are client-side inputs, not development time — worth asking for them at approval rather than at the phase
boundary.

---

## 10. Assumptions

- Built on the delivered React + Supabase platform as it stands at migration 66 — auth, RLS, the match
  engine, notifications + email, scheduled jobs, Storage, invoice PDF and the anti-contact layers are all
  reusable and are not re-charged here.
- Hours include development and QA. Every phase is verified on staging before prod, per the runbook.
- New user-facing copy ships EN + FR, except where §7.7 is answered otherwise.
- SendGrid domain authentication and DNS are done on the client side; we consume the verified sender.
- The AI lender notes are an assistive draft for the broker to review — her own disclaimer says so — not a
  verified submission document.
- Estimates assume the requirements in §7 are answered before the phase that contains them starts. An answer
  that changes a rule's shape (rental matching, suspension duration) is re-estimated, not absorbed.

---


---

## 11. How this got from 108 h to 88 h

The first pass summed to 108 h. It was re-estimated to **88 h** on 2026-08-18 — re-estimated, not
discounted. Both documents carry the same numbers; there is no second set of figures for the client.

Two errors in the first pass account for essentially all of the difference.

**1. Every item was priced as if it were built alone.** Fifteen of Phase 1's items are one pass over the
same six files — `app/(broker)/create-deal/page.tsx`, `lib/enums.ts`, both message catalogs, one migration,
one `pnpm db:types`, one smoke run. Charging the setup, the type regen and the verification cycle inside
each line counted them fifteen times. Phase 1 fell from 17.5 h to 14 h on that alone, and the individual
line estimates are unchanged in kind — a new boolean in a batch is 0.25 h, the same boolean alone is 0.5 h.

**2. Several "new" features ride on machinery that already exists.** Named per item so the reduction is
checkable rather than asserted:

| Item | Was | Now | What it reuses |
|---|---|---|---|
| J-20 Resources | 8 | 6.5 | the Tiptap editor + DOMPurify write boundary + publish flow from `/admin/legal`; `legal_documents` as the table/RLS template |
| §4 Suspensions | 10 | 8.5 | the lender half is the delivered penalty effect; the broker half is one more predicate in `lender_can_see_deal`; admin screens reuse `RowActions` + the existing tables |
| J-19 Document engine | 11 | 8 | the rules are declarative data (`{condition, lines}`), not 35 hand-written branches — the cost is content, not logic |
| J-18 AI notes | 8 | 6.5 | the edge-function pattern from `anti-contact` / `match-document-name` |
| J-23 SendGrid | 8 | 6.5 | `notify-email` is 103 lines and the send is one fetch; the work is the mapping |
| J-14 Declined lender | 6 | 5 | `lender_can_see_deal` covers the 4 feeds, the `make_offer` guard and chat in one clause |
| J-8 Per-brokerage bps | 5.5 | 4.5 | 4 one-line SQL call sites; the admin UI is the existing `OrgTable` |
| J-21 One offer per institution | 2.5 | 2 | the 4 feeds already go through `i_offered_on` |

**Three lines were deliberately not cut**, and they are where an overrun would come from if one comes:

- **J-22 rental income, 9 h.** The lender-side matching rule is still unspecified (§7.8). Trimming hours off
  a rule nobody has written down is guessing.
- **J-20's header re-measure, 1.5 h.** That number is measured, not estimated (G-1b), and two previous
  passes that set the thresholds by arithmetic both overflowed.
- **B-30b's province capture, 2 h.** There is no address anywhere in the schema; it is a migration plus
  three screens plus a backfill.

**The 2-week calendar is 44 h/week**, which is the pace Round 3 actually ran at (64 h in about nine days).
It has no slack for waiting on answers, so §7.11 (tax rule + registration numbers) and §7.7 (the French
decision) should be asked for at approval, not at the phase boundary.
