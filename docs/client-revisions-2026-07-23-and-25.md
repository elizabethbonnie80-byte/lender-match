# Client revisions — 2026-07-23 (Batch A) + 2026-07-25 (Batch B)

Two emails from **Bonnie Casault** (`bonniec@dominionlending.ca`), cc Elizabeth Iginla, forwarded by Ivan.
**~71 items total.** They overlap heavily, so they are tracked here together — but **Batch A is executed
first**, per the agreed order.

| | Sent | Subject | Items | Focus |
| --- | --- | --- | --- | --- |
| **Batch A** | 2026-07-23 18:39 | *Revisions* | 30 | Lender side only |
| **Batch B** | 2026-07-25 19:05 | *Revisions 2* | 41 | Lender + broker + admin + Create Deal |

Batch A's own framing: *"This is for the lender side. I'm not quite finished the lender side, mostly for
how it interacts with the broker side, so I'll include that in a future email."* → Batch B is that email.

Batch B closes with: *"It is coming together and I think after these 2 emails of revisions are complete
it'll be really close if not done."* — so these two lists are effectively the punch list to done.

> ⚠️ **Source of truth is Gmail, NOT `docs/Revisions_23_Jul_2026.pdf`.** That PDF is a Gmail print and its
> long lines are **clipped at the right page margin — the text is genuinely lost.** Seven Batch-A items
> were cut mid-sentence, including the legal paragraph in A-10 (the PDF lost the entity name
> "LenderMatch Inc." from a contract clause). Everything below was re-read from the original messages on
> 2026-07-27 and is transcribed **verbatim**. If in doubt, open Gmail (`subject:Revisions`), not the PDF.

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs client input · `[blocked]` blocked

---

# Cross-batch notes — READ BEFORE STARTING

## Duplicates (do once)

| Item | Also in | Action |
| --- | --- | --- |
| A-20 remove DECLINED counter | B-35 | One fix |
| A-24 remove something from lender invoices | B-28 (specifies it) | **Use B-28 as the spec** |
| A-14 occupancy missing for lenders | B-12, B-13, B-14, B-15, B-41 | **One migration for ALL missing fields** |
| A-15 max GDS/TDS drops null rows | B-18 (doors), B-19 (titles), B-20 (acres) | **One fix — same root cause** |
| A-9 "Rate Lock" → "Commitment Period" | B-25 (splits turn times) | **Resolve together** |

## 🔴 Conflict: the prequal fine print

The prequal disclaimer arrived **three times, in two different versions**, and B-39 also changes the
delivery mechanism:

| Source | Text | Placement |
| --- | --- | --- |
| **B-39** (2026-07-25) | Longer — adds *"We always recommend a Condition of Financing when a mortgage is needed to purchase a property"* and *"Final approval remains subject to receipt of a complete application, underwriting, property review, and satisfaction of all lender requirements."* | **Pop-up**, as soon as the broker opens the offers on a prequal |
| **2026-07-27 email** (answer to our question) | Shorter | not specified |

⚠️ **We shipped the 2026-07-27 (shorter) text as an inline banner** — see
`docs/client-revisions-2026-07-27.md`. The 07-27 email is *later*, which argues its copy is final, but
B-39 is *more specific* about both the wording and the pop-up. **[?] Must be confirmed with the client
before this is called done.** Do not guess: one is a legal disclaimer.

B-40 additionally wants a **different** disclaimer on **non-prequal** offers, inline in each offer — that
is new work either way.

## Business-rule changes hiding in Batch B (not just UI)

These change money or gating and need care:

- **B-22 — "Open" term must deduct 3 bps, not 5.** ✅ Verified: `product_years('open')` returns `null`, so
  `platform_bps_for` falls through to `else 5`. **This resolves OQ#30** (which we had left at Bubble
  parity, flagged as pending). It changes `platform_bps_for`, i.e. invoice amounts → migration.
- **B-24 — the broker sees GROSS commission, should see NET.** Verified: deal-detail renders
  `offer.commissionBps` raw. He wants 105 shown where the lender offered 110 and the platform takes 5.
  ⚠️ Decide whether the *stored* offer stays gross (it must, for the invoice) and only the broker's view
  nets it — almost certainly yes, so this is a display change, but it must be consistent with B-26's new
  acknowledgement copy.
