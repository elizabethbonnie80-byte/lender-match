# Client revisions — 2026-07-30

Elizabeth's review pass after the 57–62 deploy went live. **10 items in the email**, plus **1 more sent
separately** the same evening (auto-offer discoverability, E-11).

Source: Gmail thread *"LenderMatch — July 23 & 25 Revisions Update"*, Elizabeth Iginla → Ivan,
2026-07-30 17:26, forwarded 17:56. Nine inline screenshots, one per item — they only show which screen
she means, so the wording below is quoted from the email body, not read off the images.

This is the **fifth** revision batch. The previous four are all closed:
[07-20](./client-revisions-2026-07-20.md) · [07-27](./client-revisions-2026-07-27.md) ·
[07-23-and-25](./client-revisions-2026-07-23-and-25.md) · [07-28](./client-revisions-2026-07-28.md).

---

## Status at a glance

| ID | Item | Verdict |
|---|---|---|
| **E-1** | Filter exclusion hint wording | ✅ Done |
| **E-2** | Legal page back-link goes to the previous page | ✅ Done |
| **E-3** | "Terms of Service" → "Terms & Conditions" site-wide | ✅ Done |
| **E-4** | Collapse a deal card once its offer is sent | ✅ Done |
| **E-5** | Transaction Type optional, and not filtered out when blank | ✅ Done — **migration 63** |
| **E-6** | Spelling: co-signor → Co-signer | ✅ Done |
| **E-7** | Make notifications more prominent | ✅ Done — banner instead of the modal, §E-7 |
| **E-8** | Suspension warning on the anti-contact notice | ✅ Done |
| **E-9** | Remove "Anonymous mortgage marketplace" from the invoice | ✅ Done |
| **E-10** | Lender invoices: "PDF" → "View", first in the list | ✅ Done |
| **E-11** | Auto-offers are hard to find | ✅ Done — **migration 64**, §E-11 |

**All 11 items are built.** Nine are copy, layout or one predicate. **E-5 and E-11 carry the
engineering**, and E-5 is the one worth reading in full, because the obvious version of that change
would have produced the opposite of what she asked for.

---

## E-1 · Filter exclusion hint wording

> In the lender filters section, under each checkbox filter category, could we replace the current red
> instructional text with "Check any [category] you wish to exclude. Deals containing the selected
> [category] will not be shown to you."? I'm thinking that wording might be clearer since they are
> checking items to exclude which could potentially be confusing.

Six strings, one render site: `SectionTitle`'s `hint` prop in `components/deal-filters-sidepanel.tsx`,
called once per category. The panel is mounted on both New Deals and Maturing, so both screens change
together.

**Found while doing it:** the six were not consistent with each other. Five read *"Check if you do NOT
want the X included:"*; Dwelling Type — added later, in the 07-23 batch — read *"Tick the dwelling types
you do NOT want to see."* Different verb, different sentence shape, period instead of colon. Her
rewrite makes all six the same sentence, which is most of the value here.

The categories are Credit Issues, Down Payment Source, Residency, Dwelling Type, Income Type and
**Others**; the last one covers program/product flags, so its noun is "programs or products".

---

## E-2 · Legal page back-link

> For the new footer with links to Terms of Service and Privacy Policy, once those are clicked, the user
> sees an option to "go back to signup", even if they are already logged in, and even if that isn't the
> last page they visited. Can we change that to go back to the page they were previously on?

Correct, and it is exactly as literal as it sounds: `app/legal/[doc]/page.tsx` had
`<Link href="/sign-up">` hardcoded. The link predates the footer — when it was written, sign-up was the
only way to reach the page, so it was right at the time and became wrong when A-2 put those links on
every page in the app.

Now `router.back()`, with `router.push('/')` as the fallback when there is no history to go back to —
which happens when the document is opened in a **new tab**, and that is not a corner case here: both the
sign-up checkbox and the re-agreement gate open these pages with `target="_blank"` on purpose.

---

## E-3 · One name for the terms document

> Could you also change the wording in the footer from Terms of Service to "Terms & Conditions" so that
> it is consistent with the header they see once they click the link? It should consistently be called
> one or the other throughout the site.

She spotted a real inconsistency and asked for the general rule, so it is applied as the general rule
rather than only in the footer. Before: **"Terms of Service"** in the footer, the sign-up checkbox (and
its validation error) and the legal re-agreement gate; **"Terms & Conditions"** on the public page's own
`<h1>` and throughout the admin editor.

