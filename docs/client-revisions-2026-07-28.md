# Client answers — 2026-07-28

Bonnie's reply to the July 23 + 25 status email. It **closes the 8 open questions** from
[`client-revisions-2026-07-23-and-25.md`](./client-revisions-2026-07-23-and-25.md) and **pushes back on
4 of the 5 items** we had put outside Round 3 scope. Read that doc first — the IDs below are its IDs.

Source: Gmail thread *"LenderMatch — July 23 & 25 Revisions Update"*, Bonnie Casault → Ivan, 2026-07-28
15:23. Two screenshots attached as her evidence (quoted verbatim in §2).

⚠️ **Do not read the 23-July PDF for any of this** — it clips long lines at the page margin and the text
is genuinely gone. Same trap recorded in the previous control doc.

---

## 1. The 8 open questions — now answered

| # | ID | Her answer | Work |
|---|---|---|---|
| 1 | **B-39** | Gave the final prequal text (§3) | Copy-only: append 2 sentences. **Placement still unanswered** |
| 2 | **A-9 + B-25** | "Rate Lock" → **"Commitment Period"**; the two turn times are **separate and additional**; remove "processing time" and show the lender's actual figures | **Display-only — no migration, no new field** |
| 3 | **A-2** | Full footer, `©LenderMatch™ Inc. {year}. Patent Pending.` + TOS/Privacy links + `support@lendermatch.ca` | Rebuild `SiteFooter` |
| 4 | **B-29** | "The 15 day expiry should apply" | **No change** — see §4 |
| 5 | **A-13** | "I declined another deal and it did not show up again… fixed or was a glitch" | **Closed**, confirms our investigation |
| 6 | **B-33** | Per-lender minimum, **default 30 days** | Migration + input |
| 7 | **A-25** | "Invoices can be deleted after 1 calendar year" | ⚠️ **Held** — see §5 |
| 8 | **A-3** | Wants it (see §2) | **Out of scope, to quote** — see §6 |

### Verbatim, for the record

> Rate Lock should be changed to Commitment Period as Rate Lock is inaccurate for what we're doing.
> Commitment Turn Time and Document Review Turn times should be in addition to the Commitment Period -
> they are separate. The processing time should be removed and Commitment Turn Time and Document Turn
> Time should be consistent for both sending the offer and accepting the offer. If a lender puts 2 days
> commitment turn time and 2 days doc review turn time in an offer, that's what should show up on the
> offer to the broker instead of "processing time".

---

## 2. The 5 disputed items — verdicts

She wrote *"4 of 5 of them were in the previous scope"* and conceded only B-30. Verdict per item, with
what we actually verified:

### B-16 — AI name detection · **SHE IS RIGHT. Her diagnosis is wrong; the complaint is valid.**

Her claim: *"We had requested that all names, numbers and any contact information be identified with AI.
The fact that the AI only catches it if it says 'My name is' is not what we asked for. We could not have
known this until it was tested."*

Probed the deployed function directly with a real lender session
(`scratchpad/probe-b16.mjs`, local edge runtime + `ANTHROPIC_API_KEY`):

| len | layer | verdict | text |
|---|---|---|---|
| 13 | — | **CLEAN** | `Rick McDonald` |
| 20 | — | **CLEAN** | `Rick McDonald at RMG` |
| 24 | ai | BLOCKED — a person's name | `My name is Rick McDonald` |
| 49 | ai | BLOCKED — a person's name | `Please reach out to Rick McDonald about this file` |
| 55 | ai | BLOCKED — a person's name and company name | `The underwriter on this one is Sandra Whitfield at MCAP` |
| 59 | ai | BLOCKED — a phone number | spelled-out digits |
| 23 | regex | BLOCKED — a phone number | `call me at 604-555-0143` |
| 58 | — | CLEAN | clean control — no false positive |

**The AI does catch bare third-party names without "my name is."** What fails is *short* text:
`anti-contact/index.ts` has `MIN_AI_LEN = 20` and returns clean before calling the model. Her test case
was almost certainly a bare name, which is short — hence the wrong diagnosis and the correct complaint.