- **B-4 — penalties must key off turn-time scores only**, not overall satisfaction. Changes
  `job_apply_rating_penalties` + `admin_lender_ratings` + the copy on `/admin/penalties`. Note the survey
  currently captures commitment/doc-review/funded-on-time as booleans and satisfaction 1–5 — check the
  new rule is computable from what we store, or the survey has to change too.
- **B-27 — invoice fee display rounds to whole dollars.** Verified: `app/lender/invoices/page.tsx:73`
  does `Math.round((loanAmount * bps) / 10000)` and line 77 formats with `maximumFractionDigits: 0`. The
  **DB is already correct** (`round(..., 2)` → 187.50); only the display is wrong. Client-side fix.
- **B-2 — no way for an admin to mark an invoice paid.** Verified gap: `/admin/invoices` is read-only, so
  the "paid" analytics can never move. Needs an admin mark-paid action.
- **B-3 — surveys have no comments field.** Verified: `surveys` has `satisfaction` and
  `not_closed_reason` only. Needs a migration + the survey dialog + the admin report.

## Suggested grouping (once the `[?]` items are answered)

1. **One i18n pass** for every copy removal/reword in both batches (~25 items).
2. **One migration** adding every missing lender-visible field (A-14 + B-12/13/14/15/41).
3. **One fix** for null-safe max filters (A-15 + B-18/19/20).
4. **One migration** for the money rules (B-22 Open→3bps, plus B-24's net display).
5. Destructive-button bug (A-12/A-22).
6. Unwired Submitted-Offers message (A-16) — likely also closes A-17.
7. Everything else individually.

---

# BATCH A — 2026-07-23 (lender side) — EXECUTE FIRST

## A1) Sign-in / public

- [ ] **A-2 — Copyright + patent pending at the bottom.** *"add the copywrite at the bottom as we had on
      bubble and can you please add patent pending. So "© 2026 LenderMatch™ Inc. All rights reserved."*
      ⚠️ **Reverses an earlier client instruction** — the app-wide `SiteFooter` was deleted at their
      request (see "Removed (client request)" in `CLAUDE.md`). **[?]** Full footer back, or just a centred
      copyright line? Recommend the line. Use `BRAND`/`COPYRIGHT_HOLDER` from `lib/brand.ts`.
- [ ] **A-4 — Lender logos: in colour, bigger, and remove the heading above them.** *"They look good on a
      mobile phone but very small on a computer. Also, please remove the verbiage above them"* → that is
      **"TRUSTED BY LEADING LENDERS"**. `components/logo-marquee.tsx` renders them desaturated today.
- [ ] **A-5 — Remove the sub-heading under "Welcome Back"** (`Sign in to access your secure lending portal.`)
- [ ] **A-30 — On sign-up, remove the grey line** (`Join our secure lending ecosystem and streamline your
      financial operations.`) **and the icons next to Broker and Lender.**

## A2) Lender — New Deals

- [ ] **A-1 — Dwelling type as CHECKBOXES in the lender filters.** *"We need to be able to exclude certain
      types."* `saved_filters.dwelling_type` is a **single** enum today (migration 30, deliberately).
      Needs a `dwelling_types` **exclusion array** enforced in `saved_filter_matches` and threaded through
      `open_deals_filtered`/`maturing_deals_filtered` — same shape as migration 43. **Migration.**
- [ ] **A-6 — Remove the verbiage under New Deals** (`Recently submitted deals — sorted by closing date.
      COF-specified deals appear first.`)
- [ ] **A-7 — Hide the result-count line** (`2 deals total · sorted by closing date (COF priority)`).
      *"hide this for now? We may reinstate it later"* → **hide, don't delete.**
- [ ] **A-11 — Remove the note at the bottom of New Deals** (`Broker contact details, client name, and
      full property addresses are not disclosed at this stage.`)
- [ ] **A-12 — Decline: fix the all-red button + use this exact copy:**
      > "The broker will not be notified. The declined deal will be removed from your deals. You will not
      > be able to view any deals you have declined."
- [ ] **A-13 — A declined deal must no longer show up in the lender's deals.** `decline_deal` already
      removes it from both feeds (migration `decline_deal_rpc`) — **reproduce first** to find where it
      still appears (likely Submitted Offers). A-12's new copy promises it can never be viewed again, so
      the two must agree.
- [ ] **A-14 — Occupancy is not visible to lenders. ✅ CONFIRMED BUG.** `deals.occupancy` exists and is
      both a saved-filter criterion and a **scored match criterion (weight 4)**, yet it is NOT among the
      39 OUT columns of `open_deals_for_lender` (verified against the local DB). Migration 29 missed it.
      **Do this together with B-12/13/14/15/41 in one migration.**
- [ ] **A-15 — A max GDS/TDS filter wrongly drops deals with no GDS/TDS.** *"it removed the deal without
      the numbers showing … it's a max number. **If there isn't a number at all it shouldn't remove it**,
      but this can likely also be fixed by just requiring the broker include the GDS and TDS ratios in
      create deal."* → primary fix is **null-safe max filtering**; making the ratios mandatory is his
      secondary idea and would not repair existing null rows. **Same fix as B-18/19/20.**

## A3) Lender — Make Offer

- [ ] **A-8 — Remove two lines from the offer dialog:** `Commission is entered in basis points (bps). Your
      identity stays hidden from the broker until they accept your offer.` and `Loan-pricing info shown to
      the broker for comparison — does not affect the invoice.`
- [ ] **A-9 — *"Please remove 'Rate Lock' from all offers and submitted offers pages. It's a 'Commitment
      Period'."*** **[?]** We hold two distinct fields (`rate_lock_days`, `commitment_turn_time_days`).
      Likely a **relabel**, but he wrote "remove". **Resolve together with B-25**, which splits the turn
      times into "underwriter review" and "document review".
- [ ] **A-10 — Replace the platform-fee fine print with exactly:**
      > "The Lender agrees that, upon funding of any mortgage matched through the platform, the applicable
      > platform fee (calculated in basis points) shall be reserved by the Lender and paid directly to
      > LenderMatch Inc. in accordance with the payment terms specified in the corresponding invoice. The
      > Lender is responsible for ensuring sufficient funds are withheld and remitted when due."

      Lives under "Final Commission Amount" in `components/make-offer-dialog.tsx` **and duplicated in
      `components/auto-offer-manager.tsx` — keep both in step.**

## A4) Lender — Messages

- [ ] **A-16 — A message sent from Submitted Offers never reached the messages record. ✅ REAL BUG,
      already known.** That button is a **prototype that never sends** — it only shows a simulated
      confirmation (item #18 of the UI/UX audit in `~/.claude/plans/warm-twirling-raccoon.md`). His
      screenshot proves it: the dialog says `DEAL-2026-504`, the Messages list holds only `DEAL-2026-88`.
      Fix = route through `send_deal_message`, as the feeds already do.
- [ ] **A-17 — *"please ensure the messages are not deleted until 120 days after the chosen closing date
      for each file."*** ⚠️ **Nothing in this codebase deletes messages** — no cron, no policy (the only
      retention job is `purge_expired_documents`, on `deal_documents`). His *"about an hour later they
      were gone"* is almost certainly **A-16**: never persisted, so nothing vanished. **Verify that
      first** — if A-16 explains it, this needs no code, only an answer. Don't add a deletion job in order
      to then not delete.
- [ ] **A-18 — Remove the grey line under "Messages"** (`Your deal conversations. The broker's identity
      stays hidden until your offer is accepted.`)

## A5) Lender — Submitted Offers

- [ ] **A-19 — The lender can't see the loan details; should see the same data as New Deals.** Reuse
      `components/lender-deal-sections.tsx`. Pairs with A-14.
- [ ] **A-20 — Remove the "DECLINED" counter** (*"We don't want to highlight that"*). = B-35.
- [ ] **A-21 — Remove the verbiage** (`Deals where you have sent an offer — track status and broker
      responses in real time.`)
- [ ] **A-22 — Withdraw offer: the confirm button is solid red with NO visible label.** Same root cause as
      A-12. This is the destructive-variant colour family that has bitten us twice (see the `--accent`
      warning in `CLAUDE.md` → Conventions → UI). Fix both, and **check resting AND hover state.**

## A6) Lender — Invoices

- [ ] **A-23 — Replace the intro copy with exactly:**
      > "Invoices are generated automatically when an offer is accepted and is due 3 weeks after the
      > estimated closing date. For billing inquiries, contact support@lendermatch.ca."

      "3 weeks" matches the implemented `due_date = closing_date + 21 days` ✅. Use `SUPPORT_EMAIL`.
- [ ] **A-24 — Remove an element from the invoices page** (*"Lenders will be paying individually so it's
      not needed"*). **Specified by B-28** → remove the **Amount Due and Paid tiles**, keep Pending +
      Overdue. Keep all four for admin.
- [ ] **A-25 — Questions, not changes:** *"can you confirm … that this one shows the number of deals that
      are overdue and not an overdue amount and same for paid? How long do the paid files stay for?"*
      The tiles already show counts ✅ — answer him. Retention of paid invoices is a **policy answer**
      (today invoices are never deleted). **[?]**
- [ ] **A-26 — Remove the grey line under "Invoices"** (`Lender fee invoices for funded deals`).

## A7) Lender — FAQ / Contact

- [ ] **A-27 — Remove the grey line under "Lender FAQ's"** (`Answers to the most common questions from
      lenders on our platform.`)
- [ ] **A-28 — Support hours → exactly** `Monday to Friday 9:00 AM - 5:00 PM MST.` (currently *"Monday to
      Friday, 8:00 AM – 6:00 PM EST"*).
      ⚠️ `components/faq-view.tsx` is **hard-coded English** — do this as part of moving its strings into
      the catalogs, or FR keeps the old hours.
- [ ] **A-29 — Remove the grey line under "Contact Us"** (`Our lender support team is here to help. Reach
      out through any of the channels below.`)

## A8) Platform-wide

- [ ] **A-3 — Re-agreement pop-up when the TOS or Privacy policy changes.** *"We had talked about having
      lenders and brokers have a pop up every time we changed the TOS or Privacy policy so they have to
      re-agree to everything. **Is that functional now?**"* → **Answer: no, never built.**
      `legal_documents` already versions/publishes (one live per type), but nothing records per-user
      acceptance. **New feature**: acceptance table (user × document version), a gate in the layouts, a
      dialog. **Not in Round 3 scope — size it and get approval. [?]**

---

# BATCH B — 2026-07-25 — EXECUTE SECOND

## B1) Admin portal

- [ ] **B-1 — Phone numbers submitted in messages were NOT flagged in the admin portal.** Anti-contact
      blocked the send (B-16 confirms the message was refused), so the question is whether
      `scan_and_log` wrote the `admin_alerts` row. Reproduce and check the Alerts page — the alert is
      logged in its own transaction precisely so it survives the blocked write.
- [ ] **B-2 — No way to mark an invoice paid in Admin, so the analytics can never show paid.** ✅ Verified
      gap: `/admin/invoices` is read-only. Add an admin mark-paid action (the lender already has one).
- [ ] **B-3 — Surveys need a comments field, and an admin place to read them.** ✅ Verified: `surveys` has
      `satisfaction` + `not_closed_reason` only. Migration + survey dialog + admin survey report.
- [ ] **B-4 — Penalise on TURN-TIME scores only, not overall score.** *"Both the commitment and the doc
      review turn time scores are what we really want to penalize - not over all score."*
      Changes `job_apply_rating_penalties`, `admin_lender_ratings()` and the `/admin/penalties` copy
      (which currently states the avg-satisfaction-below-3 rule). **Check the new rule is computable from
      what the survey stores** — today those two are booleans, not scores.
- [ ] **B-30 — Edit the invoice template from Admin** (*"We need to add payment info etc. but we don't
      have it yet"*). New feature; the PDF is generated by the `invoice-pdf` edge function, so a
      template-editing UI means moving copy into the DB. **[?] Size it — likely its own quote.**

## B2) Create Deal (broker side)

- [ ] **B-5 — Income label → exactly** `Casual/seasonal/part-time income (2y avg)` (*"what it was before"*).
- [ ] **B-6 — Credit issues: append "(non-mortgage)" to the three late-payment options** → `30+ day lates
      (non-mortgage)`, `60+ day lates (non-mortgage)`, `90+ day lates (non-mortgage)`.
- [ ] **B-7 — Remove the grey line under "Create New Deal"** (`Complete all sections to submit your
      mortgage deal for processing.`)
- [ ] **B-8 — Reorder the program checkboxes** so the two co-signer options and the guarantor sit
      together — *"Perhaps on the very right?"* (screenshot: Co-signor occupying is currently in column 1
      while Co-signor not occupying and Guarantor are in column 3).
- [ ] **B-9 — Rename "Credit Score" → "Primary Credit Score"** on page 3 of Create Deal (*"As it was in
      bubble"*).
- [ ] **B-36 — Add to the bottom of the LAST page of Create Deal, exactly:**
      > "You confirm that the information provided is accurate to the best of your knowledge. Material
      > changes to the borrower's financial circumstances or the mortgage opportunity should be updated
      > promptly, as they may affect lender interest."
- [ ] **B-34 — The document-scan notice must not mention the invoice.** *"I like that this pops up - so
      the pdf's are being scanned, but can you please remove the information about the invoice? That's not
      for the broker to be concerned about."* → strip *"both names will appear on the invoice"* from
      `createDeal.docNameVariance`. 📌 **Useful context: the client is happy that the name check does NOT
      block submission** — which independently confirms the answer we gave the project manager on
      2026-07-27.

## B3) Broker portal

- [ ] **B-10 — Remove the grey line under "Deal Room"** (`Manage and track all your mortgage deals`).
- [ ] **B-23 — Mirror to the broker portal everything added on the lender side** — *"the titles showing,
      the product choices etc."* (i.e. the same missing-fields work as A-14/B-12…41, applied to the
      broker's deal view).
- [ ] **B-24 — A received offer shows the broker the FULL commission, not what they will receive.**
      *"Please have this show as the 105 that it should be. (the lender offered 110 but the platform
      charged 5 so 105 should be showing)"* ✅ Verified: deal-detail renders `commissionBps` raw. The
      stored offer must stay gross (the invoice depends on it) — net it in the broker's view only.
- [ ] **B-26 — Replace the accept-offer confirmation copy with exactly:**
      > "You're about to accept this offer. Other pending offers will be declined, the lender's identity
      > will be revealed. You can still switch lenders up to 2 times per calendar month.
      >
      > Broker Acknowledgement: By accepting this offer, you acknowledge that the commission amount
      > displayed reflects the amount payable to you after the applicable platform fee has been deducted.
      > The lender will remit the platform fee directly to LenderMatch TM on your behalf. The applicable
      > platform fee is 3 basis points (bps) for mortgage terms of 3 years or less, 4 basis points (bps)
      > for 4-year terms, and 5 basis points (bps) for mortgage terms of 5 years or more. By proceeding,
      > you authorize this payment arrangement."

      Note this **drops the mention of the invoice being generated** and states the bps table — which is
      consistent with our implementation **except for "Open"** (see B-22).
- [ ] **B-31 — Delete the post-accept green banner** (`The lender has been notified and the platform-fee
      invoice was generated. If you switch (max 2 per calendar month), that invoice is deleted and the
      lender's portal shows the offer as declined.`)
- [ ] **B-32 — Instead, show a switch counter per calendar month**, as Bubble had.
      ✅ The data exists — `profiles.offer_switches_this_month` + the monthly reset cron.
- [ ] **B-38 — Add near the top of lender New Deals AND Maturing Deals** (visible on load but not
      conspicuous), exactly:
      > "Mortgage deals are provided for preliminary evaluation purposes only. Information is supplied by
      > the originating broker and has not been independently verified by the platform."
- [ ] **B-37 — Add when a lender sends an offer, exactly:**
      > "Offers represent a lender's preliminary interest based on the information provided and do not
      > constitute a mortgage approval, commitment to lend, or rate hold. Final approval remains subject
      > to receipt of a complete application, underwriting, property review, and satisfaction of all
      > lender requirements."

      ⚠️ Note the tension with **A-8**, which removes two other lines from that same dialog. Both can
      hold — remove those, add this — but re-read the dialog as a whole afterwards.
- [ ] **B-39 — Prequal fine print as a POP-UP when the broker opens the offers on a prequal:**
      > "Pre-qualification offers are intended to help identify potential lender interest and are not
      > binding commitments or rate holds. We always recommend a Condition of Financing when a mortgage is
      > needed to purchase a property. Rates, terms and lending conditions are subject to change at any
      > time. Offers shown on the platform will not be updated to reflect the future rate changes. Final
      > approval remains subject to receipt of a complete application, underwriting, property review, and
      > satisfaction of all lender requirements."

      🔴 **Conflicts with the 2026-07-27 text we already shipped** — see "Conflict" above. **[?]**
- [ ] **B-40 — Fine print on NON-prequal offers received** (not a pop-up — *"just add it in below/inside
      each offer"*):
      > "Lender offers are intended to help identify lender interest and are not binding commitments or
      > rate holds. We always recommend a Condition of Financing when a mortgage is needed to purchase a
      > property. Rates, terms and lending conditions are subject to change at any time. Offers shown on
      > the platform will not be updated to reflect the future rate changes. Final approval remains
      > subject to receipt of a complete application, underwriting, property review, and satisfaction of
      > all lender requirements."

## B4) Lender — missing deal fields (one migration with A-14)

- [ ] **B-11 — Hide the "1 new this week" badge in the lender deal room** (*"I didn't see it before. We may
      want it showing at some point but not now"*) → hide, don't delete.
- [ ] **B-12 — The product/program options are gone**: FTHB, Networth, Medical Professional etc. must show.
- [ ] **B-13 — Liquid and non-liquid assets are not showing for lenders.**
- [ ] **B-14 — Show the number of door titles, and add a filter for it.** (We added `door_titles_count` in
      migration 36 and a `max_door_titles` filter in 43 — so verify what is actually missing: the display,
      the filter, or both.)
- [ ] **B-15 — The TransUnion checkbox result must show on the lender side.**
- [ ] **B-41 — Also missing: transaction purpose, transaction type, and the property options** (New Build,
      Hobby Farm etc.) — *"please add all of those so they are visible for lenders and brokers"*.

## B5) Lender — filters

- [ ] **B-18 — Max Doors removes deals with 0 doors.** *"It should only remove deals that are OVER the
      number of doors allowed."*
- [ ] **B-19 — Max Titles: same bug.**
- [ ] **B-20 — Max Acres: same bug** — *"it is removing deals that don't have an amount listed. This is not
      what we want."*
      → **B-18/19/20 + A-15 are one fix**: a max filter must pass rows whose value is NULL or 0.
- [ ] **B-21 — Remove "Married / Common Law" as a filter** (*"We don't need this as a filter"*).

## B6) Lender — offers & invoices

- [ ] **B-22 — With product "Open" the deduction shows 5 bps; it must be 3 bps.** ✅ Verified:
      `product_years('open')` → `null` → `platform_bps_for` falls to `else 5`. **This settles OQ#30.**
      Migration; affects invoice amounts.
- [ ] **B-25 — "Processing" is not correct: we need underwriter review turn time AND document review turn
      time.** Today the offer holds `commitment_turn_time_days` + `doc_review_turn_time_days` and the card
      shows one "PROCESSING" figure. **Resolve with A-9** — together they define the final turn-time field
      set and labels. Likely a migration if a field is added. **[?]**
- [ ] **B-27 — Invoice amount rounds up: should read $187.50, shows $188.** ✅ Verified: the DB stores
      2 decimals correctly; `app/lender/invoices/page.tsx:73` does `Math.round(...)` and line 77 formats
      with `maximumFractionDigits: 0`. **Display-only fix** — check every other money format too.
- [ ] **B-28 — Lender invoices: keep only Pending and Overdue.** *"We don't need a tally of funds due or a
      tally of paid invoices. We need these in the admin section though, just not in the lender section."*
      = the spec for **A-24**.
- [ ] **B-35 — Remove the declined tally in lender Submitted Offers.** = **A-20**.
- [ ] **B-33 — Auto-offers should allow a closing date 30 days+** (a new criterion on `auto_offers` /
      the saved filter behind it).

## B7) Maturing Deals

- [ ] **B-29 — Maturing Deals is empty for the lender, and the windows need confirming.**
      Verbatim: *"there should be deals in there but I don't see any as a lender. There's also deals that
      were in the portal before I signed up a few days ago that should have transferred over there. To
      confirm - the deals in New Deals should be 0-1 days old (0 - 48 hours). Then they are transferred to
      Maturing Deals where everything shows up after the 48 hour mark. If I don't have a lot of saved
      filters, they should still show up because they are a less than 70% match."*
      Three things to untangle:
      1. **"everything shows up after the 48 hour mark"** — our Maturing window is **2–14 days** and
         Expired is **15+** (Round 3 Phase 1, migration 37, which is what closed OQ#18). His wording
         suggests Maturing has **no upper bound**. **[?] Confirm** — if there is no cap, the 15-day
         expiry and the Expired window need rethinking.
      2. **Older deals "should have transferred over"** — deals submitted before he signed up may be
         15+ days old and therefore **expired**, which is why they are absent. Verify against real data.
      3. **Match % must not filter** — a <70% match should still be listed. Verify `maturing_deals_*`
         does not drop low scores (it should only *colour* them).

## B8) Anti-contact

- [ ] **B-16 — The regex catches phone numbers but only catches a name when preceded by "my name is".**
      *"I would like it to catch names as well - without explicitly saying 'my name is'."*
      Today the regex layer matches the **sender's own first/last name**; free-standing third-party names
      are the Claude layer's job. Check the AI layer is actually reachable in the messages path (it needs
      `ANTHROPIC_API_KEY` on the deployed function and only runs when the regex is clean and the text is
      > 20 chars — "Rick McDonald" alone is under that threshold, which may be the whole explanation).
- [ ] **B-17 — Uploaded PDFs: nothing shows they were scanned, and there is no way to view them.**
      *"I uploaded a pdf service agreement and ID but I don't see anything showing it was scanned? And
      where can we view them in case we need to?"*
      The scan result IS shown in Create Deal (that is the popup he praises in B-34), so this is about
      **after** submission: the broker/admin needs a place to see the documents and their scan status.
      Note the RLS deliberately allows owner/admin/brokerage-admin only — **never lenders.**

---

## Open questions to send back

1. **🔴 Prequal fine print** — which version is final (the 2026-07-25 longer text or the 2026-07-27
   shorter one), and pop-up or inline? *(We shipped the 07-27 text inline.)*
2. **A-9 + B-25** — final turn-time field set and labels: is "Rate Lock" relabelled to "Commitment
   Period", or removed? And is "underwriter review turn time" a new field or a rename of the existing
   commitment turn time?
3. **A-2** — full footer back, or just the copyright line? (It was removed at their earlier request.)
4. **A-3** — is the TOS/Privacy re-agreement pop-up approved as new scope?
5. **B-29** — does Maturing Deals have an upper age bound at all? If not, what happens to the 15-day
   expiry and the Expired window (this reopens OQ#18, which Round 3 had settled)?
6. **B-30** — admin-editable invoice template: confirm as new scope + estimate.
7. **A-25** — how long should PAID invoices be retained?
8. **B-4** — penalties on turn-time only: which exact figures, given the survey stores those two as
   yes/no rather than scores?

## Status

Both batches transcribed from the original Gmail messages and triaged **2026-07-27**.
**Nothing implemented yet.** Batch A first, then Batch B, following the grouping above — except where a
Batch-B item is the specification for a Batch-A one (A-24 ⇠ B-28) or shares its root cause (A-14, A-15,
A-9), in which case do them together.