Unified on **"Terms & Conditions"** — that is the heading of the document itself, which is the one label
a user can't be shielded from. FR follows: *"Conditions générales"* everywhere (it had *"Conditions
d'utilisation"* in the same three spots).

---

## E-4 · Collapse a card once its offer is sent

> When a lender submits an offer on a deal, is it possible to collapse the deal details so that it's
> easier to see the next deal that needs an offer? Maybe that blue heading with the deal number and the
> "offer sent" text can be all that shows unless the lender clicks on it to open again?

Exactly what it now does. Two things worth knowing:

- **There was no collapse mechanism anywhere in the feed** — every card rendered all three detail
  sections (~43 fields) unconditionally. This adds one rather than flipping a flag.
- **The card is on borrowed time either way.** Migration 34 removes a deal from the feeds once the
  lender has offered on it, so it survives only until the next server fetch. That does not make the
  collapse pointless — it is precisely her case, a lender working down the list — but it does mean the
  collapsed card is a transient state, not something to persist.

Her "blue heading" is grey (`bg-muted`) on New Deals and match-coloured (yellow/orange/red) on Maturing.
No colour was changed; the description just doesn't match what is on screen.

---

## E-5 · Transaction Type optional ⚠️ the one with a trap

> can we make the Transaction Type optional instead of required? and if the broker doesn't select a
> transaction type (from the list of prime, alt and private), the transaction type filter doesn't apply,
> so that the deal runs through all 3 lender types and isn't filtered out by transaction type alone? And
> then add a note beside Transaction Type that says "Only select if confident on transaction type."
> Some brokers will be using this platform because they are unsure of which lender type to use, so this
> being optional may give them more confidence that the deal will be shown to the appropriate lenders.

`deals.transaction_type` was **already nullable** — no schema change. The work is in the two places that
read it, and the second one is the trap.

### The visibility bug (`saved_filter_matches`)

```sql
(sf.transaction_type is null or sf.transaction_type = d.transaction_type)
```

Null-safe for the *filter's* value, not for the *deal's*. With `d.transaction_type` null the comparison
yields NULL, which inside an AND chain is indistinguishable from FALSE — so the deal silently vanishes
from every lender who set a transaction type. Same class of bug as
[migration 54](../supabase/migrations/20260727000054_null_safe_max_filters.sql), fixed the same way.

This one function is the convergence point for the saved-filter chips, the ad-hoc Filters panel, the
`submit_deal` filter-match notifications and `send_auto_offers` — one predicate covers all five paths.

### The ranking trap (`match_percentage`) — the reason to read this section

```sql
if sf.transaction_type is not null then
  total := total + 18;
  if sf.transaction_type = d.transaction_type then matched := matched + 18;
  else fails := array_append(fails, 'Transaction Type'); end if;
end if;
```

Same shape, worse consequence. The criterion is gated on the **filter's** value alone, so a null deal
takes the ELSE branch: **18 points charged to the total, 0 earned** — and transaction type is the
heaviest weight in the whole engine. The deal caps around 82%, renders a red *"Does not match:
Transaction Type"* chip, and because Maturing orders by `pct desc`, **sinks below every typed deal on
every lender's list**.

So the obvious version of this change — delete the asterisk, drop the required check — would have made
the deals of exactly the brokers she is trying to help visible but last and flagged in red. The
criterion now drops out of the denominator entirely when the deal has no type, which is what "the
transaction type filter doesn't apply" has to mean for a weighted score.

### The write-once trap

The control is a shadcn `<Select>`, and a `SelectItem` cannot carry an empty value. `""` worked only as
the *initial* state. Without a sentinel, a broker who picked "Prime" once could never get back to blank
— not on a resumed draft, not when editing a submitted deal. Added a **"Not specified"** item following
the `any` sentinel already used in `components/filter-fields.tsx`.

### Worth telling her

A lender who filtered to "Prime only" **will now see untyped deals.** That is the intended consequence
of what she asked for — it is how the deal "runs through all 3 lender types" — but it is a visible change
to lenders who did not ask for it, so it should not arrive as a surprise.

**Migration 63** replaces both functions. Signatures unchanged, so nothing downstream is rebuilt.

---

## E-6 · co-signor → Co-signer

> on the second page where it says "check all that apply", could you please change the spelling from
> co-signor to "Co-signer".

Six display strings. **No migration**: `cosignor_occupying` / `cosignor_not_occupying` are boolean
**column names**, not enum values, and they also travel as literals in the `p_others_excluded` RPC
protocol across a dozen migrations. Renaming them would be a large, high-risk change for a spelling fix
nobody would ever see. The labels are what she is looking at, and the labels are what changed.

