-- Admin Invoice Management (approved 2026-09-04) — one feature batch, one migration file. No enum
-- value is added here (tax lines are a JSONB template/array, not a fixed option set), so nothing forces
-- a Postgres-mandated split the way migrations 85/86 needed for the `voided` enum value.
--
-- ============================================================================
-- SCOPE
-- ============================================================================
-- 1. Per-invoice admin editing: subtotal, discount (amount + reason), configurable tax lines
--    (label/rate, amount always SERVER-computed), description, billing reference, notes, payment
--    instructions, due date. Grand total is always recomputed server-side:
--        grand total = subtotal - discount + tax total
--    enforced by a CHECK constraint (not just application code) — see invoices_amount_matches_calc.
-- 2. Append-only revision history (invoice_revisions): every mutation to an invoice — admin edit,
--    admin void, the lender's own update_invoice/cancel_invoice/mark_invoice_paid, and the automatic
--    switch-supersession void inside accept_offer — snapshots the PRE-change row, then bumps
--    revision_number. One mechanism (log_invoice_revision()) for all of them, so there are not two
--    inconsistent mutation paths.
-- 3. Void via the EXISTING `voided` status (migration 85) — no new status introduced.
-- 4. Global Invoice Settings (invoice_settings, singleton): defaults applied to NEW invoices only
--    (accept_offer); never retroactively touches an existing invoice.
-- 5. Admin-only mutations use the hardened pattern established in migration 84: explicit
--    `auth.uid() is null` guard, `is_admin()` check, security definer, search_path pinned, revoked
--    from public/anon, granted to authenticated.
--
-- Paid invoices are DELIBERATELY excluded from both admin_update_invoice and admin_void_invoice (only
-- 'pending' is editable/voidable through these actions) — a paid invoice represents money that has
-- already changed hands, so a real correction there is a refund/reversal process, not a silent edit.
-- FLAGGED, NOT BUILT: no such correction flow exists yet; if a paid invoice is ever wrong, that is a
-- decision for a human today (see the final report for this batch).
-- ============================================================================

-- ── 1. invoices: new financial/content columns ──────────────────────────────────────────────────

alter table invoices
  add column subtotal numeric(14,2),
  add column discount_amount numeric(14,2) not null default 0,
  add column discount_reason text,
  add column tax_lines jsonb not null default '[]'::jsonb,   -- [{label, rate, amount}], amount always server-computed
  add column tax_total numeric(14,2) not null default 0,
  add column description text,
  add column billing_reference text,
  add column notes text,
  add column payment_instructions text,
  add column revision_number integer not null default 1;

-- Backfill: every existing invoice's `amount` WAS the platform fee with no discount/tax, so subtotal =
-- amount reproduces today's invoices exactly (discount_amount/tax_total already default to 0). No other
-- new column needs backfilling — they're all nullable, optional, presentation-only fields; the PDF and
-- UI fall back to sensible defaults when they're null. Only the numeric fields that participate in the
-- total-recalculation invariant need a real backfilled value.
update invoices set subtotal = amount where subtotal is null;
alter table invoices alter column subtotal set not null;

alter table invoices
  add constraint invoices_subtotal_nonneg check (subtotal >= 0),
  add constraint invoices_discount_nonneg check (discount_amount >= 0),
  add constraint invoices_discount_le_subtotal check (discount_amount <= subtotal),
  add constraint invoices_tax_total_nonneg check (tax_total >= 0),
  add constraint invoices_revision_number_positive check (revision_number >= 1),
  -- The load-bearing constraint: the grand total can NEVER be anything other than
  -- subtotal - discount + tax, for any row, ever — regardless of which RPC wrote it or whether a
  -- future bug forgets to recompute it. This is the actual enforcement of "never trust the client".
  add constraint invoices_amount_matches_calc check (amount = round(subtotal - discount_amount + tax_total, 2));

comment on column invoices.subtotal is 'Base/subtotal amount before discount and tax. Historically equal to `amount`; now editable by admin (pending invoices only).';
comment on column invoices.discount_amount is 'Admin-applied discount, always >= 0 and <= subtotal. Zero on every invoice unless an admin edits it.';
comment on column invoices.tax_lines is 'Array of {label, rate, amount} — admin-configured label/rate, amount ALWAYS server-computed from (subtotal - discount) * rate/100. Never hardcodes any jurisdiction''s tax rules.';
comment on column invoices.revision_number is 'Starts at 1. Incremented by log_invoice_revision() on every mutating RPC (admin edit/void, lender update/cancel, mark-paid, and the automatic switch-supersession void).';

-- ── 2. invoice_revisions: append-only audit trail ───────────────────────────────────────────────

