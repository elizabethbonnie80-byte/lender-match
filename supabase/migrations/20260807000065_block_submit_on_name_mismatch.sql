-- Client 2026-08-07 (H-1): a document whose name does not match the Primary Borrower now BLOCKS the
-- submission. It used to be advisory only.
--
-- The client tested by uploading random images to both slots and was still able to create the deal.
-- That was by design: Round 3 Phase 3 item 2 specced the AI name-match as "advisory, fail-open, never
-- blocks submit" (see migration 46's header). She now wants the broker stopped until the documents are
-- correct, so the rule changes here — in the DB, not just the wizard, because the wizard is not an
-- enforcement point.
--
-- Three states, three different answers, and the distinction is load-bearing:
--
--   name_matches = false  → BLOCK. The AI read a name and it is a different person.
--   name_matches = true
--     + name_variance     → ALLOW. Same person, preferred-name variance (Mary/Maria, Bob/Robert). This
--                           is the client's OWN rule from migration 46: the variance never blocks, and
--                           at acceptance BOTH names print on the invoice so the lender can reconcile.
--                           Do not fold this into the block.
--   name_matches IS NULL  → ALLOW. The document was never checked: no ANTHROPIC_API_KEY, Claude errored,
--                           or the check has not returned yet. The edge function is deliberately
--                           fail-open, and blocking on NULL would mean an Anthropic outage halts EVERY
--                           deal submission on the platform — a far larger failure than the one being
--                           fixed. It would also break every smoke, since attachDealDocuments() inserts
--                           unchecked rows.
--
-- ⚠️ The NULL case is what leaves a residual race (upload, submit before the check lands). That is
-- closed on the CLIENT side instead: handleSubmit resolves any pending check before calling this RPC.
-- So NULL here means "the AI is genuinely unavailable", not "the broker was fast". Keep both halves.
--
-- `is false` and not `= false` / `not name_matches`: the latter two are NULL for an unchecked row, which
-- inside a WHERE reads as no-match by luck rather than by intent. Be explicit.

create or replace function submit_deal(p_deal_id uuid) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; v_kind text;
begin
  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.status <> 'draft' then raise exception 'deal already submitted'; end if;

  -- Round 3 Phase 3: both the consent form and photo ID must be uploaded before submitting.
  if (select count(distinct kind) from deal_documents
       where deal_id = p_deal_id and kind in ('consent', 'photo_id')) < 2 then
    raise exception 'Both the consent form and photo ID must be uploaded before submitting.';
  end if;

  -- Client 2026-08-07 (H-1): a checked document that is a different person blocks the submission.
  -- Named in the message so the broker knows which of the two to replace.
  select kind into v_kind from deal_documents
   where deal_id = p_deal_id and name_matches is false
   order by (kind = 'photo_id') desc
   limit 1;
  if v_kind is not null then
    raise exception
      'The name on the uploaded % does not match the primary borrower. Replace it before submitting.',
      case v_kind when 'photo_id' then 'photo ID' else 'consent form' end;
  end if;

  -- Round 3 Phase 3 (OQ#41 / client feedback #7): a deal with no property address is only valid as
  -- a prequal — the broker adds the address later via convert_prequal_to_live().
  if not coalesce(d.prequal, false)
     and coalesce(btrim((select property_address from deal_identities where deal_id = p_deal_id)), '') = '' then
    raise exception 'Add a property address, or mark the deal as a prequal.';
  end if;

  update deals set
    status = 'submitted',
    deal_number = next_deal_number(),
    submitted_at = now()
  where id = p_deal_id
  returning * into d;

  -- Round 3 Phase 3: standing auto-offers fire here, before anyone sees the deal.
  perform send_auto_offers(d.id);

  -- filter-match notifications: once per matching saved filter (fixes OQ#44 duplicates), skipping
  -- lenders whose auto-offer already landed on this deal.
  perform notify(sf.lender_id, 'filter_match',
                 format('Deal %s matches your saved filter "%s"', d.deal_number, sf.name),
                 d.id)
  from saved_filters sf
  where saved_filter_matches(sf, d)
    and sf.lender_id not in (select lender_id from lender_blocked_brokerages where brokerage_id = d.brokerage_id)
    and not exists (select 1 from offers o where o.deal_id = d.id and o.lender_id = sf.lender_id);

  -- re-read: send_auto_offers may have moved the deal to 'offer_received'
  select * into d from deals where id = p_deal_id;
  return d;
end $$;

grant execute on function submit_deal(uuid) to authenticated;
