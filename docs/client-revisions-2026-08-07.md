# Client revisions — 2026-08-07 (1 item)

Source: the client's email, sent after the 08-05 batch went live.

> Something I forgot to mention... when a broker uploads the service/consent agreement and the ID, we
> can see if there's a name mismatch, but when there is, they are still able to proceed to the next
> step. I've tested this by uploading random images to both and was still able to create a new deal.
> Is there a way to stop the broker in their tracks when they upload incorrect documents? Perhaps when
> the uploads show as "mismatch" the broker cannot proceed until they upload the correct documents?

**Status: DONE and LIVE on staging + prod (2026-08-07, `e93167e`, migration 65 — 65/65 on both).**
No edge function changed, so none needed redeploying.

---

## H-1 — A document name mismatch now blocks the submission

### She was right, and nothing was broken — the rule was "advisory" by design

This is worth being precise about, because "the check doesn't work" and "the check works and we chose
not to act on it" lead to different fixes. It was the second.

Round 3 Phase 3 item 2 specced the AI name-match as **advisory, fail-open, never blocks submit**. That
is written into migration 46's header, into the `match-document-name` docstring, and into the broker-facing
copy, which literally read:

> "…This is only a warning — it does not stop you from submitting the deal."

So her random-image test did exactly what the build was built to do: Claude read no name, flagged the
mismatch, and the deal went through anyway. The detector fired; there was no gate behind it.

### Three separate reasons she could proceed — only one is "we forgot a check"

1. **The rule was advisory** (above). The headline reason.
2. **`submit_deal` only counted documents, it never read them.** Migration 48 line 140 checks
   `count(distinct kind) < 2`. It has never looked at `name_matches`.
3. **⚠️ The check was fire-and-forget, so a UI-only gate would have been bypassable by being fast.**
   `matchDocumentName` was called without `await` (create-deal:519). A broker could upload both files and
   click Submit before Claude answered, leaving both flags NULL. Shipping only the wizard gate would have
   produced a fix that works when you test it slowly and fails when someone is in a hurry.

All three are closed.

### The three-state rule — two of the three states must keep passing

This is the part to get right. "Block on mismatch" sounds like one condition; it is three, and tightening
it into one would either break a client rule or take the platform down.

| `name_matches` | Meaning | Result |
|---|---|---|
| `false` | The AI read a name and it is a **different person** | **BLOCKED** |
| `true` + `name_variance` | Same person, preferred-name variance (Mary/Maria, Bob/Robert) | **allowed** |
| `NULL` | Never checked: no API key, Claude errored, or still in flight | **allowed** |

- **The variance case is the client's own rule** from migration 46: same person under a different printed
  name, and at acceptance **both names print on the invoice** so the lender can reconcile. Folding it into
  the block would silently revoke a decision she made in Round 3.
- **⚠️ The NULL case is fail-open on purpose.** Blocking on NULL would mean an Anthropic outage, a missing
  key, or a rate limit **halts every deal submission on the platform** — a far larger failure than the one
  being fixed. It would also break every smoke, since `attachDealDocuments()` inserts unchecked rows.
- **⚠️ And that is exactly why cause 3 had to be fixed too.** Fail-open on NULL is only defensible if NULL
  really means "the AI is unavailable". `handleSubmit` now **awaits any check still in flight** before
  committing, so a broker cannot manufacture a NULL by racing the upload. **The two halves are one
  mechanism — do not remove either.** Dropping the await reopens the bypass; dropping the fail-open
  couples every submission on the platform to a third-party API.

`is false`, not `= false` and not `not name_matches`: the latter two are NULL for an unchecked row, which
inside a `WHERE` reads as no-match by luck rather than by intent.

### What changed

- **`supabase/migrations/20260807000065_block_submit_on_name_mismatch.sql`** — `submit_deal` refuses on a
  mismatched document. The exception **names which document** (`photo ID` / `consent form`, photo ID first
  when both are bad) so the broker knows what to replace. Verbatim recreation of migration 48's body plus
  the guard — the diff is the `declare` line and the guard block, nothing else.
- **`app/(broker)/create-deal/page.tsx`** — `mismatchedDoc()` gates `sectionComplete('property')`;
  `documentsPassNameCheck()` resolves pending checks in `handleSubmit`; the mismatched card gets the
  destructive border and a summary line under the group; a new **"Checking the name on the document…"**
  state with a spinner while the AI is looking.
- **Copy** (`messages/{en,fr}.json`) — `docNameMismatch` no longer says it is only a warning; new
  `docNameChecking`, `docNameMismatchNamed` (names the person the document is in), `docNameMismatchBlocks`.
- **`scripts/smoke-doc-name-gate.mjs`** (new, in `smoke-all`) — 10 assertions.

### Deliberately NOT changed

- **Save Draft still works with a mismatched document.** Property is the last step, so the block lands on
  Submit, which is what she asked for; holding the *draft* hostage would leave the broker with nowhere to
  park the work while they chase a better scan. The deal simply cannot leave Draft.
- **The `deals`/`deal_documents` tables are untouched.** No new column: the answer was already stored, it
  just was not being read.

### Verification

- **Migration 65 applies clean** — 65/65 locally.
- **`smoke-doc-name-gate.mjs` 10/10**, and it pins the two states that must keep passing (variance and
  NULL), not just the block. Both refusals are asserted to name the right document.
- **Full suite 27/27 green.** No existing smoke regressed: `attachDealDocuments` inserts unchecked rows,
  so every other smoke lands in the NULL case.
