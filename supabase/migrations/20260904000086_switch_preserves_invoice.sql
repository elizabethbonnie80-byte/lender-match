-- Step 2 of 2 for the Switch Lender invoice-preservation fix (approved 2026-09-04; migration 85 added
-- the `voided` status + voided_at/voided_reason/voided_by columns as a separate, Postgres-mandated
-- migration — see its header). This migration is everything that actually uses `status = 'voided'`:
-- the revised switch_offer()/accept_offer() logic, and the retention-job generalization.
--
-- Built on top of migration 84's hardened bodies, not migration 80's originals — migration 84 added the
-- `auth.uid() is null` guard + revoke/grant to both functions, and since this migration does another
-- `create or replace` on the same two functions, that guard is carried forward verbatim below so none of
-- the security hardening is lost.
--
-- ============================================================================
-- THE PROBLEM (found investigating an Admin Invoice Management feature, not yet built): switch_offer()
-- immediately deleted the invoice AND flipped the accepted offer to 'switched' the instant the broker
-- clicked Switch Lender — before any replacement was chosen. If the broker never accepted a replacement,
-- the original invoice was gone forever, and Lender A's own portal showed their offer as "Declined"
-- (the switched -> Declined UI mapping) immediately, even though nothing had actually replaced them yet.
--
-- THE FIX: switch_offer() now leaves Lender A's offer, deals.accepted_offer_id, and the existing invoice
-- completely untouched. It only reverts the deal to 'offer_received' (so the broker's own deal-detail UI
-- shows the reactivated offers to choose from — the frontend's accepted/offers-list split is driven by
-- deal.status, not by the offer's own status) and reactivates the offers that were auto-declined by the
-- original acceptance. accept_offer() is where the actual, atomic transition happens: when the broker
-- accepts a replacement, it captures the deal's PREVIOUS accepted_offer_id before overwriting it, and —
-- only when one existed — retires that old offer (-> 'switched') and voids its invoice in the SAME
-- transaction as creating the new offer's acceptance and invoice. Since a PL/pgSQL function body is one
-- transaction, this is atomic by construction: either the whole thing commits (old retired, new created)
-- or none of it does. If the broker never accepts a replacement, nothing about Lender A ever changes.
--
-- Lender A's invoice is VOIDED, not deleted — preserved for audit/accounting history per the approved
-- design, using the `voided` status + voided_at/voided_reason/voided_by columns migration 85 added.
-- ============================================================================

create or replace function switch_offer(p_deal_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; me profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into d from deals where id = p_deal_id for update;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.accepted_offer_id is null or d.status not in ('accepted', 'confirmed') then
    raise exception 'nothing to switch';
  end if;
  if exists (select 1 from invoices i where i.deal_id = d.id and i.status = 'paid') then
    raise exception 'the invoice for this deal has already been paid';
  end if;

  select * into me from profiles where id = auth.uid() for update;
  -- allow this trusted RPC to touch the guarded switch-counter fields (see profiles_privilege_guard)
  perform set_config('app.bypass_profile_guard', 'on', true);
  -- lazy monthly reset (belt & suspenders next to the cron job)
  if me.switch_month is distinct from date_trunc('month', now())::date then
    update profiles set offer_switches_this_month = 0,
                        switch_month = date_trunc('month', now())::date
    where id = me.id;
    me.offer_switches_this_month := 0;
  end if;
  if me.offer_switches_this_month >= 2 then
    raise exception 'You''ve used both switches this calendar month';
  end if;

  update profiles set offer_switches_this_month = offer_switches_this_month + 1 where id = me.id;

  -- Lender A's offer, deals.accepted_offer_id, and the existing invoice are DELIBERATELY left untouched
  -- here — see the migration header. Only the deal reverts (so the broker's UI shows the offers list)
  -- and the previously auto-declined offers come back to 'pending' so there's something to choose among.
  update offers set status = 'pending', decline_reason = null
   where deal_id = d.id and status = 'declined' and decline_reason = 'auto_on_accept';
  update deals set status = 'offer_received', lender_confirmed = false
  where id = d.id;

  -- Round 3: no lender notification on switch (the portal simply shows the offer as declined)
end $$;

revoke execute on function switch_offer(uuid) from public, anon;
grant execute on function switch_offer(uuid) to authenticated;

create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
        v_prev_offer_id uuid;
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
  -- record either way).
  if v_prev_offer_id is not null then
    update offers set status = 'switched' where id = v_prev_offer_id;
    update invoices set
      status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      voided_reason = 'Superseded by lender switch'
    where deal_id = d.id and offer_id = v_prev_offer_id and status <> 'paid';
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

  insert into invoices (invoice_number, deal_id, offer_id, lender_id, loan_amount, term_years,
                        mortgage_product, platform_bps, amount, broker_name, client_name,
                        document_name, closing_date, due_date)
  values (next_invoice_number(), d.id, o.id, o.lender_id, d.loan_amount,
          product_years(o.mortgage_product), o.mortgage_product, bps,
          round(d.loan_amount * bps / 10000.0, 2),
          broker.first_name || ' ' || broker.last_name,
          coalesce(ident.borrower_first_name || ' ' || ident.borrower_last_name, ''),  -- borrower, not lender (OQ#7)
          v_doc_name,
          d.closing_date, d.closing_date + 21)
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

-- ============================================================================
-- mark_invoice_paid, cancel_invoice, update_invoice: NOT modified by this migration — no change needed.
-- All three already guard `if inv.status <> 'pending' then raise exception 'invoice is not pending'`
-- (migration 02, guard preserved by migration 84's hardening), and 'voided' is never 'pending', so a
-- voided invoice is already correctly unmutable through any of them. Confirmed by re-reading their
-- current bodies before writing this migration, not assumed.
-- ============================================================================

-- ============================================================================
-- Retention: generalize the existing paid-invoice archive/purge pipeline to also cover voided invoices,
-- anchored on voided_at instead of paid_at, WITHOUT changing the existing paid-invoice behavior at all.
--
-- Approved design: voided and archived stay separate concepts. A voided invoice remains normally visible
-- for 1 year after voided_at (exactly like a paid one relative to paid_at), then archived, then retained
-- until 7 years after voided_at, then purge-eligible — mirroring the paid pipeline's shape exactly, just
-- anchored on a different timestamp column.
-- ============================================================================

-- The pre-existing paid branch (status = 'paid' and coalesce(paid_at, updated_at) < now() - 1 year) is
-- reproduced byte-for-byte below, OR'd with a new voided branch — this does not change what gets
-- archived for a paid invoice or when.
create or replace function job_archive_paid_invoices() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update invoices
     set archived_at = now(), updated_at = now()
   where archived_at is null
     and (
       (status = 'paid' and coalesce(paid_at, updated_at) < now() - interval '1 year')
       or
       (status = 'voided' and coalesce(voided_at, updated_at) < now() - interval '1 year')
     );
  get diagnostics n = row_count;
  return n;
end $$;

comment on function job_archive_paid_invoices() is
  'Monthly: archives paid invoices 1 year after paid_at (original A-25 rule, unchanged) AND voided invoices 1 year after voided_at (2026-09-04) — a flag only, the row stays in place and stays admin-readable. Name unchanged from the original to avoid touching its cron.schedule registration; it now covers both terminal states.';

-- Same generalization for the purge scan: paid invoices still key off paid_at exactly as before (voided_at
-- is null for a paid invoice, so coalesce falls through to the same value it always did); a voided
-- invoice (paid_at always null there) keys off voided_at instead.
create or replace function invoices_to_purge()
returns table (id uuid, pdf_path text)
language sql stable security definer set search_path = public as $$
  select i.id, i.pdf_path
    from invoices i
   where i.archived_at is not null
     and coalesce(i.paid_at, i.voided_at, i.updated_at) < now() - interval '7 years'
$$;

comment on function invoices_to_purge() is
  'Archived invoices past 7-year retention from the relevant event date — paid_at for a paid invoice (unchanged), voided_at for a voided one (2026-09-04) — for the purge-invoices edge function to delete (row + Storage PDF). Service-role only (see migration 60''s note on Security invariant #6); ACL unchanged by this migration.';

-- ACL unchanged: invoices_to_purge() was already revoke public/anon/authenticated + grant service_role
-- (migration 60). job_archive_paid_invoices() keeps whatever grant state it already had. The
-- purge-invoices edge function needs NO code change — it is already policy-free, deleting exactly
-- whatever invoices_to_purge() returns, regardless of why a row qualified.