**That threshold is inherited from Bubble** (`docs/extracted/flows.md:220`: *"called only when regex is
clean AND text length > 20"*), and this project's governing rule is that **the client spec wins over the
Bubble build** (CLAUDE.md). So reproducing it is not a defence. **One constant → in scope as a fix.**

### B-4 — penalties on turn-time · **SHE IS RIGHT, and she concedes the key point.**

Her May 4 attachment, verbatim:

> This data needs to go into a report that is stored for us to review. We also need the ability to remove
> a lenders access to deals with closing dates inside 45 days from submission by broker and COF dates
> inside 2 weeks from submission by the broker. This will happen as a penalty if a lenders surveys come in
> with low ratings for turn time.

The **45 days / 2 weeks effect is already built** and admin-configurable (`penalty_settings`, migrations
23/26). Only the **trigger** differs: `job_apply_rating_penalties` (migration 04) keys off
`avg(satisfaction) < 3` over the last 5 surveys. Re-pointing it at the turn-time answers is one function
and one migration.

She also wrote *"The scope then simplified it"* — an explicit acknowledgement that what was quoted was
the simplified version. Concede the change; bill nothing; but **we cannot implement it yet** (§5).

### B-3 — survey comments + admin view · **HALF ALREADY DELIVERED; the rest is small. Concede.**

Her claim: *"comments were always part of the questions and there should be a way for us to view them."*

Her own attachment lists the survey as **4 questions with no comments field**, in both versions:

> a) Did the commitment meet the quoted timeline? b) Did the doc review meet the quoted timeline?
> c) Did the file fund on time? d) Are you satisfied with your lender match?

So "comments were always part of the questions" is not supported by the evidence she sent. **But** the
same attachment says *"This data needs to go into a report that is stored for us to review"* — and that
**is** already built (`/admin/surveys`, `listSurveyReport`). Net remaining work: one `comments` column, a
textarea in the survey dialog, and one more field in the existing report. Not worth disputing.

### B-17 — viewing uploaded documents · **She answered our question and made it smaller.**

> We don't want lenders to have access to it - just in the admin portal in case we need to check them, or
> pull them for a lender regarding their invoice.

Admin portal only, never lenders — which is what the RLS on `deal_documents` already enforces
(owner/admin/brokerage-admin). The private `deal-documents` bucket and its object policies exist too, so
this is a UI + signed-URL job on the admin side. **In scope.**

### B-30 — admin-editable invoice templates · **She concedes it is new.**

> agree this is new. We can add to the next scope.

### A-3 — TOS/Privacy re-agreement · **Accepted into scope, deferred to the next pass.**