- **`pnpm check`**: 0 errors, i18n 1659/1659 EN=FR.
- **Browser, her exact scenario, against the real Claude vision call** (dev :3010 + `pnpm functions:serve`
  with `ANTHROPIC_API_KEY`). Complete cycle:
  1. The same random PNG uploaded to **both** slots → both cards outlined red with the mismatch text, the
     summary line appears, **Submit is faux-disabled and clicking it does nothing**. DB: still `draft`,
     `deal_number` NULL, both rows `name_matches = f`, `checked_at` set, `extracted_name` empty.
  2. Photo ID replaced with a PDF reading "Nadia Okonkwo" → **that card alone** clears to "Name matches the
     primary borrower"; the consent stays flagged and Submit stays blocked. **Per-document precision, not a
     blanket block.**
  3. Consent replaced too → both verified, Submit enables, deal submits as `DEAL-2026-123`.
  Step 3 is the one that matters as much as step 1: it proves the gate does **not** reject a correct
  document, which is the failure mode that would cost her real deals.
- **Staging, after deploy** — the environment-specific half, since the AI key and the deployed function
  are what differ from local:
  - The same random PNG uploaded to both slots through the wizard → both rows came back
    `name_matches = false`, `checked_at` set, `extracted_name` empty. **So the key is live on staging and
    the vision call really ran** (a missing key would have left the rows NULL and let the deal through).
  - `submit_deal` called **directly as the broker, bypassing the wizard entirely** →
    `The name on the uploaded photo ID does not match the primary borrower. Replace it before submitting.`
    This is the assertion that matters: the refusal is in the database, so it cannot be clicked past.
  - Both documents then replaced with PDFs bearing the correct name and re-checked through **staging's
    deployed `match-document-name`** → it read `"Nadia Okonkwo"` off the files (proof it ran the model
    rather than trusting stored state — the flags were reset to NULL first so a failed re-check could not
    pass as an approval), both `name_matches = true`, and the deal submitted as `DEAL-2026-628`.
  - Test deal and its two Storage objects deleted afterwards (objects do **not** cascade with the deal).
- **Staging, through the wizard in the browser** (second pass, after the extension reconnected) — and this
  one caught the fail-open path happening for real, which is better evidence than the designed test:
  1. Random PNG on both slots → the photo ID came back `false` and turned red, but **the consent's check
     returned `checked: false`** (a transient failure of the Claude call; its row stayed NULL with no
     `checked_at`). One document blocked, the other was simply unverified. Deal stayed `draft`, and
     clicking Submit did nothing.
  2. Photo ID replaced with the correct PDF → it cleared to "Name matches", and with no `false` row left,
     **Submit went live again while the consent was still an unverified random image.** That is exactly the
     hole `documentsPassNameCheck()` exists to cover.
  3. **Clicked Submit in that state → the pending check re-ran, came back `false`, and the deal was NOT
     submitted**: the consent card turned red, the summary line appeared, Submit went back to disabled.
     DB confirmed `draft`, no `deal_number`, consent now `name_matches = false`.
     ⚠️ **This is the live proof of the bypass the `await` closes.** A UI-only gate would have submitted
     that deal — the flag was NULL at click time and the card showed nothing at all.
  4. Consent replaced with the correct PDF → both read `"Nadia Okonkwo"`, Submit enabled, deal submitted
     as `DEAL-2026-629` and the wizard redirected to the Deal Room. Cleaned up after.

### ⚠️ Found during that pass, NOT fixed — an unverified document is silent

Step 1 above is worth its own note: when the AI check fails to run, the card shows **nothing** — no
badge, no warning, just the filename. Next to a sibling card reading "Name matches the primary borrower",
a broker reasonably reads the blank one as fine. Then Submit appears to work and errors a few seconds
later, because the check runs at that point.

The behaviour is *safe* (nothing is submitted that shouldn't be) but it is confusing, and this is not a
theoretical path — it happened on the first real attempt on staging. The fix is small: render a neutral
"Could not verify this document — it will be re-checked when you submit" line when `name_matches` is null
but the document has been uploaded. **Deliberately left out of this deploy** rather than expanding scope
after the client's item was already shipped and verified — raise it with her as a small follow-up.
- **Prod: verified at the DB level only** — 65/65, the guard present in `submit_deal`, `ANTHROPIC_API_KEY`
  set. Deliberately **not** exercised end-to-end there: prod holds one real account and no deals, and
  proving this needs creating a deal and uploading documents. That is test data in production, so it was
  not done.

### ⚠️ The risk profile changed, and she should know

Before this, a wrong AI answer was cosmetic. Now it **blocks a real deal**. A blurry photo, a damaged
scan, or a legitimately unusual name that Claude misreads stops the submission.

What limits the damage: re-upload is unlimited and re-runs the check, preferred-name variances are
tolerated, an AI outage fails open, and `/admin/documents` shows an admin every document with its
name-check result.

**What does not exist: an admin override.** If Claude is wrong about a document and a better scan cannot
be produced, there is no way for an admin to wave the deal through — the broker is stuck. That was not in
her request and was not built. Flag it to her as a decision, not as a bug: if she wants one, it is a small
addition (an admin-only flag on `deal_documents` that the guard honours), but it is also a hole in the
control she just asked for, so it is her call, not ours.

### Known gap (not fixed, deliberately)

**A mismatch introduced *after* submission is not hard-blocked.** A broker editing an already-submitted
deal can swap in a bad document; `updateSubmittedDeal` is a plain RLS-scoped UPDATE, not an RPC, so there
is no single place to raise from without a trigger. The wizard's gate does cover it (the same
`handleSubmit` backs "Save changes", so an edit cannot be saved while a document is mismatched), and
`/admin/documents` surfaces it. Blocking it at the data layer would need a trigger on `deal_documents` —
worth doing only if she asks, since the deal is already live at that point and refusing the edit does not
un-submit it.
