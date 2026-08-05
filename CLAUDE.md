# CLAUDE.md — LenderMatch (Loan Link) React + Supabase rebuild

## Project overview

LenderMatch™ (formerly "Loan Link") is a Canadian mortgage marketplace connecting mortgage **brokers**
and **lenders** anonymously. A broker submits a deal (4-step wizard, ~80 fields); lenders browse
**anonymized** deals and make offers (commission always in **bps**); the broker accepts one offer
(max **2 switches per calendar month**); on acceptance identities are revealed and a platform-fee
invoice is generated (3/4/5 bps by term × loan amount).

Roles:
- **broker** — creates/manages own deals.
- **broker admin** — a broker with `is_broker_admin = true`; also sees every deal in their brokerage.
  (It is a flag, not a separate role. Bubble auto-granted it to the first broker of a brokerage —
  pending confirmation, open-questions #23.)
- **lender** — sees all open deals except from blocked brokerages; makes offers; manages invoices.
  Requires manual admin approval after email verification.
- **admin** — the founders: approval queue, flagged-content alerts, analytics, FAQ/legal editors.

**Core invariant: identities are hidden until acceptance.** Brokers must never see lender
name/institution/contact before accepting that lender's offer; lenders must never see borrower name
or property address (or broker identity) before their offer is accepted. This must hold at the
**data layer (RLS)**, not just in the UI — the Bubble original only enforced it in the UI.

This app is a rebuild of a working Bubble.io app. The extracted spec-from-implementation lives in
`docs/extracted/` and is the ground truth for behavior parity:
- `data-model.md` — every Bubble type/field/option set + privacy rules
- `flows.md` — the core business flows, step by step
- `pages.md` — page inventory
- `scheduled-jobs.md` — faked-cron behaviors → real cron mapping
- `test-vectors.md` — known inputs → expected outputs (many verified live)
- `open-questions.md` — 50 numbered discrepancies/decisions; **the client spec wins over the Bubble
  build**, and several decisions are still pending — check before implementing an affected area.

Pending rebuild work (features/polish/decisions not yet done) is tracked in **[`docs/backlog.md`](./docs/backlog.md)**
— separate from the frozen extraction above; keep it in sync with the "Wired / Still mock" lists below.

## Round 3 change request — APPROVED, IN PROGRESS

A third batch of client-requested changes ("Round 3") was fully specced and quoted, and the client
**approved the budget + scope in writing on 2026-07-13**. It is now active work — implement it phase by
phase (Phase 1 → 2 → 3, see `docs/round3-progress.md` for the live checklist), and where Round 3
overrides the original spec (list windows, Confirm Lender, brand) the Round 3 rule now governs. Source of
truth: **`docs/New additions to platform.pdf`** (client's raw request) + **`docs/LenderMatch_Round3_Change_Request.docx`**
(+ a `.pdf` export; final proposal **Rev.3** — retargeted to **this React + Supabase build** instead of
Bubble, **firm 64 h total** [QA/testing included], delivered in 3 phases [21 / 19 / 24 h]; all client
decisions confirmed there in §4).

Scope (grouped as in the proposal; track granular status in `docs/round3-progress.md`):
- **Create Deal** — rename → "Primary Borrower First/Last"; "Married or common law" + "spouse on the
  application?" conditional (credit notes become mandatory if not on app); "Reverse Mortgage" checkbox;
  liquid/total assets (required when Networth checked); "how many titles are the doors on?" input; fix the
  "Multiple" typo; **Credit Issues + Down Payment Source → multi-select checkboxes**; "TransUnion is being
  used" checkbox; rename → "Foreign Income / Down Payment Country" (required on foreign funds too); **(i)
  info popups** for GDS/TDS + the 4 notes (client copy provided); add **Yukon / NWT / Nunavut**; **upload 2
  PDFs** (consent + photo ID) → 120-day retention then auto-delete, deal → Draft if missing, **AI name-match**
  vs Primary Borrower (show both names on invoice on variance); **"No lender exceptions required"** checkbox
  (auto-checked when the 4 notes are empty; gates the auto-offer); option-set alignment.
- **Broker Deal Room** — edit a submitted deal until it has an offer; delete submissions/drafts until an
  offer is accepted (auto-remove from the lender portal if it was submitted).
- **Lender** — auto-deduct the platform bps from the lender's input → net **"Final Commission Amount"** +
  contract fine print; optional **"Lender Fee %"** (display-only, does not affect the invoice); **auto-offer
  engine** (saved standard offers; auto-send only when a deal matches ALL of a saved filter AND all 4 notes
  are empty AND "no exceptions" is checked; never on blocked brokerages; daily confirmation email w/ edit
  link; optional end date; no daily cap); offer-entry prefill + remember-last (always clear comments);
  offers editable until accepted (notify broker on edit); replicate the new Create Deal fields in filters.
- **Platform-wide** — **Prequal → Live Deal** flow (broker uploads a prequal, lenders bid w/ special fine
  print, "Move to Live Deal" adds address/closing/COF, existing offers carry over, no marketplace re-entry);
  **remove "Confirm Lender"** (Accept = reveal + create invoice + confirm in the lender portal in ONE step;
  Switch cancels/deletes that invoice + marks the portal "Declined", no lender notification); **list windows
  New 0–1 / Maturing 2–14 / Expired 15+** (this is the confirmed answer to OQ#18); scrolling lender logos on
  the login page (admin-addable); **rebrand Loan Link → LenderMatch™** + logo across app + emails; broker-admin
  "which broker submitted" field; wire Contact-Us forms → `support@lendermatch.ca` (+ footer line); connect
  the `lendermatch.ca` domain.
- **Deferred within Round 3 (out of quote)** — the auto-block group (Merix/RMG/MCAP) + the "declined-before"
  lender dropdown. **Infra (Rev.3):** Round 3 runs on the delivered React + Supabase stack (pg_cron jobs,
  Supabase Storage, Resend email, Vercel + Supabase domain) — no Bubble plan / Workload-Unit budget applies;
  free/low-tier usage monitored.

**Consequences for current work:** the **rebrand Loan Link → LenderMatch™ is DONE** (Phase 2, 2026-07-17).
Because the app-side brand is centralized in `lib/brand.ts` (see Conventions → Brand), flipping `BRAND` to
"LenderMatch™" + `DOMAIN` to "lendermatch.ca" propagated the wordmark app-wide; the `invoice-pdf` edge fn's
`BRAND` and the `confirmation.html` Auth email template were synced by hand. The client later supplied the
logo asset, so the headers now render a shared **`BrandMark`** (`components/brand-mark.tsx` = the node logo
`public/lendermatch-logo.png` + the `BRAND` text) and the favicon package lives in `public/` (wired via
`app/layout.tsx` `metadata.icons` + `site.webmanifest`); PDFs/other non-header spots keep the text wordmark.
The list-window thresholds (OQ#18), the Confirm-Lender removal
(OQ#21), and the Contact-Us wiring are Round 3 items implemented per-phase — see `docs/round3-progress.md`
for exact status; don't re-derive scope from `open-questions.md` for these three, Round 3 supersedes them.

## Post-Round-3 client feedback (2026-07-20 batch)

After Phase 1+2 went live the client sent a 12-item revision list (source email:
`docs/details_20_07.pdf`). It is tracked item-by-item in **[`docs/client-revisions-2026-07-20.md`](./docs/client-revisions-2026-07-20.md)**
— read it before touching Create Deal labels, the lender approval/signup flow, or the admin portal.
**Shipped and LIVE on BOTH staging and prod (2026-07-21, `81b297b`)**: the auth fixes (#11 idempotent
approval — migration 44, #12 both roles confirm email), the label revisions (#1 Credit Issues hint removed,
#2 "CCB (under 15 years old)", #3 "Borrowed Downpayment", #6 "Hobby Farm"/"Recreational Property"), #4
(assets always visible, mandatory only with Networth), #10 (the client's admin account provisioned on
staging), and the two admin pages **#8 `/admin/brokers`** + **#9 `/admin/organizations`** (both browser-QA'd
on staging). ⚠️ **#8/#9 needed NO migration** — the RLS was
already permissive for admins (`profiles_self_read` = `id = auth.uid() or is_admin()`, `profiles_admin_update`,
the privilege guard's is_admin() exemption, and `lookup_write`/`inst_write` = `for all … using (is_admin())`);
don't add RPCs for them. Still open: **#5** (merge the two "Passive" income types — BLOCKED on the client's
choice of canonical label, needs a data migration) and **#7** (prequal required when there's no address —
belongs to the Phase 3 prequal flow, other dev).

## Client revision batches after Round 3 (read before touching the lender or broker portals)

Six feedback rounds have landed since Phase 3 shipped. Each has its own control doc; **they are the
active work queue.** All are live on prod.

1. **2026-07-20** (12 items) → [`docs/client-revisions-2026-07-20.md`](./docs/client-revisions-2026-07-20.md)
   — **DONE and live on staging + prod.**
2. **2026-07-27** (2 answers) → [`docs/client-revisions-2026-07-27.md`](./docs/client-revisions-2026-07-27.md)
   — prequal lender-only expiry + document retention (migration 52). **DONE and live on staging + prod
   (2026-07-27).**
3. **2026-07-23 + 2026-07-25** (~71 items) → [`docs/client-revisions-2026-07-23-and-25.md`](./docs/client-revisions-2026-07-23-and-25.md)
   — **all 54 bounded items are DONE and live on staging + prod (2026-07-27, migrations 53–56).** 3 more turned out to
   need no code (A-13/A-17/B-1 — see the doc). The 8 open questions and the 5 "out of scope" items were
   answered on 2026-07-28 — see below.
4. **2026-07-28** (the client's answers to those 13) → [`docs/client-revisions-2026-07-28.md`](./docs/client-revisions-2026-07-28.md)
   — **ALL 10 items DONE and live on staging + prod (2026-07-29, migrations 57–62). Nothing is blocked on
   the client; only B-30 is left to quote.** Read that doc before touching the footer, the offer turn-time
   labels, auto-offers, the closing survey, the anti-contact threshold, the rating penalty, invoice
   retention or the legal documents.
   ⚠️ It also settles two disputes in the client's favour with measured evidence: the **AI name detector
   was gated by a 20-character floor inherited from Bubble** (so bare names were never scanned — the
   client's "it only catches 'my name is'" was the symptom, not the cause), and the **turn-time penalty
   trigger** was keyed off overall satisfaction when their May 4 spec said turn time. 4 items are deferred
   to one later pass (3 blocked on her answers + the ToS re-agreement), and **only B-30 (admin-editable
   invoice templates) is out of scope** — down from 5.
5. **2026-07-30** (Elizabeth's review pass: 10 items in one email + 1 sent separately) →
   [`docs/client-revisions-2026-07-30.md`](./docs/client-revisions-2026-07-30.md) — **ALL 11 DONE and
   LIVE on staging + prod (2026-07-31, `1ffe36d`, migrations 63–64).** Read it before touching the legal
   pages, the anti-contact notices, the invoice PDF header, Create Deal's Transaction Type, the
   notification bell/nav badges, or the auto-offer engine.
   **The client approved this batch on 2026-08-02 with exactly one correction — `F-1`, the permanent red
   dot on Submitted Offers, now DONE and LIVE on staging + prod (2026-08-03, `515dd68`, NO migration).**
   Everything else in the batch is accepted, including the banner-instead-of-modal substitution.
   ⚠️ **E-5 made `deals.transaction_type` OPTIONAL, and the interesting part is not the form.** The column
   was already nullable; two read-side predicates assumed it never was. `saved_filter_matches` compared a
   NULL with `=` (NULL inside an AND chain reads as FALSE → the deal vanished from every lender who had
   set a type), and `match_percentage` gated the criterion on the FILTER's value alone, so an untyped deal
   was charged the **heaviest weight in the engine (18 pts)** as a miss — capping it near 82%, flagging a
   red "Transaction Type" chip and sinking it to the bottom of Maturing, which orders by pct. Shipping
   only the form change would have left the deals of exactly the brokers she wanted to help visible but
   last and flagged. **A newly-optional deal field has to be checked against BOTH functions, not just the
   form** — `saved_filter_matches` for visibility, `match_percentage` for rank.
   Also settled there: E-2's back link was `href="/sign-up"` hardcoded, and E-3 unified the terms document
   to **"Terms & Conditions"** in all five places it is named (it was "Terms of Service" in three).
   ⚠️ **E-7 fixed a second latent bug nobody reported: the bell's unread badge counted only within the
   newest 20 notifications** (it derived `unread` from the capped `listNotifications`), so anyone past 20
   was told they had fewer than they did. `unreadNotificationCount()` had been sitting there unused.
   Unread state now lives in ONE place, **`hooks/use-unread.ts`**, feeding the bell, the nav dots and the
   banner. The two nav dots read from **different sources on purpose** — the deal dot (broker Deal Room /
   lender New Deals) counts unread NOTIFICATIONS of that nav item's types (`DEAL_SURFACE_TYPES`), the
   Messages dot counts unread MESSAGES from `my_chat_threads` so it self-clears via `mark_chat_read`
   instead of outliving the conversation. Don't "unify" them.
   The client asked for a **modal popup on login; we deliberately shipped a dismissible banner instead**
   (`components/unread-banner.tsx`) — the app already mounts one non-dismissable modal (the A-3 legal
   gate) and a second per login trains people to close dialogs unread. Reasoning is in the control doc;
   don't silently convert it to a modal. **The client accepted the banner explicitly on 2026-08-02**
   ("I like how you added the auto offers and notifications banner at the top as well") — that substitution
   is settled, so it is not an open question to revisit.
   ⚠️ **F-1 (2026-08-02) is FOUR bugs behind one complaint, and the rules behind them generalize.** She
   reported a "permanent red notification dot" on Submitted Offers and was right on every count.
   **(a)** `DEAL_SURFACE_TYPES.lender` fed the dot `auto_offer_sent`, which is the **daily digest cron** — a
   scheduled heartbeat re-lit it every morning, so nothing a lender did kept it dark. **(b)** It also fed it
   `filter_match`, whose own `notificationHref` routes to `/lender/new-deals`, so the dot lit one page over a
   deal that lived on another. Now `lender: ['filter_match']`, on the New Deals item; measured on staging,
   every lit dot was held up by rows unread for 8–23 days. **(c)** ⚠️ **"Mark all read" did not clear the
   badge, the dot or the banner at all** until the next navigation — because **Supabase Realtime delivers the
   INSERTs but NOT the `is_read` UPDATEs**: `notifications` has `REPLICA IDENTITY DEFAULT`, so on an UPDATE
   the old tuple carries only the PK and the subscription's `recipient_id=eq.<uid>` filter has nothing to
   match. Fixed with **`notifyUnreadChanged()`** in `hooks/use-unread.ts`, called by the three writers
   (`notification-bell`, `notifications-view`, `messages-inbox` — the Messages dot had the same defect).
   `replica identity full` would also work and was rejected: it writes the whole previous row to the WAL on
   every UPDATE of the busiest table, to broadcast an event back to the tab that caused it.
   **(d)** ⚠️ Found on STAGING after (a)–(c) were already deployed: `useUnread()` is mounted **twice** on a
   landing page (header + `UnreadBanner`) and each instance opened its own Realtime channel on the **same
   topic** `'notifications-unread'` — two subscriptions, one topic, one of them silently receives nothing.
   Symptom: a banner reading "1 unread notification" beside a bell with no badge and no dot. Which instance
   wins is a **race**, so it did not reproduce locally on the first run. `hooks/use-unread.ts` now holds ONE
   module-level store + ONE reference-counted channel, read via `useSyncExternalStore` — unique topics were
   rejected because two independent fetchers only *usually* agree, and two disagreeing numbers on one screen
   is the very thing she reported. **The rules: a type that fires on a SCHEDULE must never feed a nav dot; a
   dot must sit on the page its notifications navigate to (`notificationHref` is the declaration — the dot
   must agree with it); a count rendered outside the component that mutates it needs explicit invalidation,
   never Realtime; and shared state means ONE store, not one copy per caller.** `pnpm check` catches none of
   the four. Deliberately NOT done: marking the surface read on page visit — both portals LAND on the dotted
   page, so that would destroy the unread count at login and silently break the banner she just praised (see
   §F-1). Also flagged-not-fixed there: the notifications PAGE still labels its tab `Unread (20)` from its
   loaded page while the bell says 53.
   ⚠️ **E-8 shipped a warning the platform cannot enforce**: the anti-contact notice now says further
   attempts "may result in suspension of your account", and **there is no account-suspension mechanism**.
   Told to the client, and now the SECOND item awaiting a quote next to B-30 — scope is in §E-8 of the
   control doc, including the part only she can decide (what happens to a suspended user's live deals and
   offers, which changes counterparties' screens, not just theirs).
   ⚠️ **E-11 added `profiles.auto_offers_enabled` (migration 64) — a lender-level MASTER switch that is
   NOT the same bit as `auto_offers.is_active`.** Master off = nothing sends at all; master on = the
   per-row rules decide. They stay separate because collapsing them loses which auto-offers the lender had
   deliberately paused. **Default TRUE is load-bearing** — a false default would have silently stopped
   every pre-existing auto-offer on deploy day, which is why `smoke-auto-offer` asserts the default.

6. **2026-08-05** (2 items) → [`docs/client-revisions-2026-08-05.md`](./docs/client-revisions-2026-08-05.md)
   — **DONE and LIVE on staging + prod. NO migration.** Read it before touching any portal header or the
   invoice PDF.
   ⚠️ **G-1: the lender's whole top navigation was invisible below 1280px, and it was NOT the F-1 change
   she suspected.** `lender-header.tsx` carried `hidden xl:flex` on its `<nav>` with **no fallback behind
   it** — the seven links stayed in the DOM and simply could not be reached. An exhaustive grep found the
   same hole in every portal: broker `hidden md:flex` (768px), and admin with **no** `hidden` and no
   `overflow-x-auto`, so it squashed instead of hiding. **The rule: a responsive breakpoint may only ever
   MOVE navigation, never remove it.** Fixed with a shared **`components/nav-menu.tsx`** (left `Sheet`)
   mounted in all three headers; each passes the exact complement of its own `<nav>` breakpoint as
   `triggerClassName` (`xl:hidden` vs `hidden xl:flex`) so no width falls through the gap. The bell is
   deliberately NOT duplicated inside the sheet — it owns a fixed-topic Realtime channel and a second
   instance would collide, which is F-1 bug (d) all over again. `NavUnreadDot` gained an `inline` variant
   instead of a second dot being written (no `ring-card` there — the sheet is `bg-background`).
   ⚠️ **G-2 needed NO migration**: `invoice-pdf` does no role check of its own — it fetches with the
   CALLER's JWT and lets RLS decide, and `invoices_admin` is `for all using (is_admin())`, so the lender's
   `downloadInvoicePdf` helper already worked for an admin. The real trap was that `/admin/invoices`
   wrapped its **entire `RowActions` in `status === 'pending'`**, so paid/cancelled rows had no actions at
   all and a naive "add View" would have stayed invisible on them.
   ⚠️ **G-3 (found, not reported): the invoice PDF printed `new Date()` as its issue date.** The function
   re-renders and upserts the stored file on EVERY view, so the same invoice showed a different issue date
   each time, and G-2 would have let an admin silently rewrite what the lender had downloaded. Now
   `invoices.created_at` (added to the fn's `select`). **Verifying it needs a BACKDATED row** — a
   same-day invoice makes the bug and the fix print identical output.

⚠️ **Two traps recorded in that doc, worth knowing before you open it:**
- **`docs/Revisions_23_Jul_2026.pdf` is NOT a reliable source.** It is a Gmail print whose long lines are
  **clipped at the right page margin — the text is genuinely gone**, including the entity name in a
  contract clause. Read the Gmail thread (`subject:Revisions`) instead. (Also: no `pdftotext` on this
  machine, and `file://` is blocked in the driven browser — serve a PDF over `http://localhost` to read it
  in Chrome.)
- **The prequal fine print exists in two conflicting versions** (2026-07-25 vs 2026-07-27) and the earlier
  one asks for a **pop-up** where we shipped an inline banner. Unresolved — do not treat that item as done.

Batch B also settles two things the original extraction left open: **OQ#30 — "Open" term deducts 3 bps,
not 5** (so `platform_bps_for` must change), and it **reopens OQ#18** by implying Maturing Deals has no
upper age bound.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**, package manager **pnpm**.
- **Tailwind CSS v4** + **shadcn/ui** (new-york style, Radix primitives, `lucide-react` icons,
  `sonner` toasts, `recharts` charts). Aliases: `@/components`, `@/lib`, `@/hooks`.
- **react-hook-form + zod** for forms/validation.
- **Supabase** (wired): Postgres + Auth + RLS + RPCs + pg_cron. `@supabase/supabase-js` +
  `@supabase/ssr` are installed and clients live in `lib/supabase/` (browser `client.ts`, RSC
  `server.ts`, session-refresh `middleware.ts` used by root `proxy.ts`). Never expose the
  service-role key to the client. Storage/Realtime/Edge Functions not used yet.
- Current state: migration from the V0 mock is **well underway** — see "Local development & current
  status" below for what's wired vs still mock. Remaining pages still use inline `MOCK_*` data;
  migrating one = replace its mock with a `lib/queries/*` call.

## Architecture

```
app/                    # Broker routes at root: /sign-in /sign-up /create-deal /deal-room
                        #   /deal-detail/[id] /settings /faq /contact
app/lender/*            # Lender routes: new-deals, maturing-deals,
                        #   submitted-offers, invoices, settings, faq, contact
                        #   (expired-deals page removed — client request, see Wired list)
app/admin/*             # lender-approvals, alerts (built); analytics/legal/deal-overview to build
components/             # broker-header, lender-header, admin-header + components/ui (shadcn)
lib/supabase/           # client.ts (browser) · server.ts (RSC) · middleware.ts (session refresh)
lib/queries/            # deals, offers, saved-filters, admin — typed data access
lib/enums.ts            # enum ↔ display-label maps (UI binds the enum VALUE, not the label)
lib/database.types.ts   # generated: pnpm db:types (supabase gen types --local)
proxy.ts                # Next 16 middleware convention (refreshes the Supabase session cookie)
supabase/migrations/    # SQL migrations (the schema source of truth)
supabase/functions/     # Edge functions: anti-contact scan (Claude API), invoice PDF — NOT built yet
docs/extracted/         # Bubble extraction (read before changing business logic)
```

- Business logic lives in **Postgres** (RPCs + RLS + pg_cron) and **edge functions** — not in React.
  Multi-step transitions (submit deal, accept/switch offer, invoice generation) are `security definer`
  RPCs so they stay atomic and can't be forged from the client.
- Frontend talks to Supabase directly for reads (RLS-scoped) and calls RPCs for writes.
- Realtime subscriptions replace Bubble's implicit refresh for notifications/new offers.

## Local development & current status

Setup, commands, and test accounts: see **[`README.md`](./README.md)**. Quick reference:
`pnpm db:start` → `pnpm db:reset` → `pnpm seed`, then **`pnpm build && pnpm start`** to run.

**Environment gotchas (bit us, will bite you):**
- **`pnpm dev` works** (verified 2026-07-07: pnpm 11.10.0 / Next 16.2.4 / node 24 on Windows — Turbopack
  starts in ~1s and serves routes 200 with the real app). The earlier "Turbopack panics: Next.js package
  not found" note is stale (it was a corrupt/partial-install state, not an inherent pnpm+Turbopack
  incompatibility). Use `pnpm dev` for iterative work with HMR — it serves on **:3010** (`next dev -p 3010`,
  to keep :3000 free); `pnpm build && pnpm start` still defaults to :3000. ⚠️ If that panic ever *recurs* (a known
  Turbopack + pnpm-symlink issue, not a reason to switch to npm), the fix is an `.npmrc` with
  `node-linker=hoist` (flat, npm-like `node_modules`) + `pnpm install` — keeps pnpm. `pnpm build && pnpm
  start` remains the way to verify a *production* build.
- **Restart `pnpm start` after every rebuild you want to browser-verify.** A running `next start`
  keeps serving the build it booted with; if you `pnpm build` again underneath it, the freshly
  served HTML references new chunk hashes the old process can't serve → the browser shows Chrome's
  "This page couldn't load" (looks exactly like an extension/navigation glitch, but it's a stale
  server). Kill the listener on the port and re-launch `pnpm start` after building. (Confirm the
  page really updated by checking SSR HTML — a stale build renders new i18n keys as their dotted
  `namespace.key` fallback path.)
- **RLS grants**: tables get RLS policies but the API roles also need table GRANTs, or every query is
  "permission denied" despite correct policies. Migration `…06_grants.sql` grants `authenticated`
  (DML) / `anon` (select) / `service_role` (all) + default privileges. New tables inherit this.
- **PostgREST embeds** between two tables that share >1 FK are ambiguous (PGRST201) — use the FK hint:
  `offers!offers_deal_id_fkey(...)`, `lender_institutions!profiles_lender_institution_id_fkey(...)`.
  (Also concatenating a `.select()` string breaks type inference — pass one string literal.)
- **RLS recursion (42P17)**: a policy that subqueries another RLS-guarded table can recurse. Wrap the
  check in a `security definer` helper (see `i_offered_on`, `lender_can_see_deal`, `my_role`, etc.).
- Regenerate types after any schema change: **`pnpm db:types`**. Enum values (e.g. `5_year_fixed`)
  are the DB truth; the UI binds the enum value and shows a label from `lib/enums.ts` (the V0 mock's
  dropdown labels were invented — don't trust them).
- **After `pnpm db:reset`**, the Auth/Realtime/Storage containers restart but the Kong gateway does
  not, so it can hold stale routes → seed/API calls fail with an empty `{}` error even though every
  container reports "healthy". Fix: `docker restart supabase_kong_<project>` (or `db:stop`+`db:start`),
  then re-run `pnpm seed`. Don't chain `db:reset` and `seed` in one shot — let the containers settle.
- **Unqualified columns in RLS subqueries**: if a policy's `EXISTS` subquery joins a table that shares
  a column name with the outer table (e.g. `offers.deal_id` vs `deal_identities.deal_id`), an
  unqualified reference binds to the INNER table and silently drops the row correlation. Always qualify
  (`deal_identities.deal_id`). This caused an anonymity leak — see migration 15.

**Migrations (all applied locally; additive — never edit an applied one):**
`01_schema` · `02_functions` (RPCs: submit_deal, accept_offer, switch_offer, confirm_lender, invoice
RPCs, match_percentage/best_match_for) · `03_rls` · `04_jobs` (pg_cron) · `05_auth` (handle_new_user
trigger) · `06_grants` · `07_offer_rpcs` (make_offer + accepted_lender_for_deal reveal) ·
`08_deal_visibility` (lender sees deals they offered on) · `09_maturing_deals` (maturing feed RPC) ·
`10_fix_match_fails` (array_append bug fix) · `11_active_filters_match` (best_match_for gated to
`is_active`) · `12_anti_contact` (regex `scan_contact_info` + `scan_and_log` RPC + block-before-persist
triggers on offers/messages/deals notes) · `13_notifications` (`approve_lender`/`reject_lender` RPCs
that notify the lender + adds `notifications` to the `supabase_realtime` publication) ·
`14_expired_deals` (`expired_deals_for_lender` RPC — read-only archive feed, scored by the match
engine — ⚠️ the lender-facing Expired Deals PAGE was later removed [client request]; this RPC + `listExpiredDeals`
are now dormant, though the `expire_old_deals`/`archive_expired_deals` crons still expire/archive server-side)
· `15_fix_identities_leak` (**security fix**: the `identities_accepted_lender` policy's
unqualified `deal_id` bound to `offers.deal_id`, dropping the row correlation so any lender with one
accepted offer could read every deal's borrower identity — now qualified to `deal_identities.deal_id`) ·
`16_open_deals_filter` (`open_deals_for_lender(p_filter_id)` — open feed optionally narrowed to a saved
filter's criteria via the canonical `saved_filter_matches`, so New Deals uses the DB filters directly) ·
`17_messages` (`send_deal_message` [anti-contact-validated insert], `mark_chat_read`, `my_chat_threads`
inbox feed, + `messages` added to the realtime publication) · `18_signup_lookups` (anon SELECT policies
on `brokerages`/`lender_institutions` so the public sign-up form can populate its org dropdowns before
the visitor authenticates — active rows only, names only, same rationale as the anon read on published
`legal_documents`) · `19_admin_analytics` (`admin_analytics()` — one SECURITY DEFINER, `is_admin()`-gated
aggregate returning a jsonb blob of platform metrics [deal/offer/invoice/survey counts + by-status /
by-province / by-month] so the dashboard doesn't pull every row) · `20_invoice_storage` (creates the
private `invoices` Storage bucket the `invoice-pdf` edge function writes generated PDFs to) ·
`21_submit_survey` (broker submits the closing survey atomically — Q0 gates the timing questions + 1–5
satisfaction; broker-only, once) · `22_open_deals_filtered` (`open_deals_filtered(...)` — ad-hoc
server-side filtering of the New Deals feed by real enum arrays [province/product/purpose/dwelling] +
loan/LTV/closing ranges + COF-only, sharing `lender_can_see_deal` + the `open_deals_for_lender` shape) ·
`23_penalty_effect` (**OQ#25 rating-penalty effect**: folds into `lender_can_see_deal(d)` so a
`penalty_active` lender is hidden from — and cannot bid on / open a chat about — deals within the
near-closing / near-COF windows, EXCEPT deals they already offered on [`i_offered_on` exemption]; the
windows default to 45d/14d and are now **admin-configurable** — see migration 26) · `24_admin_lender_ratings`
(`admin_lender_ratings()` — is_admin()-gated per-lender penalty flag + last-5-survey avg satisfaction for
the admin Penalties page) · `25_notify_email_trigger` (**email channel wiring**: `pg_net` extension +
`tg_notify_email()` AFTER INSERT trigger on `notifications` that POSTs each row to the `notify-email` edge
function; fail-safe — no-ops unless the `app.notify_email_url` / `app.service_role_key` DB settings are
configured, so it never blocks/slows an insert, and the dispatch is wrapped to only WARN on failure) ·
`26_penalty_thresholds_config` (**OQ#25 thresholds now admin-configurable**: single-row `penalty_settings`
table [`near_closing_days`/`near_cof_days`, default 45/14] that `lender_can_see_deal` reads instead of
hardcoded literals; `set_penalty_thresholds()` is_admin()-gated setter; edited from `/admin/penalties`) ·
`27_delete_draft_deal` (scoped `deals_broker_delete_draft` DELETE policy [owner + `status='draft'`] so a
broker/admin can delete their own DRAFT from the Deal Room Actions dropdown; child identity/junction rows
cascade — deleting SUBMITTED deals stays a Round 3 item) · `28_admin_as_broker` (**admin acts as broker**:
hidden `is_active=false` "Platform Administration" brokerage assigned to admins [existing rows + future via
`handle_new_user`], and `deals_broker_insert` relaxed to allow `my_role() in ('broker','admin')` — everything
after creation already keyed off deal ownership, not role) · `29_open_deals_full_fields` (**New Deals card
view = full deal record, Bubble parity**: expands `open_deals_for_lender` / `open_deals_filtered` to return
every non-identity `deals` field [property/deal/qualifying] + the income-type/residency-status junction
arrays [now 38 OUT cols], instead of the old compact table shape; anonymity holds — no `deal_identities`
columns, and `lender_can_see_deal` visibility/filtering are unchanged) · `30_saved_filter_full_criteria`
(**full New Deals filter side-panel**: completes `saved_filter_matches` to also enforce every dormant
`saved_filters` column [range/location/doors, the income/residency EXCLUSION arrays, the 20 `exclude_*`
program/product checkboxes] — null-safe/pass-through when unset, so existing saved filters + the
maturing/expired match-% engine [which calls `match_percentage`, not this fn] are unaffected — and rebuilds
`open_deals_filtered` around the SAME single-value criteria shape as `saved_filters` [building an ephemeral
filter row and delegating to `saved_filter_matches`], so the ad-hoc panel and a saved-filter chip apply
identical logic) · `31_maturing_deals_full_fields` (**Maturing Deals = same full-detail cards + Filters
sidepanel as New Deals**: expands `maturing_deals_for_lender` to the full non-identity field set [same shape
as `open_deals_for_lender`, migration 29] instead of the old compact summary columns, and adds
`maturing_deals_filtered` mirroring `open_deals_filtered` [migration 30], scoped to the SAME maturing age
window and still scoring every row against the lender's saved filters via `best_match_for` for the match-%
badge) · `32_maturing_deals_saved_filter` (**saved-filter chip narrowing on Maturing**: adds optional
`p_filter_id` to `maturing_deals_for_lender` — when given, keeps only deals satisfying that saved filter via
the canonical `saved_filter_matches`, same mechanism/age-window as New Deals' `open_deals_for_lender`, still
scored against ALL saved filters for the badge) · `33_notify_email_vault` (**email-trigger config via
Vault, hosted-compatible**: `tg_notify_email()` now reads `notify_email_url`/`notify_service_role_key`
with a **GUC → Supabase Vault fallback** — GUCs still win locally [`notify:setup-local`], hosted reads
`vault.decrypted_secrets` because the migration-25 `alter database/role set app.*` fails on hosted with
`42501 permission denied`; see the Hosted deployment section) · `34_hide_offered_deals_from_feeds`
(**a lender no longer sees a deal in New Deals / Maturing once they've offered on it** — adds
`and not i_offered_on(d.id)` to the four feed RPCs [`open_deals_for_lender`/`open_deals_filtered`/
`maturing_deals_for_lender`/`maturing_deals_filtered`] ONLY; `lender_can_see_deal` is unchanged, so
make_offer's guard, the deals RLS [`deals_lender_offered` still exposes it for Submitted Offers], the
junction visibility, and chat are unaffected; other lenders who haven't offered still see it) ·
`decline_deal_rpc` (dated `20260709000033` — the `NN` suffix 33 is out of sequence with 34, but the
later date orders it last: SECURITY DEFINER `decline_deal(p_deal_id)` that upserts `deal_declines` AND
drops the lender's `deal_chats` thread [`deal_chats` has no DELETE policy], the single RPC every Decline
entry point routes through [New Deals/Maturing feeds + messages inbox]; came in the auth-messaging merge —
**applied to the hosted DB 2026-07-10**) · `36_round3_create_deal_fields` (**Round 3 Phase 1**: adds the new
`deals` columns [`married_or_common_law`/`spouse_not_on_application`/`reverse_mortgage`/`assets_liquid_value`/
`assets_total_value`/`door_titles_count`/`transunion_being_used`/`no_lender_exceptions_required`] +
`offers.lender_fee_pct`; converts **Credit Issues + Down Payment Source from single-select columns to
multi-select junction tables** `deal_credit_issues`/`deal_down_payment_sources` [RLS-guarded like the existing
income/residency junctions], **backfills** existing singular values [+ `borrowed_down_payment` → source
`'borrowed'`] into them, then **drops** `credit_issue`/`down_payment_source`/`borrowed_down_payment`) ·
`37_round3_feeds_multi_select_and_windows` (rebuilds the four feed RPCs [`open_deals_for_lender`/
`open_deals_filtered`/`maturing_deals_for_lender`/`maturing_deals_filtered`] to `array_agg` the new
`credit_issues`/`down_payment_sources` columns instead of the dropped singular ones — `saved_filter_matches`/
`match_percentage`/`best_match_for` never referenced those two, so unchanged — and moves the Maturing
New→Maturing boundary to **2 days** [was 4; OQ#18 → New 0–1 / Maturing 2–14 / Expired 15+]) ·
`38_round3_lender_fee_pct` (wires `lender_fee_pct` through `make_offer`: drops the 8-arg signature, recreates
the 9-arg with the optional trailing `p_lender_fee_pct`; display-only, never affects the invoice math) ·
`39_round3_broker_admin_submitter` (`profiles_brokerage_admin_read` RLS policy — `i_am_broker_admin() and
brokerage_id = my_brokerage()` — so a broker-admin's Deal Room can embed a brokerage-mate's name for the new
"Submitted By" column) · `40_round3_edit_delete_submitted` (**Round 3 Phase 2, Broker Deal Room**: a broker
can UPDATE their own SUBMITTED deal until it has an offer [`deals_broker_update_submitted_no_offers` +
widened `identities_broker_update`, via the `deal_has_offers()` SECURITY DEFINER helper — an inline `offers`
subquery would 42P17-recurse], and DELETE drafts AND submissions until an offer is accepted
[`deals_broker_delete_unaccepted` replaces migration 27's draft-only policy; children cascade, which is the
"auto-remove from the lender portal" behaviour]) · `41_round3_edit_offer` (`edit_offer(p_offer_id, …)` —
lender edits their own still-PENDING offer in place [same field set as make_offer incl. `lender_fee_pct`];
frozen once accepted/declined/switched; anti-contact BEFORE UPDATE trigger still scans; broker notified
without identity leak) · `42_round3_one_step_accept` (**one-step accept, supersedes OQ#21**: `accept_offer`
drops `p_one_step` and atomically accepts + auto-declines the rest + reveals [deal → `confirmed`,
`lender_confirmed`] + creates the invoice + notifies the lender ONCE; **`confirm_lender` is DROPPED**;
`switch_offer` now also **DELETEs the acceptance invoice** [a PAID invoice blocks the switch], resets
`lender_confirmed`, and no longer notifies the switched lender — the lender portal shows 'switched' as
"Declined" via the UI mapping in `lib/queries/offers.ts`) · `43_round3_filter_new_fields` (**replicates the
Round 3 Create Deal fields as saved-filter criteria**: `saved_filters` gains `credit_issues`/
`down_payment_sources` exclusion arrays, 4 `exclude_*` flags [reverse mortgage / married-or-common-law /
spouse-not-on-application / TransUnion], `assets_liquid_min`/`assets_total_min`/`max_door_titles` bounds +
`require_no_exceptions`; `saved_filter_matches` enforces them null-safely [filter-only — the weighted match
engine is untouched] and `open_deals_filtered`/`maturing_deals_filtered` gain the matching trailing params,
the 4 flags riding the existing `p_others_excluded` key list) · `44_idempotent_lender_approval` (**client
feedback 2026-07-20 #11**: approving a lender sent TWO "approved" emails. The DB path is single by
construction — one `notify()` → one row → one AFTER INSERT trigger → one email — so the duplicate came from
`approve_lender` being INVOKED twice. `approve_lender`/`reject_lender` are now **idempotent**: they only
transition + notify on a real status change, so re-approving an already-approved lender is a no-op with no
second email; a non-existent id still errors. Signatures unchanged) · `45_round3_phase3_documents`
(**Round 3 Phase 3**: `deal_documents` [consent PDF + photo ID per deal] + RLS [owner/admin/brokerage-admin
read — **never lenders**] + the private `deal-documents` bucket & object policies; `submit_deal` gains a
two-document gate; `purge_expired_documents` cron → `purge-documents` edge fn deletes the bytes 120 days
after `closing_date` — **superseded by migration 52**, which moved the rule into `documents_to_purge()` to
cover a prequal's missing closing date) · `46_round3_phase3_name_match` (`deal_documents.extracted_name`/`name_matches`/
`name_variance`/`checked_at` + `invoices.document_name`; `accept_offer` stamps a variance name onto the
invoice [photo ID preferred]; the `match-document-name` edge fn reads the name with Claude vision —
advisory, fail-open, never blocks submit) · `47_round3_phase3_auto_offers` (**auto-offer engine**:
`auto_offers` [a lender's saved standard offer riding on one of their saved filters] + RLS [owner write,
admin read]; `send_auto_offers(deal)` is called from `submit_deal` and posts the offer only when
`saved_filter_matches` is true AND `deal_allows_auto_offer` [all 4 notes empty +
`no_lender_exceptions_required`] — never on a blocked brokerage [either direction], never for an unapproved
lender, never a 2nd offer from the same lender on one deal, and the OQ#25 penalty windows still apply;
`offers.is_auto`/`auto_offer_id` mark the provenance, the `auto_offer_sent` notification type + daily
`auto_offer_digest` cron deliver the confirmation email through the existing notifications→Resend channel.
⚠️ An auto-offer carries NO comments on purpose — comments hit the anti-contact trigger and the insert runs
inside the BROKER's submit transaction) · `48_round3_phase3_prequal_live` (**Prequal → Live Deal**:
`deals.prequal_converted_at` + `convert_prequal_to_live(deal, address, closing, cof)` [owner-gated,
one-shot; offers carry over untouched and the bidding lenders get a `prequal_converted` notification that
never names the address]; **no marketplace re-entry** is folded into `lender_can_see_deal` — a converted
deal stays visible only to lenders that already bid, which covers the feeds + the make_offer guard + chat
at once; `submit_deal` now refuses a deal with **no property address unless it is a prequal** [OQ#41 /
client feedback #7] and `accept_offer` refuses an **unconverted prequal** [the invoice needs a closing
date]) · `49_round3_phase3_feeds_prequal` (the four lender feed RPCs gain a trailing `prequal` OUT column
so the New Deals card can badge it and the offer dialog can show the prequal fine print) ·
`50_round3_phase3_lender_logos` (**login-page lender logos**: `lender_logos` + a PUBLIC `lender-logos`
bucket; ACTIVE rows are **anon-readable** because the sign-in page is unauthenticated, writes are
`is_admin()`-only on both the table and the objects; managed at `/admin/logos`) ·
`51_dwelling_types_client_revision` (**client revision 2026-07-22**: adds the `duplex_detached` /
`duplex_semi_detached` / `apartment_low_rise` / `apartment_high_rise` dwelling types. `condo_apartment`,
`farm` and `recreational` are **retired, NOT dropped** — Postgres can't remove an enum value in place and
a historical deal could still carry one, so they keep their labels in `lib/enums.ts` and are filtered out
of every picker by `RETIRED_DWELLING_TYPES`; same "retire, never delete" rule as brokerages/institutions) ·
`53_lender_visible_deal_fields` (**28 `deals` columns that never reached the four feed RPCs** — occupancy,
the property characteristics, the program/product flags, assets, door titles, TransUnion and three Round 3
borrower flags. Migration 29 built the "full deal record" shape and missed them, and everything added later
missed it too. Occupancy was the sharpest: a saved-filter AND scored match criterion the lender could not
read. ⚠️ `broker_id`/`brokerage_id` are deliberately excluded — `brokerages` is anon-readable, so a lender
holding `brokerage_id` could de-anonymize the deal) · `54_null_safe_max_filters` (**every MAX criterion is
now null-tolerant**: `NULL <= 5` is NULL, not TRUE, so a max filter silently discarded every deal whose
field the broker left empty. All 9 maximums fixed; MIN criteria deliberately untouched) ·
`55_open_term_three_bps` (**settles OQ#30**: an OPEN term deducts 3 bps, not 5 — it has no `product_years`
so it fell through to `else 5`. ⚠️ changes invoice amounts; the client-side preview mirror in
`platformBpsFor` must stay in step) · `56_dwelling_type_exclusions` (dwelling type becomes an EXCLUSION
array like income/residency; the old single-value column is kept so pre-existing saved filters keep working) ·
`52_prequal_lender_window_and_doc_retention` (**client answers 2026-07-27** — the two questions Phase 3
left open, see `docs/client-revisions-2026-07-27.md`: (a) **a prequal expires for LENDERS only** — it never
reaches status `expired` (that is broker-visible, and archiving would bury it), so the 15-day cutoff is a
VISIBILITY clause in `lender_can_see_deal` computed from `created_at` [closes on time even if the cron never
runs; covers the feeds + the make_offer guard + chat in one place, like migration 48's re-entry clause], with
an `i_offered_on` exemption so a lender holding an offer keeps access. `job_expire_old_deals` skips prequals
and instead sends ONE notice; `deals.prequal_lender_notice_at` is that idempotency marker ONLY — never the
source of truth for visibility. (b) **document retention** moved into `documents_to_purge()`: 120 days after
`closing_date`, **or 120 days after upload when there is no closing date** [a prequal has none, so the old
`closing_date < cutoff` predicate never matched it and its PDFs would have been kept forever], with a hard
240-day-after-upload ceiling. ⚠️ **`revoke execute … from public`** is load-bearing there — see Security
invariants #6).
· `57_survey_comments` (**client 2026-07-28 B-3**: `surveys.comments` + a trailing `p_comments` on
`submit_survey` [the old 7-arg overload is dropped so the call stays unambiguous]. Broker → platform admin
only, so it is deliberately NOT anti-contact scanned — that guard exists to stop broker and lender
identifying each other and there is no counterparty here, same reasoning as `not_closed_reason`) ·
`58_auto_offer_min_closing_days` (**B-33**: `auto_offers.min_closing_days`, default 30, per lender; gates
`send_auto_offers`. ⚠️ A deal with **no** closing date — a prequal — is deliberately NOT constrained: it
cannot be "too soon", and dropping nulls is the exact bug migration 54 had to undo. Lives on `auto_offers`
rather than `saved_filters` because it is a property of the standing offer, not of how the lender browses) ·
`59_penalty_on_turn_times` (**B-4**: the rating penalty now keys off the two turn-time survey answers —
4+ "no" on EITHER within the lender's last **10** rated surveys — replacing `avg(satisfaction) < 3 over 5`.
The EFFECT is untouched [`lender_can_see_deal` + the admin-configurable 45d/14d windows]. ⚠️ The two counts
are INDEPENDENT: 3+3 does not penalize. The window counts only surveys that HAVE turn-time answers, since a
not-closed survey nulls them) · `60_invoice_archive_retention` (**A-25**: `invoices.archived_at`; paid →
archived at 1 year → deleted at 7 [`invoices_to_purge()` + the new `purge-invoices` edge fn, because the
PDF bytes live in Storage]. Archiving is a FLAG, not a move — `/admin/invoices` filters Current/Archived/Both.
⚠️ The 1-year archive point is OUR reading of an ambiguous sentence; both thresholds are single literals.
`invoices_to_purge()` is `revoke … from public` — invariant #6) · `61_legal_reagreement` (**A-3**:
append-only `legal_acceptances` keyed to the document ROW [version strings are admin-typed and can collide]
+ `pending_legal_documents()`/`accept_published_legal_documents()`; NO update/delete policy for anyone.
`handle_new_user` also logs the sign-up acceptance so a new user is never asked to re-accept what they just
ticked, and the migration backfills existing users timestamped from `profiles.created_at`, not `now()`) ·
`62_lock_down_cron_jobs` (**security fix**: every `job_*` function was PUBLIC-executable — see Security
invariants #6 for the full note, the audit-query trap and why `job_cache_invalidate` is exempt) ·
`63_optional_transaction_type` (**client 2026-07-30, E-5**: Transaction Type becomes optional on Create
Deal, and an untyped deal must reach lenders of all three types. The COLUMN was already nullable — this
fixes the two read-side predicates that assumed it never was. `saved_filter_matches` gains
`or d.transaction_type is null` (a NULL compared with `=` yields NULL, which an AND chain treats as FALSE
— the migration-54 bug class), and `match_percentage` now requires the DEAL's value too, so the criterion
**drops out of the denominator** instead of scoring 0 of its 18 points. ⚠️ That second one is the trap:
without it the deal is visible but permanently ~82%, badged with a red "Transaction Type" miss, and last
on every Maturing feed. Deliberately scoped to transaction_type — the other criteria's deal-side fields
are still required on the form) ·
`64_auto_offers_master_switch` (**client 2026-07-30, E-11**: `profiles.auto_offers_enabled` **default
true**, gating `send_auto_offers` — the lender-level master the New Deals strip toggles. Distinct from
the per-row `auto_offers.is_active`, deliberately: master off = nothing sends; master on = the per-row
rules decide. Collapsing them would lose which offers the lender had paused. ⚠️ The TRUE default is not
cosmetic — false would have stopped every pre-existing auto-offer silently. No RLS change needed: the
`profiles_privilege_guard` trigger is a DENY-list and this column is not on it).
**Hosted status: migrations 36–64 are applied to BOTH staging AND prod**
(36–39 on 2026-07-14; 40–43 on 2026-07-17; 44 on 2026-07-21; 45–51 on 2026-07-22; 52–56 on 2026-07-27;
57–62 on 2026-07-29; **63–64 on 2026-07-31** — 64/64 on each, advisors 0 ERROR, browser- and
smoke-QA'd on staging). **F-1 (`515dd68`, 2026-08-03) and the 08-05 batch (`37671e2`) added NO migration —
64/64 still stands and nothing was applied to either DB.** ⚠️ The 08-05 deploy DID **redeploy `invoice-pdf`
on both** (G-3 changed its issue date) — that function never ships with the Vercel build, so a code change
inside `supabase/functions/` needs its own `supabase functions deploy` per environment. The 63–64 deploy
**redeployed `invoice-pdf`** on both
(E-9 changed its header; that function does not ship with the Vercel build). The 57–62 deploy
shipped the new `purge-invoices` edge fn + the redeployed `anti-contact` (its AI threshold changed), and
created the `purge_invoices_url` Vault secret on both. ⚠️ **Prod has NO published `legal_documents`** (2 rows,
neither published), so `/legal/terms` and `/legal/privacy` render "Not available yet" — which the restored
footer now links to from every page. Two consequences: publish them from `/admin/legal`, and know that the
first publish makes the A-3 re-agreement prompt appear for every existing user (by design). Doing it while
prod holds one account is free; after real signups it is a broadcast.
The 52–56 deploy shipped the reworked `purge-documents`
edge fn alongside them, because the function now calls `documents_to_purge()` and would fail against an
unmigrated DB. The earlier 45–51 deploy shipped `match-document-name` + `purge-documents` (new)
and redeployed `notify-email` + `invoice-pdf`; **both** environments now have the `APP_URL` secret (the
auto-offer digest's edit link) and the `purge_documents_url` Vault secret (the retention cron reads
GUC → Vault like the email trigger, so it no-ops until that exists).

**Wired to Supabase (real data + verified):** sign-in (role redirect) · **password reset** (**OTP-code flow**:
`/forgot-password` is 2-step — email → `resetPasswordForEmail`, then a **6-digit code** + new password →
`verifyOtp(type:'recovery')` + `updateUser`. A **code, not a link** — email prefetch scanners (Outlook Safe
Links / Gmail) GET single-use links on delivery → the user's click fails `otp_expired`. The link-based
`/reset-password` page stays as a fallback [reads `token_hash`/`code`/hash → session → `updateUser`]; sign-in's
"Forgot password?" is wired; the recovery email sends `{{ .Token }}` via `supabase/templates/recovery.html`) ·
sign-up (broker → active →
`/deal-room`; lender → `pending_approval` → pending screen + admin queue; org dropdowns from the DB via
`lib/queries/lookups.ts`; access code dropped pending OQ#22; **when email confirmations are ON** [hosted]
sign-up shows an in-app **OTP code screen** [`verifyOtp`, length-agnostic 6–8-digit input — hosted OTP is 8]
for **BOTH roles** — the handler branches on `hasSession` first, then role, so a broker lands on
`/deal-room` and a lender on the approval-wait screen only AFTER confirming. ⚠️ Don't "shortcut" the lender
straight to approval-wait: that was client bug 2026-07-20 #12 — their email stayed unconfirmed and they could
never sign in (no code field on sign-in). Delivered via Resend as Auth SMTP) · **lender approval gate** (server layout
`app/lender/layout.tsx` redirects an unapproved lender to the `/pending-approval` holding page —
pending or rejected+reason; sign-in routes them there directly; approved lenders unaffected) ·
create-deal (submit) ·
deal-room (broker's deals) · lender/new-deals · deal-detail (**Round 3 ONE-step accept** — Accept =
auto-decline the rest + identity reveal + invoice + lender notification in one RPC, no Confirm Lender
button, Switch stays available until the invoice is paid; **+ a "Full Deal Details" card** — the broker
sees the whole record via the shared
`LenderDealDetailSections` [`getBrokerDealFull`] PLUS the borrower name + property address that are
deliberately hidden from lenders) · make-offer dialog (**every field required except comments**, with
the Create-Deal-style inline validation — red `*` + red border + "field required" on empty fields;
**Round 3 prefill**: single-target offers seed the product from the deal + the rest from the lender's
remembered last response [localStorage, comments always cleared]) ·
lender/submitted-offers · lender/invoices (mark-paid/cancel/changes) ·
lender/maturing-deals (server match %) · lender/settings saved-filters CRUD · admin/lender-approvals
· admin/alerts · **admin console** (deal-overview = every deal via `deals_admin`, filters + search;
analytics = KPIs + recharts bar/line from `admin_analytics()`; legal = `legal_documents` CRUD +
publish [one live per type] + delete-unpublished; FAQ editor = `faqs` CRUD with Broker/Lender tabs;
survey report = printable list of completed closing surveys + avg-satisfaction KPI via `listSurveyReport`;
penalties = per-lender penalty flag + last-5-survey avg satisfaction via `admin_lender_ratings()`, lift/apply
by toggling `penalty_active`, **+ edit the near-closing/near-COF windows** (`set_penalty_thresholds` RPC →
`penalty_settings`); Deal Overview + Survey Report also **export CSV** of the filtered rows via the
shared `lib/csv.ts`; **platform invoices** = every invoice via `listAllInvoices` [admin reads all via
`invoices_admin`] with KPIs + status filter + CSV at `/admin/invoices`; **legal editor** is now a **Tiptap
WYSIWYG** storing sanitized HTML [DOMPurify at the write boundary, rendered via shared
`components/legal-content.tsx`]; the admin tables use a shared **row-action dropdown**
[`components/row-actions.tsx`] instead of stacked buttons; the admin nav is centered. **Manage group**
(client feedback 2026-07-20): **`/admin/brokers`** = every broker + their brokerage, search/filter, and a
Make/Remove *brokerage admin* action [`setBrokerAdmin` — a plain UPDATE on `profiles.is_broker_admin`; the
Bubble first-broker auto-grant of OQ#23 is deliberately NOT restored]; **`/admin/organizations`** = add /
rename / deactivate **brokerages + lender institutions** in one tabbed screen [generic `OrgTable` helpers;
deactivate, never delete — FKs + the migration-18 anon `is_active` filter]) · **admin acts as
broker** (migration 28: creates/manages deals under the hidden Platform Administration brokerage; the shared
Deal Room / Create Deal / Deal Detail pages render `components/portal-header.tsx` to keep admins in admin
chrome; all-deals oversight stays in Deal Overview) · **public legal pages** (`/legal/privacy`,
`/legal/terms` render the published doc via `getPublishedLegalDoc` — anon-readable through
`legal_read_published` — wired from the sign-up ToS checkbox + the footer, replacing the old dead `#` links) ·
**delete deal** (Round 3: broker/admin removes a draft OR an unaccepted submission from the Deal Room
Actions dropdown via `deleteDeal` [replaces `deleteDraft`], backed by `deals_broker_delete_unaccepted` —
deleting a submitted deal auto-removes it from the lender portal [offers/chats cascade]; distinct
AlertDialog copy per case) · **rating-penalty effect** (OQ#25: a penalized lender is hidden from — and cannot bid
on / chat about — near-closing / near-COF deals via `lender_can_see_deal`; admin manages at
`/admin/penalties`; windows default 45d/14d, admin-configurable via `penalty_settings`) ·
**FAQ pages** (`/faq`, `/lender/faq` real accordion grouped by category via shared `components/faq-view.tsx`,
RLS-scoped by audience — a broker sees broker FAQs, a lender lender FAQs) · **invoice PDF** (`invoice-pdf` edge function renders
the platform-fee PDF with pdf-lib, RLS-checks the caller owns the invoice, uploads to the private
`invoices` bucket, stamps `pdf_path`, returns a host-relative signed path the client prepends its public
URL to; "Download PDF" wired on lender/invoices — needs functions served, see below. **Round 3 rebrand:** the
header draws the LenderMatch™ node logo — the 96×96 PNG inlined as base64 [`LOGO_PNG_B64`, decoded via
`atob`→`embedPng`, kept self-contained] — next to the `BRAND` text) · **closing survey**
(the `trigger_closing_surveys` cron creates a survey + notification when a confirmed deal reaches its
closing date; the broker completes it from a prompt on deal-detail — and from a banner on the deal-room
(`listPendingSurveys`) — via `components/survey-dialog.tsx` → `submit_survey` RPC. Q0 "did it close with
[lender]?" gates the 3 timing questions + 1–5 satisfaction that feeds the rating penalty; completed
surveys show in the admin survey report) · **anti-contact (regex + AI)** (blocks contact info in offer
comments + deal notes at the data layer via triggers, and `scan_and_log` records the `admin_alerts`
row the Alerts page shows; the client `scanContact` routes through the `anti-contact` edge function so
the Claude 2nd layer catches obfuscations regex misses, with automatic fallback to the regex RPC)
· **notifications** (redesigned in-app `NotificationBell` [`notification-icon.tsx` per-type icons] in all
three headers, live via Realtime, **+ a full notifications page per role** [`/notifications` ·
`/lender/notifications` · `/admin/notifications`, shared `components/notifications-view.tsx` → paginated
`listNotifications` feed, Realtime-live on the `notifications-page` channel, mark-read]; settings
notification toggles wired to the `notify_*` profile columns notify() honours via `notification-preferences.tsx`; admin approve/reject
fire `lender_approved`/`lender_rejected`; broker/lender header Logout now works; **email channel** via the
migration-25 `notifications` trigger → `pg_net` → `notify-email` edge function [Resend], service-role-guarded
so only the trigger can invoke it, honours `notify_email_enabled`, verified end-to-end locally — needs a
verified Resend domain + `pnpm notify:setup-local`/hosted GUCs for real delivery)
· **New Deals full filter side-panel** (Bubble parity — `components/deal-filters-sidepanel.tsx` exposes
every production filter field [single-value enums + loan/LTV/value/doors ranges + location + income/residency
EXCLUSION arrays + the `exclude_*` program checkboxes], applied server-side via `open_deals_filtered`; the
saved-filter chips are the lender's real DB `saved_filters` via `open_deals_for_lender`; both delegate to the
canonical `saved_filter_matches` [migration 30] so a chip and the ad-hoc panel apply identical logic, and the
cards now render the full deal record [migration 29]; chip and panel are mutually exclusive; creation/editing
of saved filters lives in Settings) ·
**Maturing Deals (New-Deals parity)** (the compact table is now the same full property/deal/qualifying
**detail cards** as New Deals via shared `components/lender-deal-sections.tsx` [migration 31], with the same
ad-hoc **Filters sidepanel** [`maturing_deals_filtered`], real **saved-filter chips** [`maturing_deals_for_lender(p_filter_id)`,
migration 32 — mutually exclusive with the panel], and **bulk selection** [per-card checkboxes + a bulk action
bar: Make Offer / Decline / Message N deals]. Make Offer uses the shared `MakeOfferDialog` → `make_offer`;
Decline persists to `deal_declines` via `declineDeal`. New Deals Make Offer/Decline are real too) ·
**messaging** (global inbox `/messages` + `/lender/messages` via shared `components/messages-inbox.tsx`:
thread list with deal context + unread, conversation + reply, Realtime-live, anti-contact pre-scan on
send. Counterparty is anonymized — lender sees "Broker", broker sees "Lender 1/2/…" per deal — never a
name. **Optimistic send** — the sent bubble renders instantly and the box clears, reconciling with the
server and rolling back [restoring the draft + showing the reason] if anti-contact blocks it or the send
fails; spinner on the send button. The inbox **deep-links**: `/lender/messages?chat=<id>` auto-opens that
conversation once threads load. The lender "Send Message"/"Message" buttons on New Deals/Maturing create
the thread via `send_deal_message`, and once a deal already has a thread the button **routes to that
conversation** in the inbox instead of re-opening the compose dialog) ·
**account settings (all 3 roles)** (shared `components/account-settings.tsx` = own name/phone [`profiles`]
+ email change [**OTP code**: `updateUser({email})` → 6-digit code → `verifyOtp(type:'email_change')`; needs
"Secure email change" OFF + the `supabase/templates/email-change.html` template] + password change [re-auth then update], rendered on broker
`/settings`, `/lender/settings`, `/admin/settings`) · **bilateral blocking** (shared
`components/block-manager.tsx` + `lib/queries/blocks.ts`: broker settings blocks lender institutions
[`broker_blocked_institutions`], lender settings blocks brokerages [`lender_blocked_brokerages`] — real orgs
from the DB, confirm-dialog + list/unblock; these blocks actually change deal visibility via
`lender_can_see_deal`; verified block→unblock end-to-end) · **Round 3 Phase 1** (all 18 items — see
`docs/round3-progress.md` for the granular list; highlights: Create Deal's new fields/checkboxes incl.
multi-select Credit Issues/Down Payment Source/Residency Status [`deal_credit_issues`/
`deal_down_payment_sources` junction tables, migration 36] + info popups; the bps auto-deduct/"Final
Commission Amount" preview + optional Lender Fee % in the Make Offer dialog; broker-admin brokerage-wide
Deal Room visibility with a "Submitted By" column; the real **Contact-Us** wiring via a new `contact-us`
edge function [Resend, mirrors `notify-email`]; the Maturing window is now 2–14 days) · **Round 3 Phase 2**
(all 6 buildable items — the rebrand + `lendermatch.ca` domain-connect stay BLOCKED on client input, see
`docs/round3-progress.md`; highlights: edit a submitted deal until it has an offer [Deal Room "Edit" →
`/create-deal?edit=<id>`, the wizard's edit mode saves via `updateSubmittedDeal` without touching status];
delete drafts AND submissions until an offer is accepted [`deleteDeal`]; **one-step accept** [Confirm Lender
removed, migration 42; lender portal shows a switched offer as "Declined"; switch deletes the invoice
silently]; **Edit Offer** on Submitted Offers for pending offers [shared `MakeOfferDialog` in edit mode →
`edit_offer`, broker notified]; offer-entry **prefill + remember-last** [deal product + localStorage
`ll_last_offer`, comments always cleared]; the Round 3 Create Deal fields replicated in the **Filters
sidepanel** [credit-issue/down-payment exclusions, 4 new "Others" flags, liquid/total asset minimums, max
door titles, "no exceptions only"] — a chip and the panel still share `saved_filter_matches`) · **Round 3
Phase 3, items 1–3** (live on staging + prod since 2026-07-22 — see `docs/round3-progress.md`): **deal documents** (consent PDF +
photo ID uploaded on the Create Deal Property step via `lib/queries/deal-documents.ts` → private
`deal-documents` bucket; Submit gated on both, 120-day retention purge); **AI name-match** (the
`match-document-name` edge fn reads the document name with Claude vision and badges the doc
verified/variance/mismatch; on variance both names print on the invoice PDF + a "Name variance" badge on
lender/invoices); **auto-offer engine** (lender Settings → Auto-Offers section
[`components/auto-offer-manager.tsx` + `lib/queries/auto-offers.ts`]: a standard offer bound to a saved
filter, optional end date, active toggle, edit/delete, with the same bps-deduction/"Final Commission Amount"
preview as Make Offer; `send_auto_offers` fires it inside `submit_deal`, Submitted Offers badges the result
"Auto", and the daily digest notification/email links back there to edit); **Prequal → Live Deal** (a deal
with no address submits only as a prequal; lenders see a PREQUAL badge on the New Deals card — and NOTHING
else, the prequal disclaimer is a BROKER-side notice on deal-detail (client 2026-07-27, migration 52); the
broker's Deal Room "Move to Live Deal" action collects
address + closing + COF via `convertPrequalToLive` → offers carry over and the deal never re-enters another
lender's feed); **login-page lender logos** (`components/logo-marquee.tsx` scrolls the admin-maintained
strip on `/sign-in` — CSS-only marquee, pauses on hover, still under `prefers-reduced-motion`, renders
nothing when the list is empty — managed at **`/admin/logos`**: upload/rename/show-hide/reorder/delete).

**Still mock / not built:** nothing currently tracked here — the last prototype (Contact-Us form submit)
was wired in Round 3 Phase 1 (see below). (The **notification email channel** is now wired — see the
Wired list — pending only a verified Resend sending domain + hosted deploy config for real delivery.)

· **client 2026-07-28 batch** (migrations 57–62): **`/admin/documents`** (read-only admin viewer for the
consent PDF + photo ID — borrower name, AI name-check badge, search, type filter, CSV, signed-URL View;
needed no migration, `deal_documents` RLS already granted admin and denied lenders) · **legal re-agreement
gate** (`components/legal-reagreement-gate.tsx` + `lib/queries/legal-acceptance.ts` — a NON-dismissable
overlay mounted once in the root layout, inert unless the signed-in user is behind on a published legal
document; Escape/outside-click suppressed on purpose, docs open in a new tab, "Sign out instead" so nobody
is trapped, auth routes skipped so it never covers an OTP screen) · **restored `SiteFooter`** ·
**invoice archive filter** on `/admin/invoices` (Current / Archived / Both, defaulting to Current) ·
**survey comments** (broker textarea → the existing admin Survey Report + its CSV).

**Removed (client request):** the lender **Expired Deals** page + its nav link + `listExpiredDeals` (lenders
can't act on expired deals, so the archive view was dropped — deals still expire/archive server-side via cron);
and the shared **site footer** — ⚠️ **the footer is BACK** (client 2026-07-28, A-2): `SiteFooter` was
rebuilt and is now mounted **once in `app/layout.tsx`**, not pasted per page as the deleted version was.
`COPYRIGHT_HOLDER` changed from the founders' names to the company, and there is no "Regulatory
Disclosures" link (it pointed at `#`). Don't re-delete it.

**Edge-function secrets (local):** custom secrets (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM`,
optional `APP_URL` — set it hosted so the daily auto-offer digest email can link to Submitted Offers)
live in **`supabase/.env`** (gitignored — REAL keys, never commit) and are loaded by serving with an
env-file: **`pnpm functions:serve`** (= `supabase functions serve --env-file supabase/.env`). The
built-in `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — only the
custom ones need the file. In hosted deploys these go through `supabase secrets set …` instead.

**Edge functions locally:** `supabase start` should serve `supabase/functions/`, but a function ADDED
after the runtime last started isn't picked up (it returns "Function not found"), and `supabase start`
does NOT load the env-file — so use **`pnpm functions:serve`** (serves all, hot-reloads `per_worker`,
loads `supabase/.env`). The `invoice-pdf` function must be served for the lender/invoices "Download PDF"
button to work locally. `anti-contact` runs its AI 2nd layer only when served with `ANTHROPIC_API_KEY`
present (else it falls open to the regex result); `notify-email` is invoked by the `notifications`
trigger (migration 25), which stays a **fail-safe toggle: OFF by default** (no-ops until the DB settings
exist). Leave it off locally — that guarantees `pnpm smoke` + dev never hit Resend (even for the fake
`@loanlink.test` users the smokes create). Verify real delivery instead with **`TEST_EMAIL=you@…
pnpm smoke:email`** (standalone `smoke-notify-email.mjs`, which calls the function directly with the
service-role key, so it needs NO GUCs/trigger; safe with no `TEST_EMAIL`, one real send with it; no Resend
inbound needed — any inbox you can read works). To make the *app itself* auto-email in local, flip it on
transiently with **`pnpm notify:setup-local`** (seeded fixtures are also created `notify_email_enabled =
false` as defense-in-depth). In hosted deploys, `supabase functions deploy <name>` with default JWT verification
(our functions still re-check access via RLS on the caller's token).

## Hosted deployment (Supabase cloud + Vercel)

**Client-owned infra — migration in progress (2026-07-10).** The project is being handed off to the client's
own GitHub + Supabase + Vercel. **Full step-by-step in [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md)** —
read it before touching hosted infra. Current state:

- **Repo**: GitHub `elizabethbonnie80-byte/lender-match` (`origin`; single squashed history). Renamed
  from `…/test` on 2026-07-27 — GitHub redirects the old URL, so a stale `origin` still pushes (with a
  "This repository moved" warning), and **Vercel followed the rename by itself** because the
  integration binds to the numeric repo ID, not the name.
- **Supabase** (org `vercel_icfg_NibyY0GS3ZwLKfHfaDirmYCb`, Free): **prod** `lender-match` `bcedtccidfehdbthmhss`
  + **staging** `lender-match-staging` `kejjhlfelidajdijojmp`, both `ca-central-1`. Two separate Free projects
  (branching is Pro-only).
- **Vercel** project `lender-match` (`prj_WymejSMhXllTicV0MdurY06IGrDO`, team `team_RO4YBSdHhzKziaEJuJ9CpP9w`),
  framework `nextjs`.
- **Branch/env model**: `staging` = **base dev branch** → Vercel Preview → **staging** Supabase; `main` = prod →
  Production → **prod** Supabase (merge `staging`→`main` ONLY to deploy prod). `NEXT_PUBLIC_*` are build-time.
- **Status**: **both live on ALL of Round 3 (Phases 1–3) + both client-revision batches, as of 2026-07-22.**
  **prod** at **`www.lendermatch.ca`**, **staging** at **`staging.lendermatch.ca`** (seeded; demo accounts
  `Test1234!`), main/staging/dev all in sync — **51/51 migrations on each, advisors 0 ERROR**. Prod holds
  only `admin@lendermatch.ca` and no deals: the client's own test accounts were deleted on 2026-07-22 at
  their request (see `docs/client-revisions-2026-07-20.md` §D — one of them was a stranded lender signup
  from before the #12 fix, invisible to any `profiles`-joined query because it had no profile row).
  The Auth email templates live in each Supabase dashboard (Auth → Email Templates), **not in git** — so a
  rebrand has to be applied there by hand. The "Confirm signup" template was updated to LenderMatch™ on both
  envs (2026-07-22); keep that step in mind for any future brand/copy change. Old dev
  deployment (Supabase `zyxfsewiejvtnhftnasu` + `loan-link-rho.vercel.app` + GitLab) is pre-migration and retired.

The gotchas below still apply (and are folded into the runbook):
- **Vercel framework preset** is pinned in **`vercel.json`** (`{"framework":"nextjs"}`). Without it the
  import came up `framework: null` → every route `x-vercel-error: NOT_FOUND` **despite a green `next
  build`** (Vercel wasn't applying the Next.js runtime). Env: `NEXT_PUBLIC_SUPABASE_URL` + the public
  anon key; the service-role key never goes in Vercel env or any committed file.
- **Migrations**: the client projects were provisioned with **`npx supabase db push`** (all 35 applied clean,
  recorded with the repo file-versions). ⚠️ On the OLD dev project migrations went through the Supabase MCP
  `apply_migration`, which records its OWN version timestamps, so a CLI `db push` there won't see the repo
  versions as applied (reconcile with `migration repair`) — a non-issue for the fresh client projects.
- **Edge functions** deployed; custom secrets set in Dashboard → Edge Functions. ⚠️ **New-API-key gotcha:**
  the runtime injects the **new `sb_secret_…`** key as `SUPABASE_SERVICE_ROLE_KEY` (NOT the legacy JWT).
  The legacy JWT still works for seeding / Data API / Auth admin, but anything compared against the
  function's injected key (notify-email's bearer guard, the email trigger) must use the `sb_secret_…`.
- **Email auto-trigger** works via **migration 33** (GUC → Vault fallback — the migration-25 `app.*` GUCs
  can't be set hosted, `42501 permission denied`). Hosted config lives in Supabase Vault
  (`notify_email_url` + `notify_service_role_key`=the sb_secret); verified e2e (notification → trigger →
  pg_net → function → Resend → `200 {"sent":true}`).
- **Re-seeding the cloud DB**: `seed:demo` is LOCAL-ONLY (`db reset` + Kong). For hosted, run the
  individual `seed-*` scripts with the cloud env in `scripts/.env.cloud` (gitignored — holds the
  service-role/secret keys, never commit). Full command in the README.
- An inert `keycheck` edge fn (returns 410, from a diagnostic) is deployed — safe to delete in the dashboard.

## Data model (summary)

See `supabase/migrations/` (authoritative) and `docs/extracted/data-model.md` (Bubble as-is).
Tables: `profiles` (extends `auth.users`), `brokerages`, `lender_institutions`, `deals`,
`deal_identities` (borrower name + address, split out so RLS enforces anonymity),
`deal_income_types`, `deal_residency_statuses`, `offers`, `invoices`, `deal_chats`, `messages`,
`notifications`, `saved_filters`, `surveys`, `admin_alerts`, `faqs`, `legal_documents`,
`access_codes`, `deal_number_counters`.

Do NOT migrate Bubble's duplicate/legacy artifacts (deleted types, boolean-vs-list double
representations, `mottage product` typo field, `Total Mortgage Amount` vs `Loan Amount1` — the
canonical loan amount is Bubble's `Loan Amount1`). Bubble option-set `db_value`s are display-shifted
on several sets — any data migration must map **by display label** using the tables in
`data-model.md` §2.

## Security invariants (non-negotiable, enforced by RLS)

1. **Anonymity until acceptance** — `deal_identities` readable only by the deal's broker, brokerage
   admin, platform admin, and the lender whose offer is accepted (deal status accepted/confirmed/funded).
   Offers expose lender identity to the broker only when that offer is accepted.
2. **Deal visibility** — lenders see open deals only (submitted/offer_received), never drafts; minus
   deals they declined; minus bilateral blocks (broker blocked the lender's institution, or lender
   blocked the brokerage). The **New Deals + Maturing feeds also exclude deals the lender has already
   offered on** (migration 34 — those live in Submitted Offers); the deal row itself stays reachable
   (`deals_lender_offered`), and other lenders who haven't offered still see it.
3. **Invoices** — visible only to the related lender + admin.
4. **Role separation** — broker pages/queries vs lender vs admin; admin-only tables (`admin_alerts`,
   approval queue) are RLS admin-only. Bubble leaked all User fields (incl. verification codes) and
   all Deal fields to lenders — do not reproduce (open-questions #1–5).
5. Verification codes, Claude API key, service keys: server-side only.
6. **A `security definer` function that must not be callable with a user token has to be revoked from
   `public`** — not just from `anon`/`authenticated`. Postgres grants EXECUTE to **PUBLIC** on every new
   function, so those roles inherit access and a `revoke … from anon, authenticated` is a no-op. This bit
   `documents_to_purge()` (migration 52): it spans every brokerage's document storage paths and was
   callable by any signed-in broker or lender until `revoke execute … from public` was added. The migration
   applies cleanly either way, so **prove the lockdown with a smoke assertion** (`smoke-prequal` asserts
   both roles get `permission denied`) and check `pg_proc.proacl` — a leading `=X/postgres` entry IS the
   PUBLIC grant. Most admin-only RPCs here instead gate *inside* the body with `is_admin()`, which is
   immune to this; prefer that when the caller is a user rather than the cron/service role.
   ⚠️ **It bit the whole `job_*` family too** (migration 62, 2026-07-29): every pg_cron function is
   `security definer` with no internal guard, and 8 of 9 were callable by any signed-in user — able to
   expire deals, send digest notifications or dispatch the destructive purges early. Pre-existing since
   migration 04. **A new `job_*` function must be revoked from `public` in the migration that creates it**,
   and added to the loop in `smoke-invoice-archive` that fails if any is callable by a lender.
   Two things worth knowing when you check this:
   - `proacl::text like '%=X/postgres%'` is a **false positive** — it also matches `service_role=X/postgres`
     as a substring. The PUBLIC grant is the array element that *starts* with `=`, so unnest and test
     `acl::text like '=%'`.
   - `job_cache_invalidate` legitimately keeps the PUBLIC grant: it returns `trigger`, and a trigger
     function cannot be invoked as an RPC. Exclude `prorettype = 'trigger'::regtype` when auditing.
   Also recorded: `job_reset_monthly_switches` was already safe, and NOT because of its grant — the
   `profiles_privilege_guard` trigger refuses changes to `offer_switches_this_month` unless `is_admin()`.
   Defence-in-depth held; it was the only thing holding.
   ⚠️ **OPEN, not yet fixed — the same family outside `job_*`.** Found while checking the advisors during
   the 63–64 deploy (2026-07-31), pre-existing and NOT introduced by it, so it was deliberately left out
   of that deploy rather than mixed in:
   - **`best_match_for(p_lender, p_deal_id)`** — `security definer`, PUBLIC-executable, and it takes the
     lender id as a **parameter** instead of reading `auth.uid()`. Any signed-in user can pass someone
     else's id and read that lender's match percentages and filter names. This is the one worth fixing.
   - **`send_auto_offers(p_deal_id)`** — `security definer`, PUBLIC-executable. Callable directly rather
     than only from `submit_deal`. Internally gated (deal must be submitted/offer_received,
     `deal_allows_auto_offer`, plus each lender's own rules), so the realistic worst case is firing
     auto-offers early on a deal that would have received them at submit anyway.
   `saved_filter_matches` and `match_percentage` are also PUBLIC but are **not** `security definer`, so
   they run as the caller with RLS applied — those are fine. The advisors count 48 `anon` / 50
   `authenticated` in this family on both envs; most are internally `is_admin()`-gated, so the count alone
   is not the signal — check `prosecdef` **and** whether the body trusts a caller-supplied identity.

## Core business rules (exact — regression-test against `docs/extracted/test-vectors.md`)

- **Deal number**: assigned on submit (not draft) = `DEAL-{year}-{n}`, atomic per-year counter.
  Bubble used unpadded count+1 (live: `DEAL-2026-4`); padding decision pending (open-questions #32).
- **Platform bps by term** (product `years` attr): `≤3y → 3 bps (0.0003)`, `4y → 4 bps (0.0004)`,
  `else → 5 bps (0.0005)` ("Open" has no years → 5 bps, pending #30).
- **Invoice**: `amount = loan_amount × bps_decimal`; `due_date = closing_date + 21 days`;
  number `INV-{ddMMyyyy}-{n}`. Bubble filled invoice `client_name` with the LENDER's name (bug #7) —
  the rebuild uses the borrower's name.
- **Match % (maturing deals)**: weights Transaction Type 18 · Province 14 · Product 14 · LTV 12 ·
  Credit Score Min 10 · Amortization 8 · Position 6 · Purpose 6 · Dwelling 4 · Occupancy 4 ·
  Property Value 4. **Only criteria defined in the filter count toward the total**;
  `pct = round(matched/total×100)`; a deal is scored by its **best** (max) match across the lender's
  saved filters; colors: ≥90 yellow, 80–89 orange, 70–79 red, <70 none; "Does not match: …" badge
  lists failing criteria when 70≤pct<100. Checkbox criteria filter the list but do NOT score.
  (Bubble bugs #10/#11 — credit-score fail missing from the badge, purpose compared against
  transaction type — fix per spec, noted in the SQL implementation.)
  ⚠️ **A criterion the DEAL leaves empty must drop out of the denominator, not score zero** (migration 63,
  E-5). Only transaction type can be empty today, but the shape recurs: gating the criterion on the
  filter's value alone charges the full weight as a miss, which both caps the score and emits a red miss
  chip. Deal-side null → skip the criterion entirely.
- **List age windows** (from `created_at`, day-rounded): **New 0–1d / Maturing 2–14d / Expired 15+**
  (Round 3 Phase 1, supersedes OQ#18). The values live in `lib/age-windows.ts` + the maturing SQL
  window (migration 37) — do not scatter.
- **Switches**: max 2 per calendar month per broker; switch returns auto-declined offers to pending
  and the switched offer to `switched`; counter resets monthly. **Round 3 (migration 42):** the switch
  also **DELETEs the invoice created on acceptance** (a PAID invoice blocks the switch), and the
  switched lender is **not notified** — their portal simply shows the offer as "Declined" (UI mapping;
  the broker-side data keeps `switched`).
- **Acceptance flow**: **ONE step** (Round 3 Phase 2, supersedes OQ#21 — implemented in migration 42):
  `accept_offer` atomically accepts + auto-declines the other pending offers + reveals identities
  (deal → `confirmed`, `lender_confirmed`) + generates the platform-fee invoice + notifies the lender
  once. `confirm_lender` no longer exists; Switch remains available after acceptance.
- **Expiration**: submitted deals with no offer expire after 15 days (notify broker); archived 30
  days after expiring. **A PREQUAL is the exception (client 2026-07-27, migration 52): it expires for
  LENDERS only.** It never reaches status `expired` — it just stops being visible to lenders at 15 days
  (a clause in `lender_can_see_deal`, computed from `created_at`, with an `i_offered_on` exemption so a
  lender holding an offer keeps access) and stays active in the broker's Deal Room until they delete it.
  The broker gets exactly one notice (`prequal_lender_notice_at` is the idempotency marker, NOT the
  visibility source). Consequence to know: a stale prequal can still be converted, but migration 48's
  "no marketplace re-entry" means it will not reappear in any feed.
- **Document retention** (client 2026-07-27, migration 52): the rule lives in `documents_to_purge()`,
  NOT in the edge function — 120 days after `closing_date`, **or 120 days after upload when there is no
  closing date** (a prequal has none; the old `closing_date < cutoff` predicate silently kept its PDFs
  forever), with a hard **240-day-after-upload ceiling** because `closing_date` is broker-entered and can
  be arbitrarily far out.
- **Anti-contact**: regex (email / phone / URL / sender's own first+last name) + Claude API second
  layer (only when regex clean and text > 20 chars) on: offer comments, messages/chat, the 4 deal
  notes. Target behavior: **block before persisting** everywhere + create `admin_alerts` row
  (Bubble only blocked offers/messages and let deal notes through — #24/#43). **Implemented (regex
  layer):** migration `12_anti_contact` — `scan_contact_info(text, first, last)` classifier +
  `scan_and_log` RPC (the client pre-check that records the alert in its own transaction so it
  survives the blocked write) + `BEFORE INSERT/UPDATE` triggers on `offers`/`messages`/`deals` that
  RAISE on a hit (the un-bypassable data-layer backstop). Client wiring: `lib/queries/anti-contact.ts`
  (`scanContact`/`blockContact`), called from create-deal (income + general notes), make-offer,
  messages, and the lender feeds. **Claude 2nd layer WIRED:** `scanContact` now calls the
  `anti-contact` edge function (regex via `scan_and_log` + Claude when regex-clean and > 20 chars),
  and **falls back to the `scan_and_log` RPC** if the function is unavailable — so the AI layer engages
  automatically when served/deployed with `ANTHROPIC_API_KEY` and nothing regresses without it. The
  function extracts the model's JSON even when it wraps it in a code fence (fixed) and fails open to the
  regex result on any Claude error. Serve locally with `pnpm functions:serve` (key in `supabase/.env`).
- **Notifications**: clean enum (`new_offer`, `offer_accepted`, `offer_switched`, `message_received`,
  `deal_expiring`, `deal_expired`, `filter_match`, `survey_pending`) gated by per-user toggles + email
  channel toggle. Filter-match fires ONCE per new deal per matching saved filter (Bubble re-fired on
  every page load — #44). Two channels: **in-app** (row written by `notify()`, live via Realtime) and
  **email** (migration-25 AFTER INSERT trigger → `pg_net` → `notify-email` edge fn → Resend, honouring
  `notify_email_enabled`; the per-type toggle is already applied when `notify()` decides to insert).
- **Survey**: when a confirmed deal's closing date arrives → survey + notification; Q0 "did it close
  with [lender]?" gates the 4 questions (commitment/doc-review/funded on time + satisfaction 1–5).
- **Penalty** (spec, never built in Bubble — #25): lender avg satisfaction < 3 over last 5 surveys →
  hide deals with closing < 45d or COF < 14d; admin can lift. **Implemented** (migrations 23/24/26): the
  weekly `job_apply_rating_penalties` recompute already set `penalty_active`; the EFFECT is folded into
  `lender_can_see_deal(d)` (hides + blocks bids/chats on near-closing/near-COF deals the lender hasn't
  already offered on), and the admin lifts/applies via `/admin/penalties` (`admin_lender_ratings()`).
  The **near-closing/near-COF windows default to 45d/14d but are now admin-configurable** (migration 26:
  `penalty_settings` single-row table read by `lender_can_see_deal`, edited via the `set_penalty_thresholds`
  RPC on the Penalties page) — the spec never fixed exact numbers, so the client can tune them without a
  code change. Expired deals are intentionally unaffected.

## Scheduled jobs (pg_cron — real cron replaces Bubble's page-load re-arming)

| Job | Schedule | Action |
|---|---|---|
| `expire_old_deals` | daily 02:00 | submitted, no accepted offer, 15+ days → expired + notify broker. **Prequals are skipped** (they leave the lender queues via `lender_can_see_deal` instead) but get a one-shot notice |
| `archive_expired_deals` | daily 02:10 | expired 30+ days → archived |
| `trigger_closing_surveys` | daily 08:00 | confirmed deals with closing_date ≤ today and no survey → survey + notification |
| `reset_monthly_switches` | monthly 1st 00:01 | reset `offer_switches_this_month` |
| `apply_rating_penalties` | weekly Mon 03:00 | recompute `penalty_active` per lender — **4+ "no" on EITHER turn-time question across the last 10 rated surveys** (client 2026-07-28, migration 59; was avg satisfaction < 3 over 5) |
| `purge_expired_documents` | daily 02:30 | documents past retention per `documents_to_purge()` (closing+120, or upload+120 with no closing date, ceiling upload+240) → `purge-documents` edge fn deletes bytes + rows |
| `auto_offer_digest` | daily 07:00 | one `auto_offer_sent` notification per lender summarising the last 24 h of auto-offers (→ confirmation email w/ edit link) |
| `archive_paid_invoices` | monthly 1st 03:00 | paid 1+ year ago → `invoices.archived_at` (client 2026-07-28, A-25). Monthly, not daily: the threshold moves in years |
| `purge_archived_invoices` | monthly 1st 03:30 | archived + paid 7+ years ago → `purge-invoices` edge fn deletes the row **and** the Storage PDF. Needs the `purge_invoices_url` Vault secret, else it no-ops |

⚠️ Every `job_*` function is revoked from `public` (migration 62) — see Security invariants #6 before adding one.

## Conventions

- **Git**: **never `git commit` or `git push` without the user's explicit request/permission** — even
  after finishing a change and verifying it, stop and wait for the go-ahead; do not commit or push
  proactively (applies equally to applying migrations to the hosted/cloud DB — that's a prod push).
  Commit messages must **not** include a `Co-Authored-By` / AI-attribution trailer (client preference,
  2026-07-07). Keep messages plain (subject + body); no tool/assistant co-author lines.
- **Branches** (client-owned infra): **`staging` is the base development branch** — day-to-day work + PRs
  target it, and every push to `staging` (or any non-`main` branch) auto-deploys to Vercel **Preview** →
  **staging** Supabase. **`main` is production-only**: merge `staging`→`main` ONLY when deploying to prod (a
  push to `main` → Vercel **Production** → **prod** Supabase). Full flow in [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md).
- **Language**: all repo code, comments, docs in English. (Conversation with the team may be Spanish.)
- **DB**: snake_case; enums for closed sets; junction tables for deal-side lists; every table has
  `created_at`/`updated_at`; RLS enabled on every table, policies in the RLS migration.
- **Migrations**: additive SQL files in `supabase/migrations/` (`YYYYMMDDNNNNNN_name.sql`); never edit
  an applied migration; `supabase db reset` locally to replay.
- **Local gate**: run **`pnpm check`** before wrapping up — it chains `typecheck` + **`lint`** (real ESLint
  now: flat config `eslint.config.mjs`; the React-Compiler rule family is intentionally `warn`, not error)
  + **`check:i18n`** (asserts EN/FR parity + that every static `t()` key resolves) + **`test`** (Vitest unit
  tests in `tests/unit/`). `next build` no longer swallows type errors (`ignoreBuildErrors` removed), so a
  type error fails the build. There is **no CI** (the team doesn't use GitLab CI) — `pnpm check` is the gate.
  If Turbopack dev panics, `pnpm dev:webpack` is the fallback (see README).
- **Testing parity**: every migrated flow must reproduce the expected outputs in
  `docs/extracted/test-vectors.md` (or intentionally improve on them with an explicit note).
- **Data-layer smokes**: `scripts/smoke-*.mjs` exercise the RPCs + RLS with real user sessions (each
  self-cleans). Run the whole suite with **`pnpm smoke`** (reseeds first) or **`pnpm smoke:quick`**
  (`--no-seed`, against the current DB); `smoke-all.mjs` prints a pass/fail summary and exits non-zero
  on any failure. Coverage includes the create-deal→new-deals slice, the offer loop + **bps 3/4/5** +
  **one-step accept** + **edit_offer** (`smoke-offers`) + **switch** incl. the **2/month cap + reset** +
  **invoice deletion + no-lender-notify** (`smoke-switch`), the **match-% engine**
  (`smoke-maturing` — weights/formula/badge + Bubble bugs #10/#11), the Round 3 **edit/delete rules**
  (`smoke-delete-draft` — delete until accepted incl. offer cascade, edit-submitted until first offer,
  owner-only, cascade), the Round 3 Phase 3 **auto-offer engine** (`smoke-auto-offer` — the positive send
  plus EVERY negative gate: a filled note, the unchecked no-exceptions box, a filter miss, inactive/past
  end date, blocked brokerage, one-offer-per-lender, the digest job, auto-offer RLS, and the E-11
  **master switch** [the TRUE default, master-off blocking an otherwise-active offer, master-off NOT
  touching the per-row `is_active`, and resuming with nothing re-enabled by hand]), the Phase 3
  **prequal → live deal** flow (`smoke-prequal` — the address-or-prequal submit gate, bidding on a prequal,
  the accept-before-conversion refusal, every conversion guard, offers carrying over + the lender
  notification, and no marketplace re-entry),
  the Round 3 **filter criteria** (`smoke-open-filtered`), the **optional transaction type**
  (`smoke-optional-transaction-type` — an untyped deal reaches a lender filtering on a type, through both
  the saved-filter chip and the ad-hoc panel, AND scores 100% rather than losing the 18-point weight;
  every assertion has a typed control so "matches everything" fails too), **decline** off the feeds
  (`smoke-decline`), **bilateral blocking**
  (`smoke-blocking` — security invariant #2), anti-contact, notifications, messaging, saved-filter feeds,
  sign-up, admin, FAQs, the **login-page logos** (`smoke-logos` — the anon-reads-active-only /
  admin-writes-only asymmetry), surveys, the rating penalty (effect + **survey→job computation**), and password
  reset. Pure helpers (`lib/csv`, `lib/status-styles`, `lib/enums`) have **Vitest** unit tests
  (`pnpm test`). `smoke-invoice-pdf` needs the edge runtime served (`pnpm functions:serve`), so it's
  the one expected red in a bare `pnpm smoke`. When an RPC signature changes, update its smoke — a smoke
  that reads a null/empty result can pass a `.every(...)` assertion vacuously (this bit `open_deals_filtered`
  after migration 30 switched it to single-value params), so assert **non-empty** where a match must exist.
- **UI**: reuse the existing shadcn components; keep the V0 design tokens already in `globals.css`;
  no new UI libraries. **Tailwind v4 gotcha**: v4's Preflight resets `<button>` to `cursor: default`
  (v3 used pointer), so `globals.css` has a `@layer base` rule restoring `cursor: pointer` on buttons +
  the Radix interactive roles (menuitem/option/tab/switch/checkbox/radio) app-wide — don't remove it.
  Shared primitives to reuse: **`PasswordInput`** (`components/ui/password-input.tsx` — show/hide eye;
  used on sign-in/sign-up/reset-password), **`RowActions`** (`components/row-actions.tsx` — the
  "Actions ▾" dropdown that replaces stacked per-row buttons, used across the admin tables + lender/invoices;
  pass `destructive: true` rather than styling the item yourself — it maps to the menu's destructive
  variant, and non-destructive items force their icon to the accent foreground on hover),
  and **`BrandMark`** (`components/brand-mark.tsx` — the LenderMatch™ logo + `BRAND` text; use it in every
  header instead of printing `BRAND` bare).
  ⚠️ **`--accent` is a strong blue**, so any highlighted menu row / hovered select trigger is a solid blue
  bar with white text. Anything that sets its own colour (a red label, a green icon, muted placeholder
  text) has to be re-stated for the hover state or it ends up coloured-on-blue and unreadable — that bit
  `RowActions` and `SelectTrigger` (fixed 2026-07-22). Check hover, not just the resting state.
  ⚠️ **Unread state lives in ONE place, `hooks/use-unread.ts`** (E-7, 2026-07-30) — the bell badge, the nav
  dots and the landing banner all read from it, Realtime-subscribed. **Never re-derive an unread count from
  `listNotifications`**: that call is capped at 20 rows, and deriving from it was exactly the bug E-7 fixed
  (a user with 30 unread was shown fewer). Companion pieces: **`NavUnreadDot`** (`components/nav-unread-dot.tsx`
  — the pip; its parent `<Link>` must be `relative`) and **`UnreadBanner`** (`components/unread-banner.tsx`).
  ⚠️ "ONE place" means **one module-level store + one Realtime channel**, read via `useSyncExternalStore`
  (F-1, 2026-08-02). It was per-hook-instance state until then, and since the hook mounts twice on a landing
  page that meant two channels on the same topic where only one received events — a banner showing a count
  next to a bell showing none. **Don't give the hook per-instance state or a per-instance channel again.**
  ⚠️ **Which notification types feed a nav dot is a real decision, not bookkeeping** (F-1, 2026-08-02):
  a type that fires on a **schedule** (the daily `auto_offer_sent` digest) re-lights the dot every morning
  and makes it permanent, and a dot must sit on the page `notificationHref` sends its types to. Both rules
  live in the `DEAL_SURFACE_TYPES` docstring — read it before adding a type there.
  ⚠️ **After ANY write that changes read state, call `notifyUnreadChanged()`** (also F-1) — Realtime does
  **not** deliver the `is_read` UPDATEs (`REPLICA IDENTITY DEFAULT` + a filtered subscription), so without it
  the badge/dots/banner keep showing the pre-read count until the next navigation. That was the client's
  actual "it should go away once they review" complaint, and it applies to `mark_chat_read` too.
  ⚠️ **A responsive breakpoint may only ever MOVE navigation, never remove it** (G-1, 2026-08-05). Every
  header hid its `<nav>` below a breakpoint with nothing behind it, so the links were in the DOM and
  unreachable. **`NavMenu`** (`components/nav-menu.tsx`) is the fallback; a header must pass the exact
  complement of its own `<nav>` breakpoint as `triggerClassName` (`xl:hidden` against `hidden xl:flex`) so
  no viewport width falls between them. Don't mount a second `NotificationBell` inside it.
  ⚠️ **A `<Button>` wrapped in a `<Link>` nests a `<button>` inside an `<a>` and the inner button eats the
  click** — the nav's icon buttons get away with it, but it silently broke the auto-offer strip's Manage
  button in QA. Use `<Button asChild><Link …></Button>` so the button renders AS the anchor.
  **`useLenderDealFeed`** (`hooks/use-lender-deal-feed.ts`) holds ALL the shared New Deals + Maturing feed
  logic (fetch/filters/saved-filter chips/selection/bulk actions/pagination/decline/message) — the two pages
  keep only their distinct cards ("new this week" badge vs match-% legend/badge); **`filter-fields.tsx`**
  (`EnumField`/`NumberField`/`RangeField`) is the shared saved-filter criterion input used by both the Filters
  sidepanel and lender Settings; **`ContactPage`** (`components/contact-page.tsx`) backs both contact routes.
  Auth forms validate **inline** (red text + `aria-invalid` border, cleared on change), not via toasts.
- **i18n (EN/FR)**: user-facing strings go through the custom, cookie-based i18n layer (`lib/i18n/*` +
  `messages/{en,fr}.json` + `components/i18n-provider.tsx`), NOT hard-coded. In a client component:
  `const t = useT('namespace'); t('key')`; add the string to BOTH catalogs under that namespace. Locale
  lives in the `ll_locale` cookie (no URL prefix); `LocaleSwitcher` sets it. New user-facing copy is added
  translated, not English-only; a missing key renders its dotted path (partial coverage is safe).
  **Status: COMPLETE** — every user-facing page/component is migrated EN↔FR (auth, broker portal +
  create-deal wizard, lender portal, shared dialogs [make-offer, survey], public/contact, all 8 admin
  pages) and `lib/enums.ts` labels are bilingual `[en,fr]` tuples surfaced via the **`useEnums()`** hook
  (`lib/use-enums.ts`) — use it in client components instead of the static EN exports. A repo-wide check
  confirms every `t()` key resolves in both catalogs (no dotted-path fallbacks).
  ⚠️ **Some labels exist in BOTH `lib/enums.ts` and the i18n catalogs, and changing one does not change the
  other.** The property flags are the known case: the lender Filters sidepanel and the deal-detail sections
  read `enums.PROPERTY_FLAGS`, while the Create Deal checkboxes render `t('…')` from `createDeal.*`. Renaming
  "Recreational" → "Recreational Property" in enums alone updated every screen EXCEPT the one the client had
  asked about (2026-07-22). Neither `pnpm check` nor the smokes catch this — the key resolves fine, it just
  says the old thing. **Grep the label text across `lib/` AND `messages/` before assuming one edit is enough,
  and confirm the change on the actual screen.** Deliberately left English
  (small, documented in `docs/backlog.md` §2): SQL/query-generated strings (`best_match_for` criterion
  names, the anti-contact `{reason}` fragment, `inv.term` codes, the saved-filter `criteriaPreview`,
  `alertSourceLabel`) and CSV **export** column headers. FR mortgage-ratio acronyms are the official
  SCHL/CMHC terms — GDS/TDS → ABD/ATD, LTV → RPV (client-confirmed 2026-07-07). ⚠️ **Ops:** restart
  `pnpm start` after any rebuild you want to browser-verify — a running server serves its boot-time build,
  so stale chunks → Chrome "This page couldn't load" and new keys render as their dotted `namespace.key`
  path in SSR (see Environment gotchas).
- **Brand**: the brand name/logo/support-email/domain are centralized in **`lib/brand.ts`** (`BRAND`,
  `COPYRIGHT_HOLDER`, `SUPPORT_EMAIL`, `DOMAIN`) — NOT hard-coded and NOT in the i18n catalogs (a proper noun is
  identical per locale). Reference `BRAND` in components; for translated copy that embeds it, use a
  `{brand}` placeholder + interpolation (see `footer.rights`). The shared `AuthHeader` and `SiteFooter` both
  use it. ⚠️ `COPYRIGHT_HOLDER` is the **company** ("LenderMatch™ Inc.", with the ™) since client A-2 on
  2026-07-28 — distinct from `LEGAL_ENTITY` ("LenderMatch Inc.", no ™), which the contract clause spells
  that way. Both are correct; don't unify them.
  The **Round 3 rebrand (Loan Link → LenderMatch™) is DONE** (Phase 2, 2026-07-17): `BRAND` = "LenderMatch™"
  and `DOMAIN` = "lendermatch.ca". The client supplied the logo, so every header renders the shared
  **`BrandMark`** (`components/brand-mark.tsx` = `public/lendermatch-logo.png` node icon + the `BRAND` text —
  use it instead of printing `BRAND` bare in a header); the favicon package sits in `public/`, wired via
  `app/layout.tsx` `metadata.icons` + `/site.webmanifest`. Non-header spots keep the text wordmark, but the
  invoice PDF ALSO draws the logo (base64-inlined `LOGO_PNG_B64` in the `invoice-pdf` fn). Copies synced by
  hand on a rebrand — the `invoice-pdf` edge fn's `BRAND` **and** its `LOGO_PNG_B64`, plus the
  `confirmation.html` Auth email template (dashboard-configured on hosted) — so keep those in step if the
  brand/logo ever changes again.
- New tables need: migration + RLS policy + TypeScript types + (if user-facing) query helper in `lib/`.

## What NOT to do

- Don't reintroduce removed/legacy artifacts: `In Review` / `Countered` / `Under Review` statuses
  (present in some V0 mock data — purge them), invoice "Overdue", Bubble's deleted fields/types.
- Don't expose lender/broker/borrower identity before acceptance — in ANY channel: queries, RLS,
  notification bodies (Bubble leaked lender name+institution in the new-offer notification, #4),
  emails, PDFs.
- Don't put the Claude API key or PDF generation in the client — edge functions only. (The Bubble
  key sat in the API Connector and should be rotated — #6.)
- Commission is ALWAYS in bps, never dollars. Rates display with 2 decimals.
- Don't trust Bubble option-set `db_value`s when migrating data — map by display label.
- Don't compute record numbers with `count + 1` (Bubble's deal/offer number race) — use the atomic
  counter/sequences from the schema.
- Don't scatter age-window / bps / match-weight constants — they live in one place (DB functions),
  pending client decisions may change them.