Two defects fixed alongside, both found while editing:

- **EN casing disagreed between sources** — `lib/enums.ts` had title case ("Co-signor Occupying"), the
  i18n catalogs sentence case ("Co-signor occupying"). This is the trap already recorded in CLAUDE.md:
  the same label lives in both files and one edit does not reach the other screen.
- **FR was wrong** — *"Coemprunteur"* means co-*borrower*, a different role. Now *"Cosignataire"*, which
  is what `lib/enums.ts` already said.

---

## E-7 · Notifications more prominent

> Can we make the notifications more prominent? Right now they're just the small bell in the corner with
> the red bulb, perhaps it can be a bit larger or more obvious somehow so that the notifications aren't
> ignored? Maybe deal room and messages also need the red bulb when there are new notifications? Or maybe
> when logging in, there's a popup saying they have x number of notifications, with a button to "View
> Notifications" now?

Three options offered; they are not alternatives, and one of them we would push back on.

| Option | Assessment |
|---|---|
| Bigger bell / louder badge | Trivial. Do it. |
| Red dot on Deal Room + Messages | Worth doing. Per-thread unread already exists (`my_chat_threads`); an aggregate does not, so it needs either a client-side sum on header mount or a small count query. |
| Login popup | **Advise against.** The app already mounts one non-dismissable modal (the legal re-agreement gate). A second modal on every login trains people to dismiss modals unread — the opposite of the goal. |

**A real bug found while assessing this, fixed regardless of her choice:** the bell's badge counted
unread within the **newest 20** notifications only — `unread` was derived client-side from
`listNotifications`, which is capped at 20. A lender with 30 unread was told they had fewer, on the exact
badge meant to tell them how much they had missed. `unreadNotificationCount()` already existed in
`lib/queries/notifications.ts`, did the exact count, and **was called nowhere.** Now wired.

### What shipped

| | |
|---|---|
| Bell | `h-5 w-5` in an `h-10 w-10` button — deliberately larger than its neighbours — and the badge gets a ring in the header colour so it reads as a raised pip. |
| Count | Exact server count via `unreadNotificationCount()`, not "unread among the 20 I happened to load". |
| Nav dots | `components/nav-unread-dot.tsx` on **Messages** (both portals) and on the role's deal surface — **Deal Room** for brokers, **Submitted Offers** for lenders. |
| Banner | `components/unread-banner.tsx` on `/deal-room` and `/lender/new-deals`. |
| Shared state | `hooks/use-unread.ts` — one hook feeding the bell, the dots and the banner, Realtime-subscribed. |

**The two dots read from different sources on purpose**, and it is not an inconsistency worth
"fixing" later:

- the **deal dot** counts unread NOTIFICATIONS of that surface's types (`DEAL_SURFACE_TYPES`), which is
  literally what she asked for — "the red bulb when there are new notifications";
- the **messages dot** counts unread MESSAGES from `my_chat_threads`. That is the truthful signal and it
  self-clears through `mark_chat_read` when the thread is opened. A notification-derived dot would sit
  there after the lender had already read and replied to the conversation.

Verified in the browser: reading the thread cleared the Messages dot while the Submitted Offers dot
stayed — the intended asymmetry.

### The popup: declined, with a substitute

Her third option was a modal on login. Not built, and the reasoning belongs on the record: the app
**already mounts one non-dismissable modal** (the legal re-agreement gate, A-3). A second blocking
dialog on every sign-in teaches people to close dialogs without reading them, which is precisely the
behaviour she is trying to stop. The banner sits in the content flow instead — unmissable on arrival,
free to walk past.

Dismissal is per session **and per count**: closing it at 3 unread keeps it hidden at 3 but brings it
back at 4. That is what keeps it from being either nagging or useless.

---

## E-8 · Suspension warning on the anti-contact notice

> In messages, when there is any attempt to share contact info prior to an offer being accepted, can we
> add to the red notice that further attempts to share contact information at this stage may result in
> an account suspension.

Copy-only. The notice is assembled client-side from an i18n template plus a `{reason}` noun phrase that
comes from Postgres (`scan_contact_info`) or from Claude — so appending a sentence is an i18n edit, and
no migration is involved.

She asked for messages. Applied to **every counterparty-facing surface** — the three message dialogs,
offer comments and the four deal notes — because they are the same rule and the same risk, and a warning
that appears on one screen but not the next reads as a bug.

⚠️ **Told her plainly: there is no account-suspension mechanism built today.** The sentence says "may",
so it is honest as a deterrent, but if she wants it to be enforceable that is a separate feature (admin
suspend/reinstate, a blocked-sign-in state, and a decision about what happens to that user's live deals
and offers). Not quoted, not assumed.

