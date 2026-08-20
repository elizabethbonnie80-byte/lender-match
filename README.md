# LenderMatch (Loan Link)

Canadian anonymous mortgage marketplace connecting **brokers** and **lenders**. A broker submits a
deal; approved lenders browse **anonymized** deals and make offers (commission always in **bps**);
the broker accepts and confirms one offer, which reveals identities and generates a platform-fee
invoice. **Core invariant: identities stay hidden until acceptance — enforced at the data layer (RLS),
not just the UI.**

This is a React + Supabase rebuild of a Bubble.io app. See [`CLAUDE.md`](./CLAUDE.md) for the full
domain model and business rules, and [`docs/extracted/`](./docs/extracted/) for the Bubble
extraction (data model, flows, test vectors, 50 open questions).

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind v4** · **shadcn/ui**
- **Supabase** — Postgres + Auth + RLS + RPCs + pg_cron (schema is the source of truth, in
  `supabase/migrations/`)
- Package manager: **pnpm**

## Prerequisites

- **Node 20+** (developed on 24) and **pnpm 11+** (`npm install -g pnpm`)
- **Docker Desktop** running (Supabase local runs in containers)

## 1. Install

```bash
pnpm install
```

The Supabase CLI is a dev dependency, so no global install is needed. If pnpm reports ignored build
scripts, `pnpm-workspace.yaml` already lists `supabase` and `sharp` under `onlyBuiltDependencies` —
run `pnpm install` again and it will build them.

## 2. Start Supabase locally

```bash
pnpm db:start      # supabase start — pulls Docker images the first time (slow)
pnpm db:reset      # replays every migration in supabase/migrations/ from scratch
```

`pnpm db:start` prints the local URLs and keys:

- API: `http://127.0.0.1:54321`
- Studio (DB browser): `http://127.0.0.1:54323`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

> Analytics (Logflare) is disabled in `supabase/config.toml` — it fails health checks on Windows
> unless the Docker daemon is exposed on `tcp://localhost:2375`, and it isn't needed for development.

`pnpm db:stop` stops the containers but **preserves the database volume** (your data survives a stop
→ start). Use `pnpm db:reset` to wipe and replay migrations.

## 3. Environment

⚠️ **`.env.local` is NOT in the repo — create it yourself.** It is gitignored (`.env*.local`), so a
fresh clone has none. Nothing warns you: `lib/supabase/client.ts` / `server.ts` pass `undefined` into
`createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, …)` and the error never names the file.
(Earlier versions of this section claimed the file was committed. It never was.)

Take the values from what `pnpm db:start` printed — or re-print them any time with `pnpm exec supabase
status` — and write them to `.env.local` in the repo root:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

These are the **well-known local Supabase defaults** — public dev keys, not secrets. The CLI prints
both a legacy `ANON_KEY` (a JWT) and a newer `PUBLISHABLE_KEY` (`sb_publishable_…`); either one works
with `@supabase/ssr`. The seed scripts need no env at all — they fall back to the same well-known
local `SERVICE_ROLE_KEY`.

Never put a hosted project's keys here — use Vercel/CI environment variables for those.

## 4. Seed test data

After `pnpm db:reset` (which wipes everything, including auth users), seed the fixtures:

```bash
pnpm seed
```

This creates the test users, an open "maturing" deal, an open Ontario deal + a saved filter, an
expired deal, and a sample admin alert.

**Full demo in one command** — reset + reseed everything (open/maturing/expired deals, offers,
invoices [pending/paid/cancelled/overdue], completed + pending surveys, notifications, approvals,
alerts):

```bash
pnpm seed:demo     # db reset → restart Kong → run every seed in order (destructive; local only)
```

