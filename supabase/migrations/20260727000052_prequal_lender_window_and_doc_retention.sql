-- Client answers (2026-07-27, Bonnie) to the two open Round 3 Phase 3 questions.
--
-- Q2 — "Prequals should expire for the lenders but not for the brokers... They should only spend 15
-- days on the lender queues but the file should stay active for the broker until they delete it.
-- However, for the documents they've uploaded (the PDF's), those should be deleted 120 days after
-- they've been uploaded. So max of 240 - to ensure we don't have documents sitting around for years
-- if a broker doesn't clean up their account."
--
-- Two independent changes fall out of that:
--
--   A) A prequal's LENDER window is 15 days, but its BROKER lifetime is unbounded. So a prequal must
--      never reach status 'expired' (that is the broker-visible state, and it would also let
--      job_archive_expired_deals bury it 30 days later). Instead the 15-day cutoff becomes a
--      VISIBILITY rule inside lender_can_see_deal — which covers the feeds, the make_offer guard and
--      chat in one place, exactly like the "no marketplace re-entry" clause of migration 48.
--      Computing it from created_at (rather than from a cron-set flag) means the window closes on
--      time even if the cron never runs; the new deals.prequal_lender_notice_at column is ONLY the
--      "we already told the broker" marker, never the source of truth for visibility.
--      Lenders that already offered keep access (i_offered_on) — their offer is still live in
--      Submitted Offers and stays acceptable once the broker moves the deal to a live deal.
--
--   B) Document retention can no longer key off closing_date alone. A prequal has no closing date, so
--      `deals.closing_date < cutoff` never matched it and its PDFs would have been kept forever —
--      the exact "documents sitting around for years" case. The rule is now three-legged, expressed
--      once in documents_to_purge() so the edge function has no policy of its own:
--        * closing date set  → 120 days after the closing date (unchanged, the original rule)
--        * no closing date   → 120 days after upload (the client's new sentence)
--        * either way        → a hard ceiling of 240 days after upload ("max of 240")
--      The ceiling matters because closing_date is broker-entered and can be arbitrarily far out.
--
-- 15 days is the same boundary as job_expire_old_deals and the Maturing feed window (migration 37) —
-- see lib/age-windows.ts for the UI copy of the list windows.

-- ============================================================================
-- A1. Notice marker (NOT a visibility flag — see the header)
-- ============================================================================

alter table deals add column prequal_lender_notice_at timestamptz;

comment on column deals.prequal_lender_notice_at is
  'When the broker was told this prequal finished its 15 days on the lender queues. Idempotency marker for job_expire_old_deals only — lender visibility is computed from created_at in lender_can_see_deal, so it closes on time even if the cron never runs.';

-- ============================================================================
-- A2. Lender visibility: a prequal leaves the lender queues after 15 days.
--     Recreates migration 48's body + the new clause.
-- ============================================================================

create or replace function lender_can_see_deal(d deals) returns boolean
language sql stable security definer set search_path = public as $$
  select i_am_approved_lender()
    and d.status in ('submitted', 'offer_received')
    and not d.archived
    and not exists (select 1 from deal_declines dd
                    where dd.deal_id = d.id and dd.lender_id = auth.uid())
    and not exists (select 1 from lender_blocked_brokerages lb
                    where lb.lender_id = auth.uid() and lb.brokerage_id = d.brokerage_id)
    and not exists (select 1 from broker_blocked_institutions bb
                    where bb.broker_id = d.broker_id
                      and bb.institution_id = my_institution())
    -- Round 3 Phase 3: a converted prequal does not re-enter the marketplace
    and (d.prequal_converted_at is null or i_offered_on(d.id))
    -- Client 2026-07-27: an unconverted prequal spends only 15 days on the lender queues. It stays
    -- 'submitted' (active for the broker) forever, so this is the only thing that retires it from the
    -- lender side. Lenders holding an offer keep access — their bid carries over to the live deal.
    and (not coalesce(d.prequal, false)
         or d.created_at > now() - interval '15 days'
         or i_offered_on(d.id))
    -- OQ#25 rating-penalty effect: a penalized lender cannot see near-closing / near-COF deals they
    -- have not already offered on. Windows are admin-configurable via penalty_settings.
    and not (
      i_am_penalized_lender()
      and not i_offered_on(d.id)
      and (
        (d.closing_date is not null
           and d.closing_date < current_date + (select near_closing_days from penalty_settings where id = 1))
        or (d.cof_date is not null
           and d.cof_date < current_date + (select near_cof_days from penalty_settings where id = 1))
      )
    )
$$;

-- ============================================================================
-- A3. The expiry job: prequals are exempt from the status flip, and the broker is told once that
--     the lender window closed (a deal silently vanishing from every lender queue while the Deal
--     Room still shows "Submitted" is the confusing case this avoids).
--     Recreates migration 04's body + both changes.
-- ============================================================================

create or replace function job_expire_old_deals() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with expired as (
    update deals d
       set status = 'expired', expired_at = now()
     where d.status = 'submitted'
       -- Client 2026-07-27: a prequal stays active for the broker until they delete it. It only
       -- leaves the LENDER queues, which lender_can_see_deal does off created_at.
       and not coalesce(d.prequal, false)
       and d.created_at < now() - interval '15 days'
    returning d.id, d.broker_id, d.deal_number
  )
  insert into notifications (recipient_id, type, body, deal_id)
  select e.broker_id, 'deal_expired',
         format('Your deal %s has expired after 15 days without an offer.', e.deal_number), e.id
  from expired e
  join profiles p on p.id = e.broker_id
  where p.notify_deal_expiring and p.notify_inapp_enabled;
  get diagnostics n = row_count;

  -- Prequals: one-shot notice that the lender window closed. The file itself stays put.
  with closed as (
    update deals d
       set prequal_lender_notice_at = now()
     where coalesce(d.prequal, false)
       and d.prequal_converted_at is null
       and d.prequal_lender_notice_at is null
       and d.status in ('submitted', 'offer_received')
       and d.created_at < now() - interval '15 days'
    returning d.id, d.broker_id, d.deal_number
  )
  insert into notifications (recipient_id, type, body, deal_id)
  select c.broker_id, 'deal_expired',
         format('Pre-qualification %s has finished its 15 days on the lender queues. It stays in your Deal Room until you delete it — move it to a live deal to keep working it.',
                c.deal_number), c.id
  from closed c
  join profiles p on p.id = c.broker_id
  where p.notify_deal_expiring and p.notify_inapp_enabled;

  return n;
end $$;

-- ============================================================================
-- B. Document retention: three-legged rule, in SQL so the edge function carries no policy.
-- ============================================================================

create or replace function documents_to_purge()
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  select dd.id, dd.storage_path
    from deal_documents dd
    join deals d on d.id = dd.deal_id
   where
     -- hard ceiling: never keep a document more than 240 days after upload, whatever the deal says
     dd.created_at < now() - interval '240 days'
     -- live deal: 120 days after the closing date (the original Phase 3 rule)
     or (d.closing_date is not null and d.closing_date < current_date - 120)
     -- no closing date yet (prequal, or never converted): 120 days after upload
     or (d.closing_date is null and dd.created_at < now() - interval '120 days')
$$;

-- SECURITY DEFINER over every deal's documents, so it must not be reachable with a user token — it
-- would leak storage paths across every brokerage. Cron/edge only.
-- ⚠️ `from public` is the load-bearing part: Postgres grants EXECUTE to PUBLIC on every new function,
-- so revoking from anon/authenticated alone leaves the function wide open (they inherit via PUBLIC).
-- Verified by smoke-prequal, which asserts a broker and a lender both get "permission denied".
revoke execute on function documents_to_purge() from public, anon, authenticated;
grant execute on function documents_to_purge() to service_role;

comment on function documents_to_purge() is
  'Deal documents whose retention has lapsed: 120 days after closing_date, or 120 days after upload when there is no closing date (prequal), with a hard 240-day-after-upload ceiling. Called by the purge-documents edge function (cron job purge_expired_documents). service_role only — it spans every brokerage.';

comment on table deal_documents is
  'Round 3 Phase 3: broker-uploaded consent form + photo ID per deal (private deal-documents bucket). Read: owner/admin/brokerage-admin only — never lenders. Retention: see documents_to_purge().';
