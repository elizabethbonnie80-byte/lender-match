# Deploy Runbook — LenderMatch (client-owned infra)

Step-by-step to stand up (or re-create) an environment on the **client-owned** stack: GitHub + Supabase +
Vercel. Written from the real staging bring-up (2026-07-10); **follow the same steps for prod with the prod
values**. Keep this in sync when the process changes.

> Interim brand is **Loan Link**; the LenderMatch™ rebrand is a Round 3 item (on hold). Infra/resource names
> use `lender-match` — that's just naming, not the app brand.

---

## 1. Architecture & accounts

| Piece | Value |
|---|---|
| **Repo** | GitHub `elizabethbonnie80-byte/lender-match` (single squashed history; `origin`). Renamed from `…/test` 2026-07-27; the old URL still redirects, and Vercel followed the rename on its own (it binds to the repo ID) |
| **Supabase org** | `vercel_icfg_NibyY0GS3ZwLKfHfaDirmYCb` (`elizabethbonnie80-5249's projects`, **Free**) |
| **Supabase prod** | `lender-match` · ref `bcedtccidfehdbthmhss` · `ca-central-1` |
| **Supabase staging** | `lender-match-staging` · ref `kejjhlfelidajdijojmp` · `ca-central-1` |
| **Vercel** | team `team_RO4YBSdHhzKziaEJuJ9CpP9w` · project `lender-match` (`prj_WymejSMhXllTicV0MdurY06IGrDO`) |

Two **separate Free Supabase projects** (prod + staging) — Supabase branching (per-PR/persistent staging DBs)
is Pro-only; two Free projects is the $0 path. Paused projects don't count against the Free 2-project cap.

## 2. Branch & environment model (IMPORTANT)

```
staging  →  Vercel Preview     →  Supabase staging (kejjhlfelidajdijojmp)   ← BASE DEV BRANCH
main     →  Vercel Production  →  Supabase prod    (bcedtccidfehdbthmhss)
```

- **`staging` is the base development branch.** All day-to-day work and PRs target `staging`. Every push to
  `staging` (and any non-`main` branch) auto-deploys to Vercel **Preview**, which uses the **Preview**-scoped
  env vars → the **staging** Supabase.
- **`main` is production-only.** **Merge `staging` → `main` ONLY when you intend to deploy to prod.** A push to
  `main` deploys to Vercel **Production** → the **prod** Supabase.
- Vercel decides Production vs Preview purely by branch: production branch (`main`) = Production, everything
  else = Preview. What ties "Preview → staging Supabase" is the **Preview-scoped env vars**, not the branch name.

## 3. Prerequisites (one-time / local)

