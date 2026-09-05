-- Schema-only step 1 of 2 for the Switch Lender invoice-preservation fix (approved 2026-09-04): adds a
-- distinct `voided` invoice status so Lender A's invoice can be preserved for audit/accounting history
-- when a broker switches to Lender B, instead of being deleted outright (today's switch_offer()
-- behavior) or reusing the semantically different `cancelled` status (which is lender/admin-initiated
-- and would make an automatic switch-supersession indistinguishable from a human's explicit cancel).
--
-- This is deliberately schema-only. Postgres cannot add an enum value and reference it in the same
-- transaction — the same constraint already documented in this repo at migration 74 (`offer_status` +
-- 'withdrawn'), which split into a bare enum-add migration followed by a separate migration that uses
-- it (migration 75). Migration 86 is that second half here: the switch_offer()/accept_offer() logic
-- changes, the retention-job updates, and everything else that actually sets or reads `status = 'voided'`.
-- Nothing in this migration references the new enum value, so it's safe to bundle the plain column
-- additions (which don't touch the enum at all) into the same file as the enum-value addition.
--
-- voided_at / voided_reason / voided_by are dedicated columns, not a reuse of cancelled_at/
-- cancelled_reason — the two events are semantically distinct (a human explicitly cancelling an invoice
-- vs. a switch automatically superseding one) and should stay independently queryable/auditable rather
-- than sharing one column pair with an implied "which case is this" ambiguity.
--
-- This same `voided` status will also back the future Admin Invoice Management feature's manual Void
-- action (not yet built) — one status for "no longer payable, kept for the record" regardless of whether
-- it happened automatically via a switch or manually via an admin action, rather than inventing a second,
-- near-identical status later.

alter table invoices
  add column voided_at timestamptz,
  add column voided_reason text,
  add column voided_by uuid references profiles(id);

comment on column invoices.voided_at is
  'Set when this invoice is voided (currently only by accept_offer() superseding it via a broker Switch Lender — migration 86). Distinct from cancelled_at, which is a human-initiated cancel via cancel_invoice().';
comment on column invoices.voided_reason is
  'Free-text reason, e.g. "Superseded by lender switch" (automatic) or an admin-typed reason (future manual Void action). Never null when voided_at is set.';
comment on column invoices.voided_by is
  'The acting user for a manual void (an admin, future feature). Null for the automatic switch-supersession case, since no specific user "does" that beyond the broker accepting a replacement offer.';

alter type invoice_status add value if not exists 'voided';

comment on type invoice_status is
  'pending/paid/cancelled (original) + voided (2026-09-04): no longer payable but retained for audit/accounting history — set automatically when a broker''s Switch Lender supersedes an invoice (migration 86), and reused (not duplicated) by the future Admin Invoice Management manual Void action.';

-- Same index shape as the existing archived_at partial index (migration 60) — supports the migration-86
-- retention-job query efficiently, and costs nothing on the (currently always-null) common case.
create index if not exists invoices_voided_idx on invoices (voided_at) where voided_at is not null;
