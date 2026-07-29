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

## 5. Deferred to the next pass

**Blocked on her answers:**

1. **B-4 threshold.** `surveys.commitment_on_time` and `doc_review_on_time` are **yes/no booleans, not
   scores**, so "low ratings for turn time" has no numeric meaning yet. Need the exact rule — e.g.
   *penalise when 2 or more of the last 5 completed surveys answered "no" to either turn-time question.*
   Everything else for B-4 is ready: the 45d/14d effect and the admin lift/apply screen already exist, so
   this is a rewrite of one CTE in `job_apply_rating_penalties`.
2. **A-25 semantics.** She said invoices "can be deleted after 1 calendar year". Confirm **delete vs
   archive**: deleting is irreversible, and Canadian record-keeping practice retains accounting records
   longer than a year. If she wants them merely out of the way, hiding them from the default view is
   reversible and cheaper. Not a legal opinion — just which behaviour she means.
3. **B-39 placement.** Inline banner (live, and now carrying her final text) or pop-up (asked for on
   07-25)? She supplied only copy when asked.

**Not blocked, deliberately deferred:**

4. **A-3 — TOS/Privacy re-agreement.** In scope (§2), but scheduled with the three above so it lands in
   one pass rather than on its own.

## 6. Out of Round 3 scope — to quote

| ID | Item | Note |
|---|---|---|
| **B-30** | Admin-editable invoice template | The only one she agrees is new |

Down from 5 to 1: B-16, B-4 and B-3 are absorbed as fixes/small changes, B-17 shrank to an admin-only
screen, and A-3 is in scope but deferred.

---

## 7. What shipped in this pass

Migrations **57** (`survey_comments`) and **58** (`auto_offer_min_closing_days`). 58/58 replay clean from
scratch; gate green (0 type/lint errors, EN/FR parity 1625/1625, 19/19 unit tests, 23/23 smokes).

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