- **Supabase CLI** (via `npx supabase …`; it's a devDependency) logged into the **client** account:
  `npx supabase login --token <PAT>` (PAT from dashboard → Account → Access Tokens). Run in your own terminal —
  never paste the token into a shared log.
- **`scripts/.env.cloud`** (gitignored): DB passwords + secret keys. Keys used here:
  `SUPABASE_DATABASE_PRODUCTION_PASSWORD`, `SUPABASE_DATABASE_STAGING_PASSWORD`, `SUPABASE_STAGING_SECRET_KEY`
  (add `SUPABASE_PRODUCTION_SECRET_KEY` for prod). ⚠️ Its `SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` may be
  STALE (they still pointed at the old dev project) — **always use per-project values, don't trust these.**
- **`supabase/.env`** (gitignored): `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `NOTIFY_FROM`.
- **Vercel** connected to the GitHub repo (GitHub App), production branch = `main`.

## 4. Supabase — per project (run for staging, then prod)

Let `REF` = the project ref (`kejjhlfelidajdijojmp` staging / `bcedtccidfehdbthmhss` prod).

### 4.1 Migrations
1. Dashboard → Settings → Database → **Reset database password**, save it to `scripts/.env.cloud`.
2. Link + push (DB password by-reference from the env file, never printed):
   ```bash
   export SUPABASE_DB_PASSWORD="<that project's DB password>"
   npx supabase link --project-ref $REF
   npx supabase db push          # applies all 35 migrations in order
   ```
   The trailing `pg-delta … pgdelta-target-ca.crt ENOENT` **Warning** is a cosmetic post-push cache step, not an
   apply failure ("Finished supabase db push" = success). Verify: `npx supabase migration list` → 35 rows.

### 4.2 Edge functions
```bash
npx supabase functions deploy anti-contact --project-ref $REF
npx supabase functions deploy invoice-pdf  --project-ref $REF
npx supabase functions deploy notify-email --no-verify-jwt --project-ref $REF
```
⚠️ **`notify-email` MUST be `--no-verify-jwt`**: the DB email-trigger authenticates with the project's
`sb_secret_…` key, which is **not a JWT**, so platform JWT verification would reject it; the function does its
own bearer check. The other two keep default JWT verification (called by end users with a real user JWT).

### 4.3 Function secrets
```bash
npx supabase secrets set --env-file supabase/.env --project-ref $REF   # ANTHROPIC/RESEND/NOTIFY_FROM
```

### 4.4 Vault — email trigger (migration 33)
The `notifications` → `notify-email` pipeline reads two Vault secrets:
- `notify_email_url` = `https://$REF.supabase.co/functions/v1/notify-email`
- `notify_service_role_key` = **that project's `sb_secret_…`** (Dashboard → Settings → API → Secret keys) — it
  must equal the function's injected `SUPABASE_SERVICE_ROLE_KEY`, which on new projects is the `sb_secret_…`.

Set them WITHOUT exposing the key value. Either the **dashboard Vault UI**, or a throwaway wrapper + script:
```sql
-- via MCP/SQL editor (URL is not secret; the key is set from a script, below)
create or replace function public._set_vault_secret(p_name text, p_value text)
returns void language plpgsql security definer as $$
begin delete from vault.secrets where name = p_name; perform vault.create_secret(p_value, p_name); end $$;
revoke execute on function public._set_vault_secret(text,text) from public, anon, authenticated;
grant  execute on function public._set_vault_secret(text,text) to service_role;
```
then a Node one-off (supabase-js with the project URL + `sb_secret_`) calls `.rpc('_set_vault_secret', …)` for
both names, reading the key from `scripts/.env.cloud` (never printed); finally
`drop function public._set_vault_secret(text,text);`. Verify: `select name from vault.secrets;`.

### 4.5 Auth config (dashboard — the Supabase MCP/CLI can't read/verify this)
- **URL Configuration** → Site URL = the Vercel URL for this env; Redirect URLs → add `<vercel-url>/**`.
  - staging Site URL: `https://lender-match-git-staging-elizabethbonnie80-5249s-projects.vercel.app`
  - prod Site URL: the prod domain (`lender-match-black.vercel.app` or the custom domain once connected).
- **SMTP** (Auth → Emails → SMTP): host `smtp.resend.com`, port `587` (fallback `465`), user `resend`,
  password = `RESEND_API_KEY`, sender `LenderMatch <no-reply@lender-match.quinielaplay.com>` (Resend sending
  domain must be **verified**).
- **Email Templates** — all send a 6-digit **CODE** (`{{ .Token }}`), NOT a link (magic links get consumed
  by email prefetch scanners → `otp_expired`): Reset Password ← `supabase/templates/recovery.html`; Change
  Email Address ← `supabase/templates/email-change.html`; Confirm signup ← `supabase/templates/confirmation.html`.
  The app's `/forgot-password` + Account Settings verify the code via `verifyOtp`.
- **Turn OFF "Secure email change"** (Auth → Providers → Email) so a single code sent to the NEW address
  completes an email change (otherwise Supabase requires confirming BOTH the old and new address).
- These live versioned in `config.toml` as reference, but are **applied via the dashboard**. `config.toml` keeps
  `[auth.email.smtp] enabled = false` so local `supabase start` stays on the Inbucket test inbox and never sends
  real mail. To instead apply via `supabase config push`, set `enabled = true` AND first parameterize
  `site_url`/`additional_redirect_urls` with `env()` (they're localhost, shared with local dev) — `config push`
  is all-or-nothing and would otherwise clobber the remote URLs with localhost.

### 4.6 Seed (optional — staging yes, prod probably NO demo data)
Scripts read `process.env` directly (no `.env` loading), so export the target's creds first. The project's
`sb_secret_…` works as `SUPABASE_SERVICE_ROLE_KEY` for both Auth Admin API and the Data API.
```bash
export SUPABASE_URL="https://$REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<that project's sb_secret_>"
export SUPABASE_ANON_KEY="<that project's anon key>"
# core:
node scripts/seed-users.mjs && node scripts/seed-maturing.mjs && node scripts/seed-admin.mjs
# full demo (dependency order):
for s in offers invoices chats notifications surveys penalty; do node scripts/seed-$s.mjs; done
```
Seeded accounts: `{broker,lender,admin,pending.lender}@loanlink.test` / `Test1234!`. **Do not seed prod with
demo accounts** — reference data (brokerages/institutions/penalty_settings) already ships via the migrations.

## 5. Vercel

1. Import the GitHub repo. Framework auto-detects **Next.js** (`vercel.json` pins `{"framework":"nextjs"}` —
   without it the import can come up `framework: null` → every route 404 despite a green build).
2. Settings → Git → **Production Branch = `main`**.
3. Settings → **Environment Variables** (values are public — the anon key is browser-facing):
   | Var | Production scope | Preview scope |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://bcedtccidfehdbthmhss.supabase.co` | `https://kejjhlfelidajdijojmp.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon key | staging anon key |
   ⚠️ **`NEXT_PUBLIC_*` are inlined at BUILD time** → set them BEFORE the build; after changing them, **redeploy**
   (the running build won't pick up new values). Never put the service-role/secret key in Vercel env.
4. Deploy = push the branch. `main` → Production, `staging` → Preview.
   ⚠️ **Webhook hiccup:** a brand-new branch's first push sometimes doesn't trigger a Vercel deploy; if the
   deploy never appears, push again (an empty commit is enough).

## 6. Verify

- `npx supabase migration list` (35), `list_tables` (24 RLS tables), `get_advisors security` (only the expected
  SECURITY-DEFINER-RPC / search_path / counter-no-policy WARN/INFO — no ERROR).
- Vercel deployment `READY`; fetch `<url>/sign-in` → **HTTP 200** (a 500 means the env vars are missing/not
  rebuilt).
- Functional: sign in with a seeded account; password-reset needs a **real inbox** (seeded users are fake
  `@loanlink.test`).

## 7. Gotchas (all learned the hard way)

- `NEXT_PUBLIC_*` = build-time → set before build, redeploy after change.
- Vercel first-branch-push webhook hiccup → re-push.
- New projects inject the **`sb_secret_…`** as `SUPABASE_SERVICE_ROLE_KEY` → `notify-email --no-verify-jwt`,
  Vault `notify_service_role_key` = `sb_secret_`, and `sb_secret_` works for seeding (Auth admin + Data API).
- `scripts/.env.cloud` URL/anon/service-role may be stale (old dev project) — use per-project values.
- `config.toml [auth.email.smtp] enabled = false` protects local dev (Inbucket); Auth email is applied via the
  dashboard. The Supabase MCP cannot read Auth/SMTP/URL/template config — verify visually or functionally.
- Handle every secret **by-reference** (source from a gitignored env file, pass by var name, redact output).
  Never paste DB passwords / service-role / secret keys into chat or `--%` command lines.

## 8. Prod bring-up checklist (delta from staging)

- [ ] `scripts/.env.cloud`: add prod DB password + `SUPABASE_PRODUCTION_SECRET_KEY`.
- [ ] §4.1–4.4 against `REF=bcedtccidfehdbthmhss`.
- [ ] §4.5 Auth: Site URL/redirects = the prod Vercel domain; SMTP + templates.
- [ ] §4.6: **do NOT seed demo data** on prod (reference data comes from migrations; create real admin/founders
      accounts deliberately).
- [ ] Vercel: set **Production**-scoped `NEXT_PUBLIC_*` → prod Supabase, then **redeploy `main`** (it's 500
      until its env vars exist + a rebuild).
- [ ] Merge `staging` → `main` to ship, verify `<prod-url>/sign-in` → 200.
