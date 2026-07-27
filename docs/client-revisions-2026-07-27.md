# Client answers — 2026-07-27

Source: client email (Bonnie Casault) answering the two questions left open at the end of Round 3
Phase 3. The client also says a further list of minor amendments is coming ("still going through some
things"), so expect another batch after this one.

> *"the site looks great from what I've seen so far. I do have a list of minor things for you to amend
> but I'm still going through somethings so will send when I've done that."*

Implemented in **migration 52** (`20260727000052_prequal_lender_window_and_doc_retention.sql`) plus the
UI/i18n changes below. Nothing here was in the Round 3 quote; both items are answers to questions we
raised, so they close scope rather than adding it.

---

## 1. Prequal fine print — where it goes, and who sees it

> *"Here is the verbiage for brokers when they view an offer. There is nothing different for a lender
> when they're sending an offer on a prequal:"*
>
> *"Please Note: Pre-qualification offers are intended to help identify potential lender interest and
> are not binding commitments or rate holds. Rates, terms, and lending conditions are subject to change
> at any time prior to the submission and review of a complete application. Offers shown on the platform
> will not be updated to reflect future rate changes."*

Two consequences, because we had built it the other way round:

- **Removed from the lender's Make Offer dialog.** `makeOffer.prequalFinePrint` was **our** invented
  wording (flagged as such in `round3-progress.md`); the key is deleted from both catalogs, and the
  `prequal` prop + the `offerHasPrequal` plumbing in `hooks/use-lender-deal-feed.ts` and the two feed
  pages are gone with it. The lender still sees the **PREQUAL badge** on the deal card, which is all the
  client asked for.
- **Added for the broker**, verbatim, as `dealDetail.prequalOfferNotice` (EN = the client's text,
  FR translated), rendered above the offers list on `/deal-detail/[id]`.

**Judgement call to confirm:** we show it when `prequal` is true **or** `prequal_converted_at` is set —
i.e. also after "Move to Live Deal". The offers on screen at that point were still placed against a
pre-qualification, so the disclaimer applies to them; the client only said "when they view an offer".
Easy to narrow to unconverted prequals only if they disagree.

`BrokerDealDetail` gained `prequal` + `prequalConvertedAt` to drive it (broker-scoped query, no
anonymity implications).

## 2. Prequal expiry — split between lender and broker, and document retention

> *"Prequals should expire for the lenders but not for the brokers, if that makes sense? They should
> only spend 15 days on the lender queues but the file should stay active for the broker until they
> delete it. However, for the documents they've uploaded (the PDF's), those should be deleted 120 days
> after they've been uploaded. So max of 240 - to ensure we don't have documents sitting around for
> years if a broker doesn't clean up their account."*

### 2a. A prequal never reaches status `expired`

`expired` is broker-visible state, and `job_archive_expired_deals` would bury the deal 30 days later —
both wrong now. So `job_expire_old_deals` **skips prequals**, and the 15-day cutoff became a pure
**visibility** rule inside `lender_can_see_deal`:

```sql
and (not coalesce(d.prequal, false)
     or d.created_at > now() - interval '15 days'
     or i_offered_on(d.id))
```

Three deliberate properties:

- **Computed from `created_at`, not from a cron-set flag.** The window closes on time even if the cron
  never runs. `deals.prequal_lender_notice_at` exists only as the "we already told the broker" marker —
  it is never consulted for visibility. (Two fields, one boundary, but the semantics genuinely differ.)
- **Folded into `lender_can_see_deal`**, which means the feeds, the `make_offer` guard and chat are all
  covered by the one clause — the same trick migration 48 used for "no marketplace re-entry".
- **`i_offered_on` exemption.** A lender who already bid keeps full access: their offer is still live in
  Submitted Offers and stays acceptable once the broker converts the deal.

The broker gets **one** notification when the window closes (type `deal_expired`, prequal-specific body —
no new enum value needed). Without it the Deal Room would read "Submitted" forever while no lender could
see the deal. The Deal Room row also renders a hint (`dealRoom.prequalQueueClosed`), driven by
`BrokerDealListItem.lenderQueueClosed` and the new `isLenderQueueClosed()` /
`LENDER_QUEUE_MAX_AGE_DAYS` in `lib/age-windows.ts` (the one home for the day-count, per the file's own
rule).

⚠️ **Known consequence, not a bug:** a prequal whose lender window closed with no offers can still be
moved to a live deal, but it will not re-enter any lender's feed — "no marketplace re-entry" (migration
48) still governs. In practice the broker should create a fresh deal instead. Worth mentioning to the
client if they ever ask why a converted stale prequal gets no bids.

### 2b. Document retention

The old rule was `closing_date + 120`, evaluated in the `purge-documents` edge function as
`.lt("deals.closing_date", cutoff)`. **A prequal has no closing date, so that predicate never matched it
and its PDFs would have been kept forever** — precisely the "documents sitting around for years" case
the client is worried about.

The rule now lives in SQL (`documents_to_purge()`), so the edge function holds no policy of its own and
the smoke can assert the rule without the edge runtime. Three legs:

| Case | Deleted |
|---|---|
| Closing date set | 120 days after the closing date (unchanged) |
| No closing date (prequal, or never converted) | 120 days after upload |
| Any case | hard ceiling: 240 days after upload |

**Interpretation to confirm with the client.** Their sentence combines "deleted 120 days after they've
been uploaded" with "max of 240", which cannot both be literal for a deal that closes late. We read the
ceiling as the guarantee they actually care about ("don't have documents sitting around for years") and
kept the closing-date leg so a document is never destroyed *before* the deal closes — a broker-entered
`closing_date` can be arbitrarily far out, so without the ceiling a closing two years away would keep
the files two years. If they meant a flat upload+120 with no exceptions, it is a one-line change.

### 🔒 Security finding while building this

`documents_to_purge()` is `SECURITY DEFINER` and spans every brokerage, so it was written with
`revoke execute … from anon, authenticated`. **The smoke still showed a broker and a lender calling it
successfully**, and `pg_proc.proacl` explained why:

```
{=X/postgres,postgres=X/postgres,service_role=X/postgres}
   ^^^ PUBLIC has EXECUTE
```

**Postgres grants EXECUTE to PUBLIC on every newly created function.** Revoking from `anon`/
`authenticated` does nothing on its own — they inherit through PUBLIC. Any authenticated user could
enumerate the storage paths of every deal document on the platform. Fixed with
`revoke execute … from public, anon, authenticated`, and `smoke-prequal` now asserts both roles get
`permission denied for function documents_to_purge`.

**Standing rule (added to `CLAUDE.md`):** a `SECURITY DEFINER` function that must not be callable with a
user token has to be revoked **from `public`**, not just from the API roles — and the revoke has to be
proven by a test, because the migration applies cleanly either way.

---

## Verification

- Migration 52 replays clean from scratch (`supabase db reset`, 52/52).
- `pnpm check` green — typecheck + lint (0 errors) + i18n parity (1579/1579 keys, every static `t()`
  resolves) + unit tests.
- `pnpm smoke` **23/23** green. `smoke-prequal` grew from 27 to ~50 checks covering: the lender window
  (feed, row read, bid guard, the bidder's exemption), the job leaving the prequal active + notifying
  once + not re-notifying, a live deal still expiring as the control, all six retention cases, and the
  two grant assertions.
- `purge-documents` verified end-to-end against the local edge runtime with a real uploaded object:
  `200 {"purged":1}`, Storage bytes gone, tracking row gone.

## Status

Implemented and verified locally on `dev`. **Not yet deployed** to staging or prod.