The extra data layers also run standalone against the current DB (each is idempotent — dedicated
`DEAL-2026-30x/40x` deals, so they don't touch the open/maturing/expired demo deals):

```bash
pnpm seed:notifications   # a spread of in-app notifications for the 3 accounts
pnpm seed:chats           # 2 broker↔lender chat threads on the demo deals (messaging inbox)
pnpm seed:offers          # deals with pending/declined/switched offers + a draft (broker states demo)
pnpm seed:invoices        # 3 confirmed deals → Pending / Paid / Cancelled invoices
pnpm seed:surveys         # 3 funded deals → 2 completed surveys + 1 pending (+ overdue invoices)
pnpm seed:penalty         # a penalized lender (lender3@, 5 low-satisfaction surveys) for /admin/penalties
```

> If a seed fails right after `pnpm db:reset` with an empty `{}` error, the Kong gateway is holding
> stale routes to the just-restarted Auth container. Run `docker restart supabase_kong_<project>`
> (or `pnpm db:stop && pnpm db:start`) and seed again. Give the containers a moment to settle — don't
> chain reset and seed in one command. (`pnpm seed:demo` already handles the Kong restart + wait.)

### Test accounts (password: `Test1234!`)

`pnpm seed` creates the first four; **`pnpm seed:demo`** adds `lender2@` (via `seed:offers`) and
`lender3@` (via `seed:penalty`). So a base seed shows **4** accounts and the full demo shows **6** —
that's why a plain `pnpm seed` looks like fewer accounts than the hosted demo.

| Email | Role | Notes | Seeded by |
|---|---|---|---|
| `broker@loanlink.test` | broker | Dominion Lending Centres | `seed` |
| `lender@loanlink.test` | lender | approved · Merix | `seed` |
| `pending.lender@loanlink.test` | lender | awaiting admin approval · RMG | `seed` |
| `admin@loanlink.test` | admin | approvals + alerts | `seed` |
| `lender2@loanlink.test` | lender | approved · RFA — competing offers | `seed:offers` |
| `lender3@loanlink.test` | lender | approved · TD — **penalized** (5 low-satisfaction surveys) | `seed:penalty` |

The seed scripts create auth users via the Admin API. The **[hosted demo](#hosted-deployment)** is
seeded with the SAME scripts + password, so these exact accounts work there too.

## 5. Run the app

```bash
pnpm dev                    # dev server + HMR on http://localhost:3010 (Turbopack)
pnpm dev:webpack            # same, on webpack — fallback if Turbopack panics (see below)
pnpm build && pnpm start    # production server on http://localhost:3000
```

`pnpm dev` (Turbopack) works on Windows + pnpm — use it for iterative work; it serves on **`:3010`**
(`next dev -p 3010`) to leave `:3000` free. Use `build && start` to verify a production build (that one
still defaults to `:3000`). `supabase/config.toml` whitelists **both** ports for auth redirects, so the
email flows (password-reset code, signup confirm) work on either — remember config changes need a
`supabase stop && supabase start` to take effect.

> ⚠️ Turbopack (`pnpm dev`) can panic on Windows in two ways: (1) "Next.js package not found" (a known
> Turbopack + pnpm-symlink issue — **not** a reason to switch to npm) → add an `.npmrc` with
> `node-linker=hoist` and re-run `pnpm install` for a flat, npm-like `node_modules` while keeping pnpm;
> (2) a PostCSS-worker spawn failure (`exit code 0xc0000142`) under heavy process pressure → use
> **`pnpm dev:webpack`** (webpack instead of Turbopack) or `pnpm build && pnpm start`. Either way it's
> environmental, not a code bug (`pnpm typecheck` / `pnpm build` compile the same routes cleanly).

Sign in at `/sign-in`; you're routed by role (broker → `/deal-room`, lender → `/lender/new-deals`,
admin → `/admin/alerts`).

### Edge functions + secrets (optional, for the AI / PDF / email features)

`supabase start` already runs an `edge_runtime` container serving everything in `supabase/functions/`
(`anti-contact`, `contact-us`, `invoice-pdf`, `match-document-name`, `notify-email`, `purge-documents`,
`purge-invoices`), so a function that needs **no custom secret** — `invoice-pdf` — works right after
`pnpm db:start`. Use `functions:serve` when a function needs a key from `supabase/.env`, or when you
ADDED a function since the runtime last started (it returns "Function not found" until then):

```bash
pnpm functions:serve        # = supabase functions serve --env-file supabase/.env  (hot-reload)
```

Put the custom secrets in **`supabase/.env`** (gitignored — real keys, never commit):

```bash
ANTHROPIC_API_KEY=sk-ant-...            # anti-contact AI 2nd layer (else it falls back to regex only)
RESEND_API_KEY=re_...                   # notify-email delivery
NOTIFY_FROM=LenderMatch <no-reply@your-verified-domain>   # must use a domain verified in Resend
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — only these three
custom vars need the file. `invoice-pdf` needs no external key. Without `ANTHROPIC_API_KEY` the app still
runs — `scanContact` falls back to the regex-only RPC and the DB triggers remain the hard backstop.
(See `.env.example` and `supabase/.env.example` for the full var list.)

**Email channel (notify-email):** in-app notifications work with no setup. To also deliver them by email,
the `notifications` AFTER INSERT trigger (migration 25) must know the function URL + a service-role key,
held in two DB settings. Configure them for local dev with:

```bash
pnpm notify:setup-local     # sets app.notify_email_url + local service-role key; re-run after db:reset
```

The trigger is a **fail-safe toggle that stays OFF by default** (it no-ops until these settings exist, and
never blocks a notification insert). Leaving it off locally guarantees dev and `pnpm smoke` send **nothing**
to Resend. To verify real delivery end-to-end, don't turn the trigger on — just send yourself one directly:

```bash
TEST_EMAIL=you@example.com pnpm smoke:email   # sends ONE real email to an inbox you control
```

`smoke:email` calls the function directly (service-role key), so it needs no GUCs/trigger; with no
`TEST_EMAIL` it's safe (only checks the guard + the "no send" path). You do **not** need Resend
inbound/receiving — just use any inbox you can already read as `TEST_EMAIL`. Real delivery also needs a
Resend-verified sending domain in `NOTIFY_FROM`; until then Resend only delivers to your own account
address via `onboarding@resend.dev`.

**Toggling emails in local (easy on/off).** Two independent channels, each with a toggle so you can run
local *with* or *without* email:

- **Notification emails** (the auto-trigger): `pnpm notify:on` / `pnpm notify:off` (runtime — sets/resets
  the trigger's DB GUCs; re-run `notify:on` after `db:reset`). Default is OFF, so dev + `pnpm smoke` send
  nothing to Resend. When ON, the app auto-emails on every notification — don't leave it on during `pnpm
  smoke` (the smokes' fake `@loanlink.test` users would bounce in Resend). (`notify:setup-local` = `notify:on`.)
- **Signup email confirmation** (the 6-digit **code** flow): `pnpm auth:confirm:on` / `pnpm auth:confirm:off`
  flips `[auth.email] enable_confirmations` in `config.toml` — then apply with `pnpm db:stop && pnpm
  db:start` (auth reads config at startup; data is preserved). Default OFF = instant signup (fast local).
  When ON, sign-up shows the code screen (`app/sign-up` → `verifyOtp`) for **both brokers and lenders** —
  a lender confirms the code first and only then lands on the approval-wait screen (skipping it left their
  email unconfirmed and locked them out; see `docs/client-revisions-2026-07-20.md` #12). The confirmation
  email carrying the code lands in **Mailpit → <http://127.0.0.1:54324>** (no real send needed). Keep
  `enable_confirmations = false` committed — the toggle is a local convenience, don't commit the flip.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | start / stop local Supabase (stop preserves data) |
| `pnpm db:reset` | wipe + replay all migrations (then re-run `pnpm seed`) |
| `pnpm db:types` | regenerate `lib/database.types.ts` from the local schema |
| `pnpm seed` | create test users + base demo data |
| `pnpm seed:demo` | one-shot full demo: db reset → restart Kong → all seeds (invoices, surveys, notifications, chats, offers, penalty) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (flat config, `eslint-config-next`) |
| `pnpm test` | Vitest unit tests for pure helpers (`tests/unit/`) |
| `pnpm check:i18n` | assert EN/FR catalog parity + that every static `t()` key resolves |
| `pnpm check` | the local gate: `typecheck` + `lint` + `check:i18n` + `test` |
| `pnpm smoke` | re-seed + run the whole smoke suite (see "Verifying flows") |
| `pnpm functions:serve` | serve edge functions with `--env-file supabase/.env` (hot-reload) |
| `pnpm notify:on` / `pnpm notify:off` | turn notification emails on/off locally (runtime GUCs; `notify:setup-local` = `notify:on`) |
| `pnpm auth:confirm:on` / `pnpm auth:confirm:off` | turn signup email-confirmation (code flow) on/off (`config.toml`; needs `db:stop && db:start`) |
| `pnpm build` / `pnpm start` | production build / serve |

**After adding or changing a migration:** `pnpm db:reset` (or `supabase migration up` to apply new
ones without wiping), then `pnpm db:types` so the TypeScript types match the schema.

## Verifying flows (smoke tests)

Node scripts that drive real broker/lender sessions against local Supabase and assert the business
rules end-to-end (RLS, RPCs, invoice math, anonymity).

**Run the whole suite:** `pnpm smoke` (re-seeds, then runs every smoke and prints a pass/fail summary;
add `--no-seed` to run against the current DB). The suite is **idempotent** — each smoke self-cleans,
so it is re-runnable without a `db:reset`. Individual scripts:

```bash
node scripts/smoke-slice.mjs          # create draft → submit → lender sees deal but NOT the identity
node scripts/smoke-delete-draft.mjs   # broker deletes own DRAFT (+ child cascade); can't delete submitted / others'
node scripts/smoke-offers.mjs         # make offer → accept → confirm → invoice + bps 3/4/5 + identity reveals
node scripts/smoke-anti-contact.mjs   # contact info in offer comments / deal notes is blocked + alerted
node scripts/smoke-notifications.mjs  # approve/reject lender → notification + recipient-only RLS
node scripts/smoke-expired.mjs        # expired-deals feed: visibility, decline/archive exclusion, anonymity
node scripts/smoke-open-filter.mjs    # New Deals feed narrowed by a real saved filter (server-side)
node scripts/smoke-messages.mjs       # broker↔lender chat: send, inbox, ordinals, anti-contact, RLS
node scripts/smoke-signup.mjs         # sign-up: anon org lists, broker active vs lender pending, admin queue
node scripts/smoke-admin.mjs          # admin console: analytics gate, all-deals visibility, legal CRUD/publish/RLS
node scripts/smoke-invoice-pdf.mjs    # invoice-pdf edge fn: owner generates a real PDF, non-owner denied (RLS)
node scripts/smoke-faqs.mjs           # FAQs: audience-scoped reads, admin CRUD, non-admin write blocked (RLS)
node scripts/smoke-surveys.mjs        # closing survey: job creates it, broker submits (Q0 gate), broker-only
node scripts/smoke-password-reset.mjs # password reset: recovery token → verifyOtp → updateUser → new login
node scripts/smoke-open-filtered.mjs  # New Deals server-side filters: criteria narrow the feed, visibility held
node scripts/smoke-maturing.mjs       # match-% engine: weights, formula, "does not match" badge, Bubble bugs #10/#11
node scripts/smoke-decline.mjs        # decline drops the deal from New Deals + Maturing feeds (per-lender)
node scripts/smoke-penalty.mjs        # rating penalty: effect + survey→job computation; admin lift
node scripts/smoke-notify-email.mjs   # email channel: anon rejected (401), disabled recipient → no send; opt-in real send
```

> `smoke-invoice-pdf.mjs` passes on a plain `pnpm db:start` — the bundled `edge_runtime` serves
> `invoice-pdf`, which needs no custom key (same for the lender/invoices **Download PDF** button). Start
> `pnpm functions:serve` only if it reports "Function not found" (a function added since the runtime
> booted), or for the ones that read `supabase/.env`: the `anti-contact` AI layer, `notify-email` /
> `smoke-notify-email.mjs`, `match-document-name` and `contact-us`.
>
> ⚠️ **After `pnpm seed:demo`, expect `smoke-penalty.mjs` to fail one check** — "computation: 3 + 3
> across both questions → NOT penalized". It is seed contamination, not a bug: `seed-surveys.mjs` writes
> a survey on `DEAL-2026-402` with `doc_review_on_time = false` for **`lender@loanlink.test`**, the same
> lender the smoke uses, and it lands inside the last-10 window the penalty job reads — becoming a 4th
> "no" in the 3+3 case. `pnpm smoke` reseeds without surveys, so a DB that never ran `seed:demo` is green.
>
> `smoke-notify-email.mjs` is standalone (not in `pnpm smoke`): safe by default (no email), and with
> `TEST_EMAIL=you@example.com pnpm smoke:email` it sends one real email to verify delivery.

## Project layout

```text
app/                      broker routes at root; app/lender/*; app/admin/*
components/               broker-header, lender-header, admin-header + components/ui (shadcn)
lib/supabase/             client.ts (browser) · server.ts (RSC) · middleware.ts (session refresh)
lib/queries/              deals, offers, saved-filters, admin — typed data access
lib/enums.ts              enum ↔ display-label maps (UI stores the enum value, not the label)
lib/database.types.ts     generated from the DB (pnpm db:types)
proxy.ts                  Next 16 middleware (refreshes the Supabase session cookie)
supabase/migrations/      SQL: schema · functions/RPCs · RLS · cron jobs · later fixes
scripts/                  seed-* (test data) · smoke-* (end-to-end checks)
docs/extracted/           Bubble extraction — ground truth for behavior parity
```

## Hosted deployment

**Client-owned infra — migration in progress (2026-07-10).** Handoff to the client's own GitHub + Supabase +
Vercel is underway. The **authoritative, step-by-step deploy guide is [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md)**
— follow it (and replicate for prod). Summary:

| | |
|---|---|
| **Repo** | GitHub `elizabethbonnie80-byte/lender-match` (`origin`) — renamed from `…/test` 2026-07-27 |
| **Supabase — prod** | `lender-match` · ref `bcedtccidfehdbthmhss` · `ca-central-1` · Free |
| **Supabase — staging** | `lender-match-staging` · ref `kejjhlfelidajdijojmp` · `ca-central-1` · Free |
| **Vercel** | project `lender-match` · framework `nextjs` |
| **Branch / env model** | `staging` = **base dev branch** → Vercel Preview → staging Supabase · `main` = **prod** → Production → prod Supabase (merge `staging`→`main` only to deploy prod) |
| **Status** | **staging live + seeded** (`/sign-in` 200, demo accounts `Test1234!`); **prod pending** (runbook §8) |
| **Access** | seeded demo accounts, password `Test1234!` — see [Test accounts](#test-accounts-password-test1234) |

> The subsections below are the **original dev** deployment notes (Supabase `zyxfsewiejvtnhftnasu`,
> `loan-link-rho.vercel.app`, GitLab) — kept as background; **`docs/DEPLOY_RUNBOOK.md` supersedes them** for
> the client infra (same gotchas, current values + the staging/prod branch model).

### Vercel

- The Next.js framework preset is **pinned in [`vercel.json`](./vercel.json)** (`{"framework":"nextjs"}`).
  On import the project came up with framework `null` ("Other"), so every route returned
  `x-vercel-error: NOT_FOUND` **even though `next build` succeeded** — Vercel wasn't applying the Next.js
  runtime/routing to the output. Keep `vercel.json` (or set the preset to Next.js in project settings).
- Environment variables (Production + Preview + Development): `NEXT_PUBLIC_SUPABASE_URL` = the API URL
  above, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the project's anon key (public — RLS enforces access). **Never**
  put the service-role key in Vercel env or any committed file.

### Supabase cloud

- **Migrations** were applied via the Supabase MCP `apply_migration`. ⚠️ The MCP records its **own**
  version timestamps in `supabase_migrations`, so a CLI `supabase db push` won't recognize the repo's
  file versions as applied. To manage migrations from the CLI later, either keep using the MCP or
  reconcile history with `supabase migration repair`. (The CLI path also needs the project's DB password,
  which the MCP-created project doesn't expose — reset it in Settings → Database first.)
- **Edge functions** (`anti-contact`, `invoice-pdf`, `notify-email`) are deployed. Set their custom
  secrets in **Dashboard → Edge Functions → Secrets**: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
  `NOTIFY_FROM` (`SUPABASE_*` are auto-injected; `invoice-pdf` needs no custom key).
  - ⚠️ **New-API-key gotcha:** the edge runtime injects the **new `sb_secret_…`** key as
    `SUPABASE_SERVICE_ROLE_KEY` (not the legacy `service_role` JWT). The legacy JWT still works for
    seeding / Data API / Auth admin, but anything compared against the function's injected key
    (notify-email's bearer guard, the email trigger) must use the **`sb_secret_…`**.
- **Auth**: set Site URL + Redirect URLs to the Vercel domain (Authentication → URL Configuration) so
  password-reset / email-confirm links resolve. Email confirmation is **ON**, and sign-up uses the
  **6-digit code** flow (`app/sign-up` → `verifyOtp`), so configure in the dashboard:
  - **SMTP → Resend** (Auth → SMTP Settings): host `smtp.resend.com`, port `465`, user `resend`, pass =
    your Resend API key, sender = an address on your verified domain (e.g. `no-reply@lender-match.quinielaplay.com`).
    Without custom SMTP, Supabase's built-in email is heavily rate-limited and won't reliably deliver to real users.
  - **Confirm signup template** (Auth → Email Templates → Confirm signup): send the code with `{{ .Token }}`
    (mirror `supabase/templates/confirmation.html`) instead of the magic link.
- **Email auto-trigger**: migration 25's custom `app.*` GUCs **cannot be set on hosted** (`42501
  permission denied` at both database and role level — Supabase locks down custom-GUC setting).
  **Migration 33** adds a GUC → **Supabase Vault** fallback; the hosted values live in Vault:
  ```sql
  select vault.create_secret('https://zyxfsewiejvtnhftnasu.supabase.co/functions/v1/notify-email', 'notify_email_url');
  select vault.create_secret('<sb_secret_… key>', 'notify_service_role_key');
  ```
  Verified end-to-end on cloud: notification insert → `tg_notify_email` → pg_net → function → Resend →
  `net._http_response` shows `200 {"sent":true}`. So a real user (real email + `notify_email_enabled`)
  gets emails automatically.

### Seeding the hosted DB

`pnpm seed:demo` is **local-only** (it runs `supabase db reset` + restarts Kong — it would wipe *local*,
not touch the cloud). To seed a hosted project, run the individual scripts with the cloud env. Put the
hosted values in **`scripts/.env.cloud`** (gitignored — holds the service-role/secret keys, **never
commit**):

```bash
# scripts/.env.cloud
SUPABASE_URL=https://zyxfsewiejvtnhftnasu.supabase.co
SUPABASE_ANON_KEY=<hosted anon key>
SUPABASE_SERVICE_ROLE_KEY=<hosted legacy service_role JWT>   # used by the seed Admin API
SUPABASE_SECRET_KEY=<hosted sb_secret_… key>                 # for the email smoke bearer / Vault
```

```bash
set -a && . scripts/.env.cloud && set +a
for s in seed-users seed-maturing seed-admin seed-notifications seed-chats \
         seed-offers seed-invoices seed-surveys seed-penalty; do
  node scripts/$s.mjs || break
done
```

Verify the email pipeline against the hosted function (sends ONE real email; uses the `sb_secret` as the
bearer to match the function guard):

```bash
set -a && . scripts/.env.cloud && set +a
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SECRET_KEY" TEST_EMAIL=you@example.com node scripts/smoke-notify-email.mjs
```
