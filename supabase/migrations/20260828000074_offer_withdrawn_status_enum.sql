-- One offer per lender institution per deal (approved 2026-08-28) — step 1 of 2.
--
-- Withdrawal currently hard-DELETEs the offers row (offers_lender_withdraw RLS policy), which loses
-- history: an institution that withdrew its one offer on a deal would leave no trace, letting another
-- user at the same institution submit a fresh one — defeating the "one offer EVER" rule (not just one
-- active offer) approved for this feature. Withdrawal needs to become a retained status instead.
--
-- Postgres cannot add an enum value and reference it in the same transaction, so this has to be its
-- own migration — nothing here uses 'withdrawn' yet (see migration 75 for the RPC/RLS/column changes
-- that do), matching the precedent in migration 51 (dwelling_type) / 69 (income_type) / 70 (dwelling_type).

alter type offer_status add value if not exists 'withdrawn';

comment on type offer_status is
  'pending/accepted/declined/switched (Round 3) + withdrawn (2026-08-28): a lender-initiated withdrawal, now a retained status instead of a hard row delete — see migration 75.';
