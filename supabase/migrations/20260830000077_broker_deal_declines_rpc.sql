-- Broker "View lender declines" (Round 4, approved 2026-08-30).
--
-- Broker Deal Room / Deal Detail want to show which lender institutions actively declined a deal —
-- but ONLY once the deal has reached the 2-day maturing threshold AND currently has zero pending
-- offers, and only distinct INSTITUTION names, never a lender user's identity. `deal_declines` has
-- exactly one RLS policy today (`declines_owner`, migration 03) — a lender can read only their own
-- decline row; a broker has no read path to this table at all. Rather than add a broker-facing RLS
-- policy that would have to re-express the age/pending-offer conditions as a `USING` clause (fragile,
-- hard to audit, and would need to reference `deals`/`offers` from inside a `deal_declines` policy),
-- this follows the SAME pattern already used for every other multi-condition gate in this codebase
-- (accept_offer, send_auto_offers, withdraw_offer): a SECURITY DEFINER RPC that re-verifies every
-- condition itself, from the deal's own row, regardless of what the client claims. A broker cannot
-- retrieve institution names early by manipulating the frontend — the gate lives here, not in the UI.
--
-- "Zero pending offers" here means `offers.status = 'pending'` specifically (Round 4 approved
-- definition B) — NOT deals.status (which flips to 'offer_received' permanently on the first offer
-- and never reverts, including after a withdrawal) and NOT a raw count(*) of the offers table (which
-- still includes withdrawn rows, since withdrawal is a retained status, not a delete since migration
-- 74/75). A deal whose only offer was later withdrawn is eligible again once it re-crosses the age
-- threshold with nothing currently pending.
--
-- No RLS change, no schema change — `deal_declines`, `offers`, `deals`, `profiles`, and
-- `lender_institutions` already have everything this needs.

create or replace function broker_deal_declines(p_deal_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  d deals%rowtype;
  v_pending_count integer;
begin
  -- Anon guard: migration 06_grants.sql's `alter default privileges ... grant execute on functions
  -- to anon` means every new function is anon-callable unless explicitly revoked (see the revoke
  -- below). Without this explicit null check, an anonymous auth.uid() makes
  -- `d.broker_id <> auth.uid()` evaluate to NULL, and a NULL IF-condition is treated as false in
  -- PL/pgSQL — silently skipping the ownership check below. This makes the failure explicit and
  -- keeps it correct even if the grant is ever loosened again.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into d from deals where id = p_deal_id;
  if d.id is null then raise exception 'deal not found'; end if;

  -- Authorization: the deal's own broker, or a broker-admin within the same brokerage — same
  -- authorization shape as identities_brokerage_admin / profiles_brokerage_admin_read.
  if d.broker_id <> auth.uid() and not (i_am_broker_admin() and d.brokerage_id = my_brokerage()) then
    raise exception 'not your deal';
  end if;

  -- Age gate: the SAME 2-day boundary the lender-side Maturing Deals feed uses off deals.created_at
  -- (maturing_deals_for_lender). Not yet matured — nothing to return, not an error (a broker's UI
  -- could legitimately race a deal crossing this boundary; fail closed, not loudly).
  if d.created_at > now() - interval '2 days' then
    return array[]::text[];
  end if;

  -- Zero-pending-offers gate (Round 4 definition B — see header).
  select count(*) into v_pending_count from offers where deal_id = p_deal_id and status = 'pending';
  if v_pending_count > 0 then
    return array[]::text[];
  end if;

  -- Distinct declining INSTITUTION names only — never a lender user's name, never a non-responding
  -- lender, never a lender who was simply ineligible for the deal. Two users at the same institution
  -- collapse to one entry via `distinct`.
  return array(
    select distinct li.name
    from deal_declines dd
    join profiles p on p.id = dd.lender_id
    join lender_institutions li on li.id = p.lender_institution_id
    where dd.deal_id = p_deal_id
    order by li.name
  );
end $$;

grant execute on function broker_deal_declines(uuid) to authenticated;
revoke execute on function broker_deal_declines(uuid) from anon;
