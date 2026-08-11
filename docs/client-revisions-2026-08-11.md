# Client revisions — 2026-08-11 (2 items)

Two separate emails on the same day, both follow-ups to the 08-07 batch.

**Status: DONE and LIVE on staging + prod (2026-08-11, `c7e54ce`, migration 66 — 66/66 on both).**
No edge function changed, so none needed redeploying, and no type regeneration (migration 66 replaces a
function body and a column comment; no new column, no new enum value).

---

## I-1 — A prequal must not tell the broker it expired

> *"pre-quals aren't supposed to expire at the 15 day mark for brokers - only for lenders, but I received
> this email - can you please fix it?"*
>
> *"Pre-qualification DEAL-2026-611 has finished its 15 days on the lender queues. It stays in your Deal
> Room until you delete it — move it to a live deal to keep working it."*

### The behaviour was already right. The message was not.

Worth separating, because "prequals are expiring for brokers" and "prequals are announcing themselves as
expired" need different fixes. It was the second.

Her `DEAL-2026-611` on staging, queried before touching anything: `status = submitted`, `expired_at =
null`, `archived = false`, created 2026-07-25. It never expired. Migration 52 does exactly what she asked
for on 2026-07-27 — a prequal never reaches status `expired`, it only stops being visible to lenders at 15
days, via a clause in `lender_can_see_deal` computed from `created_at`.

What went wrong is the courtesy notice **we** added in the same migration. It rode on the existing
`deal_expired` notification type, on the reasoning that the body was prequal-specific so no new enum value
was warranted. That reasoning was wrong, because the body is not the only thing the type drives:

| Surface | Reads | Result for her |
|---|---|---|
| Email | `SUBJECTS[type]` in `notify-email/index.ts` | subject **"A deal has expired"** |
| Bell / notifications page | `NOTIFICATION_TYPE_KEY[type]` → `notificationCenter.typeDealExpired` | label **"Deal expired"** |
| Bell icon | `ICON`/`TONE_CLASS[type]` in `notification-icon.tsx` | red `XCircle` |

So a deal that deliberately does not expire announced itself as expired twice over. The row was still
unread in her bell when she wrote — meaning she would have seen "Deal expired" again on her next login even
if only the email had been fixed.

⚠️ **The general rule: a notification's TYPE is not a routing detail, it is copy.** It picks the email
subject, the in-app label and the icon, none of which the body can override. Reusing a near-enough type to
avoid an enum migration means shipping the wrong words. If a notification needs a different sentence than
its type says, it needs its own type — or it should not be sent.

### Why the notice was removed rather than re-typed

Re-typing was the obvious fix and it is the wrong one here.

- **She did not ask to be told.** The notice was never requested; it was our addition, justified in
  migration 52 as avoiding a deal that silently vanishes from every lender queue while the Deal Room still
  reads "Submitted".
- **That justification is already covered where the broker acts on it.** The Deal Room row renders
  `dealRoom.prequalQueueClosed` — *"Past its 15 days on the lender queues — still yours to move to a live
  deal or delete."* — beneath the Submitted + Prequal badges, driven by `isLenderQueueClosed()` /
  `LENDER_QUEUE_MAX_AGE_DAYS` in `lib/age-windows.ts`. Verified on screen (see Verification).
- **A new type costs 8 surfaces and still emails her on day 15.** `alter type` + the `notify()` gate + both
  exhaustive `Record<NotificationType, …>` maps + `notificationHref` + `DEAL_SURFACE_TYPES` + both i18n
  catalogs + the edge function's `SUBJECTS` + a redeploy — to deliver a day-15 email she has just told us
  she does not want.

So `job_expire_old_deals` keeps the live-deal path exactly as it was and drops the second insert.