---

## E-9 · Remove the tagline from the invoice

> Please remove "Anonymous mortgage marketplace" from Invoices.

One line in `supabase/functions/invoice-pdf/index.ts` — the 9pt subtitle under the brand wordmark in the
PDF header. Needs an **edge-function redeploy** on both environments; it is not shipped by the Vercel
build.

The same phrase also appears in the app's `<meta name="description">` and the README. Left alone — she
asked about the invoice, and the meta description is not user-visible copy.

---

## E-10 · "PDF" → "View"

> On the lender Invoices page, under actions, can you change "PDF" to "View", since it opens a new window
> to view the invoice and doesn't automatically download it. And "View" should be at the top of the list
> if possible.

She is right about the behaviour: the handler resolves a signed URL and calls `window.open(...)` — there
is no anchor, no `download` attribute, no blob. The label was describing a file format rather than the
action. Renamed, moved to first, and the `Download` icon swapped for `Eye` so the icon does not keep
promising a download.

---

## E-11 · Auto-offers are hard to find

Sent separately, same evening:

> can we make the auto-offers box more accessible? Right now it's a bit hidden in settings. Maybe we can
> have an auto-offer switch always at the top that can be toggled on or off, with an auto-offers settings
> button beside it. Otherwise it's a bit hard to find or even know it exists? Please let me know your
> thoughts on this.

The complaint is fair: **Auto-Offers is the 4th of 6 sections in lender Settings, below the entire Saved
Filters list**, which is the longest block on the page. A lender who never scrolls past their filters
will not learn the feature exists.

The switch she describes did not exist in any form: **`is_active` is per auto-offer**, and there was no
lender-level master. All three parts built:

1. **Auto-Offers moved to the top of lender Settings**, with an `#auto-offers` anchor. Half the problem
   for minutes of work.
2. **`components/auto-offer-strip.tsx` at the top of New Deals** — `⚡ Auto-Offers · 1 active` + the
   master switch + a Manage button into that anchor. This is her "always at the top", on the screen
   lenders actually live on. It renders **nothing** when the lender has never created an auto-offer: an
   empty strip advertising a feature with no content would be noise on the busiest page in the app.
3. **`profiles.auto_offers_enabled` (migration 64)**, default TRUE, gating `send_auto_offers`.

⚠️ **The default is load-bearing.** Every lender with a live auto-offer predates this column; a `false`
default would have silently stopped all of them the moment the migration ran, with no UI event and no
notification to explain it. `smoke-auto-offer` asserts the default explicitly for that reason.

**Why a column and not "the strip flips every row":** the no-migration version destroys information.
After one off→on cycle the lender cannot tell which auto-offers they had deliberately paused, because
the master's off state and a per-offer pause collapse into the same bit. Two switches, two meanings.
Verified in the browser and in the smoke: toggling the master left `auto_offers.is_active` untouched.

Precedent, so this is not a new concept in the codebase: `profiles.notify_email_enabled` already sits
above the per-type notification toggles in exactly this shape.

---

## Deploy — LIVE on staging + prod (2026-07-31, `1ffe36d`)

**64/64 migrations on both, advisors 0 ERROR on both.** The deploy also **redeployed the `invoice-pdf`
edge function** on both environments — E-9 changed its header and that function does not ship with the
Vercel build.

Verified against the hosted staging DB, not just locally:

- `smoke-optional-transaction-type` **15/15** and `smoke-auto-offer` **33/33** run against staging,
  plus `smoke-invoice-pdf` / `smoke-notifications` / `smoke-messages` green. The PDF smoke exercised the
  freshly deployed function (15,458 bytes, `pdf_path` stamped).
- The bell read **22** and the staging DB had exactly 22 unread for that lender — the E-7 fix, on real
  data, above the old 20 cap.
- **All four existing staging lenders came out of migration 64 with `auto_offers_enabled = true`**, so
  nothing pre-existing was silently switched off. That was the whole risk of that column.
- The strip's master switch toggled and persisted (`false` → `true`) against the hosted DB.
- ⚠️ On staging the per-row `is_active` was **already** false before the toggle, so that DB read is NOT
  evidence for master/per-row independence. The local smoke is what proves it.

**Not exercised on staging:** E-4 (the staging New Deals feed is empty), E-6 (long wizard) and E-8
(needs a live anti-contact block). All three verified locally; E-6 and E-8 are pure catalog edits.

