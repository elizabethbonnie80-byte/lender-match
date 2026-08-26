-- Round 4 (approved for this item only, 2026-08-25) — "Condo Conversion" dwelling type.
--
-- Same additive pattern as migration 51 (duplex_detached / duplex_semi_detached /
-- apartment_low_rise / apartment_high_rise) and migration 69 (foster_care_income): dwelling_type is
-- consumed generically everywhere — the Create Deal dropdown renders off DWELLING_TYPE_OPTIONS with
-- no per-value code, the lender Filters sidepanel exclusion grid and both feeds' `dwelling_types_
-- excluded` plumbing operate on the whole array, and saved_filter_matches's dwelling-type exclusion
-- block is one generic null-safe NOT EXISTS-style check. Verified: no migration hardcodes an
-- individual dwelling_type literal outside this type's own CREATE TYPE statement and migration 51.
--
-- match_percentage DOES score dwelling type (weight 4), but only against `sf.dwelling_type` — the
-- single-value INCLUDE column the Filters sidepanel retired in favour of the exclusion-array model
-- (migration 56: "The UI no longer offers that control"). No UI path can set that column to
-- 'condo_conversion', so this addition cannot affect scoring for any lender.
--
-- Display order ("immediately after Condo Townhouse") is controlled entirely by lib/enums.ts's
-- DWELLING_TYPE key order, not by this type's internal ordinal position — so this migration appends
-- the value with a plain ADD VALUE, same as migration 51's four additions, rather than using
-- ADD VALUE ... AFTER. (A real `pnpm db:types` regeneration lists enum members by that ordinal
-- position, which is exactly why migration 51's four values appear at the END of the generated
-- lib/database.types.ts lists rather than interleaved — the hand-mirrored edit here matches that.)
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it, which is why this
-- migration only declares the value.

alter type dwelling_type add value if not exists 'condo_conversion';

comment on type dwelling_type is
  'Type of Dwelling. condo_apartment / farm / recreational are RETIRED (2026-07-22): still valid for historical rows and still labelled in lib/enums.ts, but no longer offered in the UI. condo_conversion added 2026-08-25 (Round 4) — additive only.';