**`prequal_lender_notice_at` keeps being stamped.** It is a real record of when the window closed and
support can read it; it simply no longer implies anyone was told. It was never the source of truth for
visibility — that is computed from `created_at`, so the window closes on time even if the cron never runs
(migration 52's own design). The column comment now says so, since the name suggests otherwise.

⚠️ One structural detail: the notice lived in a `with closed as (update … returning …) insert into
notifications select …` CTE. Removing the insert leaves the CTE with no consumer, which is not a valid
statement, so the prequal branch is now a plain `UPDATE` placed **after** `get diagnostics n = row_count`
— keeping the function's return value the count of live-deal notices, exactly as before.

## I-2 — Don't narrate the document name-check to the broker

> *"Could we remove the orange text below the upload, where it says "name on document: [name] - a
> preferred-name variance" and just have it say "upload successful" or nothing at all? I think it's better
> that the users don't see that it's just scanning for a name."*

### What changed

The upload card had four states; it now has two.

| Before | After |
|---|---|
| "Checking the name on the document…" + spinner | *(nothing — the check is silent)* |
| "Name matches the primary borrower" | **"Upload successful"** |
| "Name on document: {name} — a preferred-name variance." *(amber)* | **"Upload successful"** |
| "This document is in the name of {name}, which does not match…" | "This document does not match the primary borrower. Replace it with the correct document to continue." |

Removed keys: `docNameVerified`, `docNameVariance`, `docNameChecking`, `docNameMismatchNamed`. Added:
`docUploadSuccess`. Both catalogs, 1656 = 1656.

`checkingKinds` state is gone with the spinner, so `handleUpload` is a plain fire-and-forget again.
`handleSubmit` still **awaits** any pending check — that is the H-1 bypass guard and it is untouched.

### The blocking message stays, and stays nameless

The mismatch line is the one thing that must still speak: it is the whole of H-1, which she asked for on
08-07 and confirmed works ("It seems to work, so that's great"), and a Submit that refuses without saying
why is worse than silence. But the **extracted name is no longer printed anywhere** — that is the part
that reveals a name is being read, and it is her stated objection. The DB error from `submit_deal` already
names the *document* (photo ID / consent form), never the person, so the two layers now agree.

⚠️ **Nothing about the check itself changed.** It still runs, still stores `extracted_name` /
`name_matches` / `name_variance`, still blocks in `submit_deal` (migration 65), still shows in
`/admin/documents` with its badge, and a variance still prints **both names on the invoice** — the
client's own migration-46 rule. Only the broker's screen went quiet.

### 📌 This reverses part of B-34, deliberately

In the 2026-07-23/25 batch she said of this same notice: *"I like that this pops up - so the pdf's are
being scanned, but can you please remove the information about the invoice?"* — B-34 trimmed the invoice
sentence and kept the notice precisely because she liked seeing the scan happen. She has now changed her
mind and wants the opposite. Both are her call; recorded here so nobody re-adds the variance line citing
B-34.

### 🙂 It also closes the gap flagged on 08-07 without being asked to

The 08-07 doc flagged that an **unverified** document rendered nothing at all, next to a sibling reading
"Name matches" — so a broker read blank as fine and then hit a surprise error on Submit. With one neutral
line for every uploaded document, that asymmetry is gone: uploaded reads the same whether the check
passed, varied, failed to run, or is still in flight, and only a real mismatch looks different. The
follow-up flagged there is no longer needed.

---

## Verification

`pnpm check`: 0 errors, i18n **1656 = 1656** EN/FR with every static `t()` resolving, 19 unit tests.

⚠️ **No local environment was used this pass** (explicit instruction), so the smokes were not run — the
data-layer proof is against the real staging database instead. `smoke-prequal.mjs` §9 was still updated in
step with the change and will run on the next local pass.

### I-1, against staging's own data

- **66/66, latest `20260811000066`** on staging; `job_expire_old_deals` no longer contains the prequal
  notice body, still contains the live-deal one, and carries **no PUBLIC grant** (migration 62 holds).
- **Her exact case replayed on her own deal.** `prequal_lender_notice_at` set back to null on
  `DEAL-2026-611`, then `job_expire_old_deals()` called: status stayed `submitted`, `expired_at` stayed
  null, the marker was re-stamped, and notifications went **138 → 138** — nothing to her, nothing to
  anyone. Before the fix that same call inserted the notice. Her original marker
  (`2026-08-10 02:00:00.237776+00`) was then restored, so the row is identical to before the test.
- Safe to run because `would_expire_now` was **0** — no live deal was eligible, so the call could not
  expire anything as a side effect. Checked first, not assumed.
- **The Deal Room hint renders.** Since the only aged prequal on staging is the client's, an existing
  test-broker deal (`DEAL-2026-631`) was flipped to `prequal` and backdated 16 days: the row showed
  **Submitted + Prequal + "Past its 15 days on the lender queues — still yours to move to a live deal or
  delete."** Restored to its exact prior values afterwards (`prequal=false`, original `created_at`,
  `prequal_lender_notice_at=null`). Worth doing because the reply to the client leans on this line as the
  email's replacement — an unverified claim there would have been wrong in front of her.

### I-2, in the browser on staging, against the deployed AI

On the seeded test broker (not the client's account), borrower set to **Robert Okonkwo**:

1. **The variance case — the exact text she asked about.** `id-bob.pdf` (printed "Bob Okonkwo") came back
   from the deployed `match-document-name` as `extracted_name = 'Bob Okonkwo'`, `name_matches = true`,
   `name_variance = true`. That is precisely the state that used to render the amber "Name on document:
   Bob Okonkwo — a preferred-name variance." The card now reads **"Upload successful"** and nothing else.
   Proving it needed a real variance, not a matching document — a clean match would have looked identical
   on screen and proved nothing.
2. **The clean match** (`consent-robert.pdf`, `name_matches = true`, no variance) reads the same
   "Upload successful" — no name, no "Name matches".
3. **The blocking case.** Photo ID replaced with `id-wrong-person.pdf` ("Hector Villalobos") →
   `name_matches = false`: red border, *"This document does not match the primary borrower. Replace it with
   the correct document to continue."*, the summary line under the group, Submit greyed. **The name
   "Hector Villalobos" appears nowhere on screen** though it is stored in the row. The consent card beside
   it still read "Upload successful" — per-document precision, not a blanket block.
4. **Submit still refuses.** Clicked it in that state: deal stayed `draft` with `deal_number` null.
5. Cleaned up: both documents removed through the app's own delete (so the Storage objects went too —
   they do **not** cascade), borrower name restored. 0 documents, 0 storage objects left.

### Prod

**66/66, guard verified, no PUBLIC grant** — and **0 prequals exist on prod**, so I-1 had never fired
there. Not exercised end-to-end in production: it holds one real account and no deals, and proving it
would mean creating test data there.