⚠️ **Prod still has NO published `legal_documents`** — two rows, version 2026-07-18, both unpublished.
So `/legal/terms` and `/legal/privacy` render "Not available yet", and the footer links to them from
every page. Publishing is two clicks in `/admin/legal` and **the first publish fires the A-3
re-agreement prompt for every existing user** — free while prod holds one account, a broadcast after
real signups. Unchanged from the 57–62 deploy; still on the client.

## Verification (local, 2026-07-31)

`pnpm check` green — 0 type/lint errors, EN/FR parity with every static `t()` key resolving, 19/19 unit
tests. `pnpm smoke:quick` **25/26**, the one red being `smoke-invoice-pdf` in the bare run, which is the
documented expected failure (it needs the edge runtime served) — served and exercised separately for E-9.

**New smoke: `scripts/smoke-optional-transaction-type.mjs`** (registered in `smoke-all.mjs`), 15 checks,
all passing. Every assertion carries a typed control so the opposite failure — a filter that suddenly
matches everything — fails too:

| | untyped deal | matching typed | contradicting typed |
|---|---|---|---|
| match % | **100** (criterion skipped) | 100 | **82** (still loses the 18-pt weight) |
| "Transaction Type" miss chip | absent | absent | **present** |
| saved-filter chip feed | shown | shown | excluded |
| ad-hoc Filters panel | shown | shown | excluded |

The 82% column is the evidence that the trap was real: that is exactly what an untyped deal used to
score, and where it used to rank.

**Browser-verified on `:3010`** against the local stack (63/63 migrations):

- **E-1** — all six hints read the new sentence, pulled from the live DOM, not the catalog.
- **E-2** — both branches. From the footer in the same tab: "Return to previous page", and it lands back
  on `/sign-in`. Opened via a real `window.open` (`history.length === 1`): **no control rendered at all**,
  so nobody is offered a link to nowhere.
- **E-3** — footer, sign-up checkbox and the legal page heading all say "Terms & Conditions".
- **E-4** — offering folded the card to its header with "Offer Sent ⌄" and put the next deal needing an
  offer immediately below it; clicking the header reopened it and flipped the chevron.
- **E-5** — no asterisk, defaults to "Not specified", the note is visible, the step advances with the
  field blank, and **Prime → "Not specified" round-trips** (the write-once trap).
- **E-6** — "Co-signer occupying" / "Co-signer not occupying" on step 2.
- **E-9** — the generated PDF's content stream: logo at y 733–763, `LenderMatch™` at (96, 740),
  `Platform Fee Invoice` at (446, 744), then the rule at y=706 with **no text block between** — 27pt of
  clearance under the logo.
  ⚠️ **The obvious check here is a trap.** Searching the inflated stream for the tagline string reports
  "absent" — but so does searching for `LenderMatch`, `Invoice #` and the borrower name, because the font
  is subset-embedded and the glyphs are hex codes. A string search over a PDF proves nothing without a
  control probe. Read the operators.
- **E-10** — "View" with an eye icon, first in the Actions menu, above Paid / Changes / Cancel.

**E-7 / E-11, browser-verified on both portals** (fixtures: 24 unread for the lender, 31 for the broker
— both deliberately above the old 20 cap):

- the bell reads **24 / 31 exactly**, which is the fix itself: the old code could not report more than 20;
- dots on **Submitted Offers + Messages** (lender) and **Deal Room + Messages** (broker);
- reading the thread cleared the Messages dot and left the deal dot — the intended asymmetry;
- the banner shows, dismisses, and does not mark anything read (the bell stayed at 24 after dismissal);
- the auto-offer strip toggles to "Paused — no automatic offers are being sent", **persists to the DB,
  and leaves `auto_offers.is_active` = true**; Manage lands on the anchor with Auto-Offers now first.

**One defect found and fixed in that pass:** the strip's Manage button did nothing. It was
`<Link><Button>…</Button></Link>` — a `<button>` nested inside an `<a>`, so the inner button swallowed
the click. Now `<Button asChild>` so the button renders AS the anchor.

**Not verified in the browser:** the FR side of the new copy (asserted by `check:i18n` parity only), and
the E-8 notices, which need a live anti-contact block to render. Both are pure catalog edits with no
branching.

## Commercial note

Nine of these are absorbed polish. **E-5** and **E-11** are the two with real engineering; E-5 also
fixes a latent null-handling bug that predates the request, and E-7 fixes a second one (the capped
unread count) that nobody had reported. **B-30** (admin-editable invoice templates) is still the only
item awaiting a separate quote, and E-9 + E-10 touch the same invoice surface — worth grouping if B-30
goes ahead.
