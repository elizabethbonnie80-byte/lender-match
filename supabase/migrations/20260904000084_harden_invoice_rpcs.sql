-- Fix a pre-existing authentication vulnerability found while investigating a new Admin Invoice
-- Management feature (not yet built): mark_invoice_paid, cancel_invoice, update_invoice, switch_offer,
-- and accept_offer all share the same NULL-bypass bug already fixed elsewhere this session (submit_deal,
-- convert_prequal_to_live) — `x <> auth.uid()` evaluates to NULL, not TRUE, for an anonymous caller, and
-- PL/pgSQL treats a NULL IF condition as false, so the ownership RAISE never fires. None of the five has
-- ever been revoked from the default PUBLIC/anon EXECUTE grant either (confirmed by grepping every
-- `revoke execute` statement in the repo's history — none of them appear). An anonymous caller holding
-- only the public anon key, with no session at all, could today: mark any invoice paid, cancel it,
-- rewrite its loan amount/term/closing date (and therefore its billed fee), delete an accepted deal's
-- invoice and revert the offer via switch_offer, or force-accept a pending offer on a broker's behalf via
-- accept_offer — the function that creates the invoice and reveals identities in the first place.
--
-- Also hardens next_invoice_number() as a lower-severity hygiene item: it has no ownership concept (a
-- shared daily sequence, not tied to any user's data) so it needs no auth.uid() guard, but it has also
-- never been revoked from public/anon. Confirmed by grep that it is ONLY ever called internally from
-- inside accept_offer() (never from any client code) — revoking it from public/anon and granting only to
-- authenticated does not affect that internal call, since accept_offer() already runs as its own
-- SECURITY DEFINER owner, which always retains access regardless of GRANT/REVOKE state.
--
-- Fix, for the 5 vulnerable functions: add `if auth.uid() is null then raise exception 'not
-- authenticated'; end if;` as literally the first statement, before any table access — the exact pattern
-- already applied today to submit_deal and convert_prequal_to_live. Every other line of business logic,
-- every existing ownership/admin check, and every status/state check is byte-for-byte unchanged; verified
-- by direct comparison against the current live bodies before writing this migration. Confirmed
-- separately (by tracing the logic for two real authenticated users) that the existing
-- `inv.lender_id <> auth.uid()` / `d.broker_id <> auth.uid()` ownership checks already correctly reject a
-- genuine cross-lender/cross-broker caller — that part of the design is sound and untouched; the gap is
-- specifically and only the anonymous-caller case.
--
-- Confirmed NOT affected, checked in the same investigation: confirm_lender() had the identical bug but
-- was already DROP FUNCTION'd in migration 42 when one-step-accept replaced it — it no longer exists.
-- admin_analytics() gates with `is_admin()`, which is EXISTS()-based and returns a concrete false (never
-- NULL) for an anonymous caller — already NULL-safe, no fix needed. invoices_to_purge() and
-- job_archive_paid_invoices() are already correctly revoked from public/anon/authenticated (migrations 60
-- and 62) — unaffected.

-- ============================================================================
-- mark_invoice_paid, cancel_invoice, update_invoice: add the guard, then lock down the ACL. Bodies are
-- otherwise byte-for-byte identical to their current live versions (migration 02).
-- ============================================================================

create or replace function mark_invoice_paid(p_invoice_id uuid) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;
  update invoices set status = 'paid', paid_at = now() where id = p_invoice_id
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
  update invoices set status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

revoke execute on function cancel_invoice(uuid, text) from public, anon;
grant execute on function cancel_invoice(uuid, text) to authenticated;

create or replace function update_invoice(p_invoice_id uuid,
                                          p_product mortgage_product default null,
                                          p_closing date default null,
                                          p_loan_amount numeric default null) returns invoices
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype; bps integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into inv from invoices where id = p_invoice_id for update;
  if inv.lender_id <> auth.uid() and not is_admin() then raise exception 'not your invoice'; end if;
  if inv.status <> 'pending' then raise exception 'invoice is not pending'; end if;

  inv.mortgage_product := coalesce(p_product, inv.mortgage_product);
  inv.closing_date := coalesce(p_closing, inv.closing_date);
  inv.loan_amount := coalesce(p_loan_amount, inv.loan_amount);
  bps := platform_bps_for(inv.mortgage_product);

  update invoices set
    mortgage_product = inv.mortgage_product,
    term_years = product_years(inv.mortgage_product),
    closing_date = inv.closing_date,
    loan_amount = inv.loan_amount,
    platform_bps = bps,
    amount = round(inv.loan_amount * bps / 10000.0, 2),
    due_date = inv.closing_date + 21,
    pdf_path = null              -- regenerate via edge function
  where id = p_invoice_id
  returning * into inv;
  return inv;
end $$;

revoke execute on function update_invoice(uuid, mortgage_product, date, numeric) from public, anon;
grant execute on function update_invoice(uuid, mortgage_product, date, numeric) to authenticated;

-- ============================================================================
-- switch_offer: same fix. Body otherwise byte-for-byte identical to its current live version
-- (migration 42). No is_admin() fallback exists here today — this migration does not add one; only the
-- broker who owns the deal can switch, exactly as before.
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

  -- the invoice created on acceptance is deleted outright (client: gone from the invoices page)
  delete from invoices where deal_id = d.id and offer_id = d.accepted_offer_id;

  update offers set status = 'switched' where id = d.accepted_offer_id;
  update offers set status = 'pending', decline_reason = null
   where deal_id = d.id and status = 'declined' and decline_reason = 'auto_on_accept';
  update deals set status = 'offer_received', accepted_offer_id = null, lender_confirmed = false
  where id = d.id;

  -- Round 3: no lender notification on switch (the portal simply shows the offer as declined)
end $$;

revoke execute on function switch_offer(uuid) from public, anon;
grant execute on function switch_offer(uuid) to authenticated;

-- ============================================================================
-- accept_offer: same fix. Body otherwise byte-for-byte identical to its current live version
-- (migration 76). No is_admin() fallback exists here today either — this migration does not add one.
-- Was already `grant`ed to authenticated (migrations 42 and 46), but a grant never removes the default
-- PUBLIC grant a new function gets — it has never actually been revoked from public/anon until now.
-- ============================================================================

create or replace function accept_offer(p_offer_id uuid) returns offers
language plpgsql security definer set search_path = public as $$
declare o offers%rowtype; d deals%rowtype; ident deal_identities%rowtype;
        broker profiles%rowtype; bps integer; inv invoices%rowtype; v_doc_name text;
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

  update offers set status = 'accepted' where id = o.id;
  update offers set status = 'declined', decline_reason = 'auto_on_accept'
   where deal_id = d.id and id <> o.id and status = 'pending';

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
-- next_invoice_number(): lower-severity hygiene item. No ownership concept, so no auth.uid() guard is
-- added — this is grant/revoke hardening only, no body change (no `create or replace` needed at all).
-- Confirmed by grep it is only ever called internally from within accept_offer(), never from any client
-- code, so this cannot break the existing application flow.
-- ============================================================================

revoke execute on function next_invoice_number() from public, anon;
grant execute on function next_invoice_number() to authenticated;
