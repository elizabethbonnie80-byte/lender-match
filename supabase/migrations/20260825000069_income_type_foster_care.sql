-- Round 4 (approved for this item only, 2026-08-25) — "Foster Care Income" income type.
--
-- income_type is a Postgres enum consumed generically everywhere it's used: the Create Deal
-- checkbox grid renders off INCOME_TYPE_OPTIONS with no per-value code, the four lender feed RPCs
-- return it via `array_agg(dit.income_type)` (no per-value OUT column), saved_filter_matches
-- excludes it via one generic `NOT EXISTS` clause against `sf.income_types`, and the ad-hoc Filters
-- panel passes it straight through as `p_income_types_excluded income_type[]`. None of that SQL
-- enumerates individual values (verified: grepped every migration for hardcoded income_type
-- literals — none outside this type's own CREATE TYPE statement), so adding a new value needs no
-- function changes at all.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it, which is why this
-- migration only declares the value — same pattern as migration 51 (dwelling_type additions).

alter type income_type add value if not exists 'foster_care_income';

comment on type income_type is
  'Income type (multi-select via deal_income_types). foster_care_income added 2026-08-25 (Round 4) — additive only, no retired values.';