Her evidence is a screenshot of an *earlier Q&A* where she answered our clarifying question
(*"should existing users be re-prompted to accept the new version?"* → *"Re-prompted would be great - yes
please."*). That is weaker than her other three — answering a clarifying question is not the same as the
item being specced, quoted or built, and our own record says **never built**. It is also the largest of
the four: versioned acceptance per user, a gate on sign-in, and an audit trail.

**Decision (ours, 2026-07-28): keep it IN scope, but do not build it in this pass.** It ships together
with the items still waiting on her answers (§5) rather than as a separate quote.

---

## 3. The prequal fine print — third version, now final

Her text (supersedes both the 07-25 and 07-27 versions):

> **Please Note:** Pre-qualification offers are intended to help identify potential lender interest and
> are not binding commitments or rate holds. Rates, terms, and lending conditions are subject to change at
> any time prior to the submission and review of a complete application. Offers shown on the platform will
> not be updated to reflect future rate changes. Lender offers do not remove the need for a Condition of
> Financing on the purchase contract. We highly recommend a Condition of Financing on all purchases that
> require a mortgage.

This is **the shipped 07-27 text plus the two Condition-of-Financing sentences** that were the substance
of the 07-25 longer version — she merged them rather than choosing. Copy change only.

⚠️ **Placement is still unanswered.** We asked "on-page notice or pop-up?"; she supplied only text. The
07-25 email had asked for a pop-up; we shipped an inline banner. Keeping inline until she says otherwise.

---

## 4. B-29 resolves to no change (and OQ#18 stays settled)

Three numbers were in play for the Maturing window:

| Source | Maturing window |
|---|---|
| Round 3 Phase 1 (migration 37) — what is live | **2–14 days**, Expired 15+ |
| B-29, 2026-07-23 | "New Deals 0-1 days (0-48 hours)… Maturing where everything shows up after the 48 hour mark" |
| The simplified scope doc (her attachment) | "Maturing: deals 5-14 days without an offer" |
| **2026-07-28 (final)** | **"The 15 day expiry should apply"** |

"After 48 hours" + "15-day expiry applies" = **2–14 days, Expired 15+** = exactly what is live. No code
change, and **OQ#18 is not reopened** after all — the previous doc had flagged that risk.

---

## 5. The three follow-up answers — all now implemented

She answered the three open questions the same day. Verbatim, with what each produced:

### B-4 threshold

> "Yes, please key the penalty off the turn-time answers. So please include both of the 2 turn-time
> questions, and if either one of those two questions gets 4 no's within the last 10 surveys, the penalty
> would apply."

Migration **59** rewrites `job_apply_rating_penalties` accordingly. The 45d/14d effect and the admin
lift/apply screen were already built, so only the trigger moved. Two things her wording does not settle,
decided and commented in the migration:

- **Which surveys count as "the last 10".** The turn-time questions only exist on a survey where the deal
  closed with the lender, so a not-closed survey carries no signal — counting it would let a lender dilute
  the sample. The window is the last 10 surveys that HAVE turn-time answers.
- **No minimum sample.** The old rule needed one (an average over 1 survey is noise); an absolute count of
  4 cannot trigger on fewer than 4, so the floor is implicit.

The two counts are **independent**: 3 late commitments + 3 late doc reviews is 6 bad answers and does NOT
penalize, because neither question reaches 4. That is what "either one of those two questions" means, and
the smoke asserts it.

### A-25 retention

> "If we can archive the invoices without causing any issues with the website … then we would like to
> archive the paid invoices for 7yrs if possible. After that, they can be deleted. Otherwise we will need
> to find a separate method … Will it work to archive them for this long? How would we access them?"

Migration **60** + the `purge-invoices` edge function:

```
paid  ──1 year──▶  archived  ──7 years from paid──▶  deleted (row + Storage PDF)
```

⚠️ **Ambiguity resolved conservatively and flagged back to her.** "Archive the paid invoices for 7yrs"
never says *when* an invoice enters the archive. We took 1 year (from her earlier message) rather than
"immediately on payment", because it keeps recently paid invoices where the admin already sees them.
Both thresholds are single literals, so switching is a one-line change.

Archiving is a **flag, not a move** — no second table, nothing rewritten. `/admin/invoices` gains a
Current / Archived / Both filter, defaulting to Current. Lenders are unaffected either way: revision
A-24/B-28 already limited their list to Pending + Overdue.

**Her storage question, measured rather than estimated:** one invoice is ~650 bytes of row plus ~15.5 KB
of generated PDF. At 5,000 invoices a year — far above anything realistic early on — 7 years is ~24 MB of
database and ~550 MB of Storage, and the PDFs never touch query speed because they are not in the
database. Archived rows are excluded from the default list by an indexed predicate. So: yes, comfortably.

### B-39 placement

> "The pre-qualification disclaimer is fine to remain as a notice above the offers. We just want to ensure
> the disclaimer is seen before the offers are viewed."

**No code change** — that is where it already is, rendered once above the offers list. Confirmed on screen.

## 5b. A-3 — TOS / Privacy re-agreement (built in this pass)

Migration **61** + `components/legal-reagreement-gate.tsx`.

`legal_documents` already versioned the docs; what was missing was any record of which version a user
accepted. `legal_acceptances` is an **append-only** log keyed to the document ROW rather than the version
string (versions are admin-typed free text and could collide). No UPDATE or DELETE policy exists for
anyone — an editable consent record is worth nothing.

- `pending_legal_documents()` → what the caller still owes; `accept_published_legal_documents()` → accept
  all of it in one idempotent call, keeping the FIRST timestamp.
- The prompt is a **non-dismissable** overlay (Escape and outside-click are suppressed, no close button),
  mounted once in the root layout. Documents open in a new tab so they can actually be read, and "Sign
  out instead" means nobody is trapped.
- Auth routes are skipped so the modal never lands on top of an OTP screen.
- `handle_new_user` now logs the sign-up acceptance, so a brand-new user is never asked to re-accept the
  terms they just ticked. Migration-time backfill does the same for existing users, timestamped from the
  profile's creation date rather than `now()`.

## 6. Out of Round 3 scope — to quote

| ID | Item | Note |
|---|---|---|
| **B-30** | Admin-editable invoice template | The only one she agrees is new |

Down from 5 to 1: B-16, B-4 and B-3 are absorbed as fixes/small changes, B-17 shrank to an admin-only
screen, and A-3 was kept in scope and built.

**Nothing is now blocked on the client.** Every item from this batch is implemented.

---

## 7. What shipped in this pass

Migrations **57** (`survey_comments`), **58** (`auto_offer_min_closing_days`), **59**
(`penalty_on_turn_times`), **60** (`invoice_archive_retention`) and **61** (`legal_reagreement`), plus the
new `purge-invoices` edge function. 61/61 replay clean from scratch; gate green (0 type/lint errors, EN/FR
parity, 19/19 unit tests, **25/25 smokes** — two of them new).

| ID | Change | Verified |
|---|---|---|
| **B-39** | Prequal notice carries her final text (+ the two Condition-of-Financing sentences) | On screen, broker deal-detail of a prequal with an offer |
| **A-9** | "Rate Lock" → **"Commitment Period"** everywhere (offer dialog, auto-offers, broker deal-detail); the padlock icon went with it, since the whole point was that the name misdescribed the field | On screen, both deal-detail blocks + the auto-offer dialog |
| **B-25** | "Processing" replaced by **Commitment Turn Time** and **Doc Review Turn Time**, showing the lender's own figures. It had only ever rendered `doc_review_turn_time_days`, so the commitment figure was never visible to the broker at all. Display-only — both columns already existed on `offers` | On screen with deliberately different values (3d vs 8d) so a tile reading the wrong field would show |
| **A-2** | Full footer restored: `©LenderMatch™ Inc. {year}. Patent Pending.` + Terms + Privacy + `support@lendermatch.ca`. Mounted **once in the root layout**, not pasted per page as before. `COPYRIGHT_HOLDER` changed from the founders' names to the company, per her answer. No "Regulatory Disclosures" link — it pointed at `#` and she did not ask for it | On screen |
| **B-33** | `auto_offers.min_closing_days`, default 30, editable per lender. A deal with **no** closing date (a prequal) is deliberately unconstrained — dropping nulls is the exact bug migration 54 had to undo | Smoke covers the boundary both ways, the prequal exemption, and a lender's own higher minimum; edited to 45 in the UI and read back from the DB |
| **B-16** | `MIN_AI_LEN` 20 → 4 in the `anti-contact` function | See below |
| **B-3** | `surveys.comments` + a textarea in the survey dialog + a column in the existing admin report and its CSV. Deliberately **not** anti-contact scanned: that guard exists to stop broker and lender identifying each other, and these comments only ever reach platform admins | Submitted through the dialog and read back from the DB; smoke asserts storage, the null case, admin read and lender lockout |
| **B-17** | New admin-only `/admin/documents`: every uploaded consent form and photo ID, with the borrower name, the AI name-check badge, search, type filter, CSV, and a signed-URL **View**. No migration — `deal_documents` RLS and the bucket policies already granted admin and denied lenders | On screen with all three badge states; asserted the signed URL serves the PDF (HTTP 200, `application/pdf`) and that a lender reads **0 rows** and cannot sign a URL |
| **B-29** | No change — see §4 | — |
| **A-13** | Closed by her own retest | — |
| **B-4** | Penalty keys off the two turn-time answers: 4+ "no" on EITHER within the last 10 rated surveys (migration 59) | Smoke covers both questions independently, the 3+3 case that must NOT penalize, the 10-survey window boundary, and that a not-closed survey is skipped |
| **A-25** | Paid invoices archived 1 year after payment, deleted at 7 years (migration 60 + `purge-invoices`). Admin filter Current / Archived / Both | Smoke covers every boundary, idempotency, that pending/cancelled are never archived, and that `invoices_to_purge()` is unreachable with a broker or lender token |
| **B-39** | No code change — already a notice above the offers | Confirmed on screen |
| **A-3** | Non-dismissable re-agreement prompt + append-only acceptance log (migration 61) | Smoke covers publish → pending → accept → clear, per-user isolation, forgery, and that the log cannot be amended or erased; the modal verified on screen incl. Escape / outside-click |

### B-16, measured

The threshold was the whole story, and her diagnosis was wrong in a way worth recording. Before
(`MIN_AI_LEN = 20`) vs after (`4`), against the deployed function:

| text | len | before | after |
|---|---|---|---|
| `Rick McDonald` | 13 | **clean** | blocked — *a person's name* |
| `Rick McDonald at RMG` | 20 | **clean** | blocked — *a person's name and company name* |
| `Please reach out to Rick McDonald about this file` | 49 | blocked | blocked |
| `My name is Rick McDonald` | 24 | blocked | blocked |

So the model never needed "my name is" — it never *ran* on short text. Also checked the other direction:
**18/18 ordinary short messages still get through** (`ok`, `thanks`, `Approved`, `Toronto`, `45 bps`,
`Not for us, sorry`, …), so lowering the floor did not turn the chat into a minefield. The floor is kept
at 4 only to skip acknowledgements, which carry no identity.

---

## 8. Status

| | Count |
|---|---|
| Implemented | 10 |
| No code needed (B-29, A-13, B-39) | 3 |
| Blocked on the client | **0** |
| Out of scope, to quote (B-30) | 1 |

**Not deployed yet** — held deliberately so the whole batch reaches staging and prod together rather than
in pieces.

### Two things to raise in the reply

1. **The A-25 archive point** (1 year after payment, vs immediately on payment) is our reading of an
   ambiguous sentence, not her instruction. One-line change either way.
2. **The auto-offer prequal exemption** (B-33): a deal with no closing date is not held back by the
   minimum. Deliberate, but she should know.
