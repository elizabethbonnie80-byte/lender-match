-- Fix a live bug found on staging while browser-testing the Round 4 broker enforcement feature: a
-- broker sending a phone number to a lender got a raw Postgres error —
--   insert or update on table "admin_alerts" violates foreign key constraint "admin_alerts_message_id_fkey"
-- — instead of the intended friendly "can't share contact info" warning. Also adds the post-acceptance
-- anti-contact exemption, confirmed missing entirely during the same investigation. Additive only —
-- migrations 80, 81 and 82 are untouched.
--
-- ============================================================================
-- ROOT CAUSE: a BEFORE INSERT trigger cannot durably record a row with an FK back to itself.
--
-- messages.id has `default gen_random_uuid()`, so inside a BEFORE INSERT trigger NEW.id already holds
-- a real UUID value — but the messages row itself has not been written to the table yet (that only
-- happens once every BEFORE trigger returns successfully). The migration-80 tg_scan_message() —
-- BEFORE INSERT OR UPDATE — unconditionally ran:
--   insert into admin_alerts (..., message_id) values (..., new.id) ...
-- and, for a broker sender:
--   insert into broker_contact_violations (..., message_id) values (..., new.id, ...)
-- Both admin_alerts.message_id and broker_contact_violations.message_id are NOT DEFERRABLE foreign
-- keys to messages(id), checked immediately on insert — at a point where no messages row with that id
-- exists yet. The FK violation aborts the whole transaction: no messages row, no admin_alerts row, no
-- broker_contact_violations row ever gets written, and send_deal_message()'s own `insert into messages
-- ... returning * into m` never completes, so its {blocked, reason} logic is never reached. The raw
-- Postgres error propagates through supabase-js's {data: null, error} return straight into the UI's
-- catch block (lib/queries/messages.ts throws `new Error(error.message)`), which is why the broker saw
-- a database error instead of the friendly warning.
--
-- FIX: split the single BEFORE trigger into two. The BEFORE trigger keeps ONLY the scan + NEW.is_invalid
-- assignment (no table writes at all). A new AFTER INSERT trigger does the durable admin_alerts /
-- broker_contact_violations / suspension bookkeeping, reading NEW.id — which by AFTER-trigger time
-- correctly refers to a row that has actually been written and is visible within the current
-- transaction, satisfying both foreign keys. This is the standard, textbook-safe Postgres pattern for
-- "validate/flag in BEFORE, record referentially-dependent side effects in AFTER" — it changes nothing
-- about WHAT the enforcement logic computes (the anchor/count/anti-overlap/suspension-creation queries
-- are unchanged, just relocated), and it preserves this trigger family's own stated design goal
-- (migration 12's header: "un-bypassable backstop", independent of send_deal_message() specifically —
-- there is no direct client INSERT policy on messages, confirmed by grep, so the trigger remains the
-- sole enforcement layer regardless of write path, exactly as before).
--
-- Repo-wide check (done before writing this migration, not assumed): the OTHER two anti-contact
-- triggers — tg_scan_offer_comments() on offers, tg_scan_deal_notes() on deals — use the original,
-- different architecture (RAISE and reject outright; admin_alerts is logged separately by the client's
-- own scan_and_log() pre-check, in ITS OWN transaction, before the write is even attempted). Neither has
-- ever attempted a self-referential insert from within a BEFORE trigger, so neither is affected by this
-- bug class, and this migration does not touch them.
-- ============================================================================

-- BEFORE INSERT OR UPDATE: scan + flag only. No table writes — this is the only change from migration
-- 80's version besides the new exemption check below.
create or replace function tg_scan_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first text;
  v_last text;
  v_reason text;
  v_exempt boolean;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;

  -- ==========================================================================================
  -- Post-acceptance exemption (added here, confirmed missing entirely in migration 80): once THIS
  -- chat's lender holds the deal's accepted offer and the deal has reached accepted/confirmed/funded,
  -- identities are already legitimately revealed elsewhere in the app via the EXACT SAME condition —
  -- accepted_lender_for_deal() (migration 07) and the identities_accepted_lender RLS policy (migration
  -- 15) both gate on `deals.accepted_offer_id` joined to `offers` plus `deals.status in ('accepted',
  -- 'confirmed', 'funded')`. Reusing that condition here means the anti-contact restriction lifts at
  -- precisely the same moment identities become visible elsewhere, not a separately-invented threshold.
  --
  -- Scoped to the SPECIFIC (deal, lender) pair via this message's own chat_id, not deal-wide: a deal can
  -- have multiple lender chats (one per bidder) but only one accepted offer, so a lender who did NOT get
  -- the accepted offer must remain fully restricted on their own thread even after another lender's
  -- offer is accepted on the same deal.
  -- ==========================================================================================
  select exists (
    select 1
    from deal_chats c
    join deals d on d.id = c.deal_id
    join offers o on o.id = d.accepted_offer_id
    where c.id = new.chat_id
      and o.lender_id = c.lender_id
      and d.status in ('accepted', 'confirmed', 'funded')
  ) into v_exempt;

  if v_exempt then
    new.is_invalid := false;
    return new;
  end if;

  select first_name, last_name into v_first, v_last from profiles where id = new.sender_id;
  v_reason := scan_contact_info(new.content, v_first, v_last);

  new.is_invalid := (v_reason is not null);
  return new;
end $$;

-- AFTER INSERT: durable recording only, for rows the BEFORE trigger already flagged. NEW.id is now a
-- real, committed row — both FKs below are satisfied. Anchor/count/anti-overlap/suspension-creation
-- logic is byte-for-byte identical to migration 80's version; only its trigger stage moved.
create or replace function tg_record_message_violation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_deal_id uuid;
  v_alert_id uuid;
  v_violation_count integer;
  v_active_auto boolean;
  v_last_auto_end timestamptz;
begin
  if not new.is_invalid then return new; end if;

  select deal_id into v_deal_id from deal_chats where id = new.chat_id;

  insert into admin_alerts (user_id, flagged_content, source, detection, deal_id, message_id)
  values (new.sender_id, new.content, 'chat_message', 'regex', v_deal_id, new.id)
  returning id into v_alert_id;

  if new.sender_role = 'broker' then
    insert into broker_contact_violations (broker_id, message_id, deal_id, alert_id)
    values (new.sender_id, new.id, v_deal_id, v_alert_id);

    select coalesce(ended_at, expires_at) into v_last_auto_end
    from broker_suspensions
    where broker_id = new.sender_id and is_automatic
    order by starts_at desc
    limit 1;

    select count(*) into v_violation_count
    from broker_contact_violations
    where broker_id = new.sender_id
      and created_at >= now() - interval '30 days'
      and (v_last_auto_end is null or created_at > v_last_auto_end);

    select exists (
      select 1 from broker_suspensions
      where broker_id = new.sender_id and is_automatic and expires_at > now() and ended_at is null
    ) into v_active_auto;

    if v_violation_count >= 3 and not v_active_auto then
      insert into broker_suspensions (broker_id, reason, is_automatic, starts_at, expires_at)
      values (
        new.sender_id,
        '3 contact-information violations within a rolling 30-day period (automatic).',
        true,
        now(),
        now() + interval '7 days'
      );
    end if;
  end if;

  return new;
end $$;

-- The existing `messages_anti_contact` (BEFORE) trigger from migration 12 already points at
-- tg_scan_message() by name, so `create or replace function` above is all it needs — no DROP/CREATE
-- TRIGGER required for it. Only the new AFTER trigger needs to be added.
create trigger messages_record_violation after insert on messages
for each row execute function tg_record_message_violation();

-- No revoke/grant needed for either function: both return `trigger` and cannot be invoked as an RPC
-- (same exemption already documented for job_cache_invalidate — see CLAUDE.md security invariant #6).