create table invoice_revisions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  revision_number integer not null check (revision_number >= 1),
  changed_by uuid not null references profiles(id),
  change_reason text,
  snapshot jsonb not null,   -- to_jsonb() of the FULL invoices row as it was BEFORE this change
  created_at timestamptz not null default now(),
  unique (invoice_id, revision_number)
);
create index invoice_revisions_invoice_idx on invoice_revisions (invoice_id, revision_number desc);

comment on table invoice_revisions is 'Append-only. A row is written by log_invoice_revision() immediately before every invoice mutation, holding a full snapshot of the PRE-change row. No update/delete policy exists for anyone, at any privilege level — this table cannot be edited after the fact, only added to.';

alter table invoice_revisions enable row level security;

drop policy if exists invoice_revisions_admin_read on invoice_revisions;
create policy invoice_revisions_admin_read on invoice_revisions for select using (is_admin());
-- No insert/update/delete policy for ANY role, admin included — every write goes through
-- log_invoice_revision() (security definer, revoked from public/anon/authenticated below), which
-- bypasses RLS as the function owner. A client can never insert, edit, or delete a revision row.

-- ── 3. invoice_settings: global defaults for NEW invoices (singleton, like penalty_settings) ────

create table invoice_settings (
  id smallint primary key default 1 check (id = 1),
  header_text text,
  default_description text,
  footer_text text,
  default_payment_instructions text,
  default_tax_lines jsonb not null default '[]'::jsonb,   -- [{label, rate}] — template only, no amount
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
insert into invoice_settings (id) values (1) on conflict (id) do nothing;

comment on table invoice_settings is 'Single-row global invoice defaults, applied to NEW invoices only (accept_offer). Editing this table never touches an existing invoice. Reads are admin-only (unlike penalty_settings, lenders have no reason to see it — they only ever see the resulting invoice fields).';

alter table invoice_settings enable row level security;

drop policy if exists invoice_settings_admin_read on invoice_settings;
create policy invoice_settings_admin_read on invoice_settings for select using (is_admin());
-- No write policy: all writes go through set_invoice_settings() (security definer, is_admin()-gated).

-- ── 4. Internal helpers (never directly callable by any client) ─────────────────────────────────

-- Snapshots `inv` (the invoice row as it stood immediately before the caller's mutation) as its OWN
-- revision_number, then returns revision_number + 1 for the caller to assign in the same UPDATE. One
-- function, one shape, called from every invoice-mutating RPC below — the single mechanism the whole
-- feature's audit trail depends on.
create or replace function log_invoice_revision(inv invoices, p_changed_by uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  insert into invoice_revisions (invoice_id, revision_number, changed_by, change_reason, snapshot)
  values (inv.id, inv.revision_number, p_changed_by, p_reason, to_jsonb(inv));
  return inv.revision_number + 1;
end $$;

-- Deliberately NOT granted to authenticated (unlike next_invoice_number() in migration 84) — a
-- composite `invoices` row parameter would let a client attempt to forge an arbitrary snapshot if this
-- were directly callable. Only ever invoked from within the other functions in this migration, all of
-- which already run as this same function owner.
revoke execute on function log_invoice_revision(invoices, uuid, text) from public, anon, authenticated;

-- Computes tax lines + their total from label/rate pairs against a taxable base. `p_rate_lines` needs
-- only {label, rate} per element — any extra keys (like a client-supplied "amount") are ignored, which
-- is exactly how "never trust a client-supplied total" is enforced for tax: the amount is ALWAYS
-- recomputed here, never accepted as input. Shared by admin_update_invoice, update_invoice (the
-- lender's own edit, re-applying the invoice's EXISTING rates against a new subtotal), accept_offer
-- (new-invoice creation from Invoice Settings' defaults), and set_invoice_settings (template validation).
create or replace function compute_tax_lines(p_taxable numeric, p_rate_lines jsonb)
returns table (tax_lines jsonb, tax_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_line jsonb; v_label text; v_rate numeric; v_amt numeric(14,2);
  v_out jsonb := '[]'::jsonb; v_total numeric(14,2) := 0;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_rate_lines, '[]'::jsonb))
  loop
    v_label := v_line->>'label';
    v_rate := nullif(v_line->>'rate', '')::numeric;
    if v_label is null or length(trim(v_label)) = 0 then
      raise exception 'each tax line needs a label';
    end if;
    if v_rate is null or v_rate < 0 then
      raise exception 'tax rate must be a non-negative number';
    end if;
    v_amt := round(greatest(p_taxable, 0) * v_rate / 100.0, 2);
    v_total := v_total + v_amt;
    v_out := v_out || jsonb_build_object('label', v_label, 'rate', v_rate, 'amount', v_amt);
  end loop;
  return query select v_out, v_total;
end $$;

-- Same reasoning as log_invoice_revision — no legitimate direct client call site.
revoke execute on function compute_tax_lines(numeric, jsonb) from public, anon, authenticated;

-- ── 5. Admin mutation RPCs (new) ─────────────────────────────────────────────────────────────────

-- Edits a PENDING invoice's financial/content fields. The grand total is ALWAYS recalculated here from
-- p_subtotal/p_discount_amount/the tax lines — the client can send whatever it wants for informational
-- display, but what gets stored is only ever this function's own arithmetic.
create or replace function admin_update_invoice(
  p_invoice_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric default 0,
  p_discount_reason text default null,
  p_tax_lines jsonb default '[]'::jsonb,
  p_description text default null,
  p_billing_reference text default null,
  p_notes text default null,
  p_payment_instructions text default null,
  p_due_date date default null,
  p_change_reason text default null
) returns invoices
language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype;
  v_tax_lines jsonb; v_tax_total numeric(14,2); v_grand_total numeric(14,2);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;

  select * into inv from invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.status <> 'pending' then
    raise exception 'only a pending invoice can be edited this way (this one is %)', inv.status;
  end if;

  if p_subtotal is null or p_subtotal < 0 then raise exception 'subtotal must be a non-negative number'; end if;
  if p_discount_amount is null or p_discount_amount < 0 then raise exception 'discount must be a non-negative number'; end if;
  if p_discount_amount > p_subtotal then raise exception 'discount cannot exceed the subtotal'; end if;

  select tax_lines, tax_total into v_tax_lines, v_tax_total
    from compute_tax_lines(p_subtotal - p_discount_amount, p_tax_lines);
  v_grand_total := round(p_subtotal - p_discount_amount + v_tax_total, 2);

  update invoices set
    subtotal = p_subtotal,
    discount_amount = p_discount_amount,
    discount_reason = p_discount_reason,
    tax_lines = v_tax_lines,
    tax_total = v_tax_total,
    amount = v_grand_total,
    description = p_description,
    billing_reference = p_billing_reference,
    notes = p_notes,
    payment_instructions = p_payment_instructions,
    due_date = coalesce(p_due_date, due_date),
    revision_number = log_invoice_revision(inv, auth.uid(), p_change_reason),
    pdf_path = null,
    updated_at = now()
  where id = p_invoice_id
  returning * into inv;

  return inv;
end $$;

revoke execute on function admin_update_invoice(uuid, numeric, numeric, text, jsonb, text, text, text, text, date, text) from public, anon;
grant execute on function admin_update_invoice(uuid, numeric, numeric, text, jsonb, text, text, text, text, date, text) to authenticated;

-- Voids a PENDING invoice — reuses the EXISTING 'voided' status from migration 85, no new status.
create or replace function admin_void_invoice(p_invoice_id uuid, p_reason text) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a void reason is required';
  end if;

  select * into inv from invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.status <> 'pending' then
    raise exception 'only a pending invoice can be voided this way (this one is %)', inv.status;
  end if;

  update invoices set
    status = 'voided',
    voided_at = now(),
    voided_by = auth.uid(),
    voided_reason = p_reason,
    revision_number = log_invoice_revision(inv, auth.uid(), p_reason),
    pdf_path = null
  where id = p_invoice_id
  returning * into inv;

  return inv;
end $$;

revoke execute on function admin_void_invoice(uuid, text) from public, anon;
grant execute on function admin_void_invoice(uuid, text) to authenticated;

-- Sets the global Invoice Settings row. Validates the default tax-line template through the same
-- compute_tax_lines() used everywhere else (taxable base of 1 is arbitrary — only the validation and
-- the label/rate shape matter here; the computed "amount" is discarded, only label+rate are stored as
-- the template for a future invoice to apply against ITS OWN subtotal).
create or replace function set_invoice_settings(
  p_header_text text,
  p_default_description text,
  p_footer_text text,
  p_default_payment_instructions text,
  p_default_tax_lines jsonb default '[]'::jsonb
) returns invoice_settings
language plpgsql security definer set search_path = public as $$
declare
  r invoice_settings%rowtype;
  v_validated jsonb;
  v_default_tax_lines jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;

  select tax_lines into v_validated from compute_tax_lines(1, coalesce(p_default_tax_lines, '[]'::jsonb));
  select coalesce(jsonb_agg(jsonb_build_object('label', elem->>'label', 'rate', (elem->>'rate')::numeric)), '[]'::jsonb)
    into v_default_tax_lines
    from jsonb_array_elements(v_validated) elem;

  update invoice_settings set
    header_text = p_header_text,
    default_description = p_default_description,
    footer_text = p_footer_text,
    default_payment_instructions = p_default_payment_instructions,
    default_tax_lines = v_default_tax_lines,
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into r;

  return r;
end $$;

revoke execute on function set_invoice_settings(text, text, text, text, jsonb) from public, anon;
grant execute on function set_invoice_settings(text, text, text, text, jsonb) to authenticated;

-- ── 6. Route the lender's own mutation RPCs through the SAME revision-logging mechanism ─────────
-- (client instruction: don't leave two inconsistent mutation paths.) Guards/ownership checks/ACL are
-- byte-for-byte unchanged from migration 84 — only the body's mutation itself changes, to snapshot
-- first and clear pdf_path, exactly like the admin RPCs above.

create or replace function mark_invoice_paid(p_invoice_id uuid) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;
  update invoices set
    status = 'paid',
    paid_at = now(),
    revision_number = log_invoice_revision(inv, auth.uid(), 'Marked paid'),
    pdf_path = null
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

revoke execute on function mark_invoice_paid(uuid) from public, anon;
grant execute on function mark_invoice_paid(uuid) to authenticated;

create or replace function cancel_invoice(p_invoice_id uuid, p_reason text) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;
  update invoices set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = p_reason,
    revision_number = log_invoice_revision(inv, auth.uid(), p_reason),
    pdf_path = null
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

revoke execute on function cancel_invoice(uuid, text) from public, anon;
grant execute on function cancel_invoice(uuid, text) to authenticated;

-- The lender's own edit recalculates subtotal from the (possibly new) loan amount/term, then RE-APPLIES
-- the invoice's EXISTING tax rates against the new taxable base — it does NOT discard an admin-applied
-- discount/tax just because the lender changed the loan amount. This also keeps the
-- invoices_amount_matches_calc CHECK satisfied after a lender edit, which is why it's mandatory, not a
-- nicety. If the existing discount would now exceed the recalculated subtotal, the edit is refused with
-- a clear message instead of failing on a cryptic constraint violation — that invoice needs an admin's
-- attention first.
create or replace function update_invoice(p_invoice_id uuid,
                                          p_product mortgage_product default null,
                                          p_closing date default null,
                                          p_loan_amount numeric default null) returns invoices
language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype; bps integer;
  v_tax_lines jsonb; v_tax_total numeric(14,2); v_grand_total numeric(14,2);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;

  inv.mortgage_product := coalesce(p_product, inv.mortgage_product);
  inv.closing_date := coalesce(p_closing, inv.closing_date);
  inv.loan_amount := coalesce(p_loan_amount, inv.loan_amount);
  bps := platform_bps_for(inv.mortgage_product);
  inv.subtotal := round(inv.loan_amount * bps / 10000.0, 2);

  if inv.discount_amount > inv.subtotal then
    raise exception 'the existing discount on this invoice would exceed the recalculated subtotal — ask an admin to review it before changing the loan amount';
  end if;

  select tax_lines, tax_total into v_tax_lines, v_tax_total
    from compute_tax_lines(inv.subtotal - inv.discount_amount, inv.tax_lines);
  v_grand_total := round(inv.subtotal - inv.discount_amount + v_tax_total, 2);

  update invoices set
    mortgage_product = inv.mortgage_product,
    term_years = product_years(inv.mortgage_product),
    closing_date = inv.closing_date,
    loan_amount = inv.loan_amount,
    platform_bps = bps,
    subtotal = inv.subtotal,
    tax_lines = v_tax_lines,
    tax_total = v_tax_total,
    amount = v_grand_total,
    due_date = inv.closing_date + 21,
    revision_number = log_invoice_revision(inv, auth.uid(), 'Lender self-service update'),
    pdf_path = null
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

revoke execute on function update_invoice(uuid, mortgage_product, date, numeric) from public, anon;
grant execute on function update_invoice(uuid, mortgage_product, date, numeric) to authenticated;

-- ── 7. accept_offer: initialize the new fields on every NEW invoice ─────────────────────────────
-- Built on top of migration 86's body — every existing line (auth guard, ownership check, prequal
-- guard, the atomic switch-retirement block, identity/broker lookups, notification) is unchanged. The
-- only additions: (a) the switch-retirement branch now snapshots the OLD invoice via
-- log_invoice_revision() and clears its pdf_path, exactly like every other mutation in this migration;
-- (b) new-invoice creation reads Invoice Settings' defaults and initializes subtotal/discount/tax/
-- description/payment_instructions/revision_number. With no Invoice Settings configured (the default,
-- untouched state), default_tax_lines is '[]' and default_description/default_payment_instructions are
-- null — so a fresh deployment's invoices are computed and shaped EXACTLY as before this migration.
create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
        v_prev_offer_id uuid; v_old_inv invoices%rowtype;
        settings invoice_settings%rowtype;
        v_subtotal numeric(14,2); v_tax_lines jsonb; v_tax_total numeric(14,2);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into o from offers where id = p_offer_id for update;
  if o.id is null then raise exception 'offer not found'; end if;
  select * into d from deals where id = o.deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if o.status <> 'pending' then raise exception 'offer is not pending'; end if;

  -- Round 3 Phase 3: the offer carries over, but the deal must be live first — the invoice needs a
  -- closing date (invoices.closing_date is NOT NULL, due_date = closing_date + 21).
  if coalesce(d.prequal, false) or d.closing_date is null then
    raise exception 'Move this prequal to a live deal (address + closing date) before accepting an offer.';
  end if;

  -- Capture BEFORE it gets overwritten below: if this deal already has an accepted offer, this
  -- acceptance is a Switch Lender replacement, not a first-time acceptance.
  v_prev_offer_id := d.accepted_offer_id;

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

  -- Retire the previously-accepted offer and void its invoice atomically, in the SAME transaction as
  -- this new acceptance. Excludes an already-paid invoice defensively (switch_offer's own guard already
  -- makes this unreachable in practice, but the check costs nothing and protects a real financial
  -- record either way). Snapshotted via log_invoice_revision() first (2026-09-04) so the automatic
  -- switch-void shows up in Revision History exactly like any other invoice mutation.
  if v_prev_offer_id is not null then
    update offers set status = 'switched' where id = v_prev_offer_id;

    select * into v_old_inv from invoices
     where deal_id = d.id and offer_id = v_prev_offer_id and status <> 'paid'
     for update;
    if v_old_inv.id is not null then
      update invoices set
        status = 'voided',
        voided_at = now(),
        voided_by = auth.uid(),
        voided_reason = 'Superseded by lender switch',
        revision_number = log_invoice_revision(v_old_inv, auth.uid(), 'Superseded by lender switch'),
        pdf_path = null
      where id = v_old_inv.id;
    end if;
  end if;

  -- one-step confirm: acceptance immediately reveals + invoices (no separate Confirm Lender)
  update deals set status = 'confirmed', accepted_offer_id = o.id, lender_confirmed = true
  where id = d.id;

  select * into ident from deal_identities where deal_id = d.id;
  select * into broker from profiles where id = d.broker_id;
  bps := effective_platform_bps(d.brokerage_id, o.mortgage_product);

  -- Name variance: surface the document name on the invoice (photo ID preferred) so the lender can
  -- reconcile. Only when a checked document flagged a preferred-name variance.
  select dd.extracted_name into v_doc_name
    from deal_documents dd
   where dd.deal_id = d.id and dd.name_variance is true and dd.extracted_name is not null
   order by (dd.kind = 'photo_id') desc, dd.checked_at desc nulls last
   limit 1;

  -- Admin Invoice Management (2026-09-04): initialize the new financial fields from Invoice Settings'
  -- configured defaults. With nothing configured (the default, untouched state) default_tax_lines is
  -- '[]' and the two default_* text fields are null, so this reproduces the pre-migration invoice
  -- exactly: subtotal = amount, discount = 0, tax = 0.
  select * into settings from invoice_settings where id = 1;
  v_subtotal := round(d.loan_amount * bps / 10000.0, 2);
  select tax_lines, tax_total into v_tax_lines, v_tax_total
    from compute_tax_lines(v_subtotal, coalesce(settings.default_tax_lines, '[]'::jsonb));

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        document_name, closing_date, due_date,
                        subtotal, discount_amount, tax_lines, tax_total,
                        description, payment_instructions, revision_number)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(v_subtotal + v_tax_total, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          v_doc_name,
          d.closing_date, d.closing_date + 21,
          v_subtotal, 0, v_tax_lines, v_tax_total,
          settings.default_description, settings.default_payment_instructions, 1)
  returning * into inv;

  perform notify(o.lender_id, 'offer_accepted',
                 format('Your offer for deal %s was accepted. Invoice %s has been generated.',
                        d.deal_number, inv.invoice_number),
                 d.id, o.id);

  select * into o from offers where id = p_offer_id;
  return o;
end $$;

revoke execute on function accept_offer(uuid) from public, anon;
grant execute on function accept_offer(uuid) to authenticated;
