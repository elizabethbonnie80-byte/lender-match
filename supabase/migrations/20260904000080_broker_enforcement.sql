-- Round 4 — Admin user management + broker enforcement (approved 2026-09-04): manual + automatic
-- broker suspension from submitting NEW deals, a durable contact-info violation counter driving the
-- automatic suspension, and admin soft-delete (Auth-ban, never physical deletion). Additive only —
-- migrations 77-79 are untouched. Also closes two pre-existing anonymous-caller auth gaps found while
-- building this (submit_deal, section 4; convert_prequal_to_live, section 10) and hardens
-- send_deal_message's ACL after its drop+recreate (section 6).
--
-- ============================================================================
-- 1. profiles: soft-delete metadata. Never physically deleted, never anonymized — deals/offers/
--    invoices/messages/audit history all stay exactly as they are; only login is cut off (via the new
--    delete-broker edge function's Auth ban, not anything here) and the account is flagged for the
--    admin UI. Added to protect_privileged_profile_fields()'s deny-list below so a broker can't clear
--    their own is_deleted flag (the same bug class documented for is_broker_admin etc.).
-- ============================================================================

alter table profiles
  add column is_deleted boolean not null default false,
  add column deleted_at timestamptz,
  add column deleted_by uuid references profiles(id),
  add column deletion_reason text;

create or replace function protect_privileged_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() or auth.uid() is null then  -- admin or service role
    return new;
  end if;
  if current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_approved is distinct from old.is_approved
     or new.pending_approval is distinct from old.pending_approval
     or new.rejected is distinct from old.rejected
     or new.is_broker_admin is distinct from old.is_broker_admin
     or new.penalty_active is distinct from old.penalty_active
     or new.offer_switches_this_month is distinct from old.offer_switches_this_month
     or new.switch_month is distinct from old.switch_month
     or new.brokerage_id is distinct from old.brokerage_id
     or new.lender_institution_id is distinct from old.lender_institution_id
     or new.is_deleted is distinct from old.is_deleted
     or new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by
     or new.deletion_reason is distinct from old.deletion_reason then
    raise exception 'privileged profile fields can only be changed by an admin';
  end if;
  return new;
end $$;

-- ============================================================================
-- 2. broker_suspensions — durable history, not a flag. "Currently suspended" is DERIVED (any row
--    with expires_at > now() and ended_at is null) rather than stored, so manual and automatic
--    suspensions coexist naturally and neither ever overwrites the other — approved design. is_admin()
--    -only RLS; the only writes are admin_suspend_broker()/admin_end_suspension() below and the
--    automatic-suspension branch inside tg_scan_message() — no INSERT/UPDATE policy for anyone.
-- ============================================================================

create table broker_suspensions (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references profiles(id),
  reason text not null,
  is_automatic boolean not null default false,
  created_by uuid references profiles(id),   -- null for automatic
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,                      -- set only if an admin manually lifted it early
  ended_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table broker_suspensions enable row level security;

create policy broker_suspensions_admin_read on broker_suspensions for select to authenticated
  using (is_admin());

create index broker_suspensions_broker_idx on broker_suspensions (broker_id, expires_at);

-- Self-referential only (auth.uid(), no parameter) — deliberately NOT `is_broker_suspended(p_broker_id)`,
-- which would repeat the exact caller-supplied-identity pattern already flagged as a live, unfixed
-- issue on best_match_for() (see CLAUDE.md security invariants). submit_deal() already establishes
-- d.broker_id = auth.uid() before calling this, so "the acting broker's own status" is always correct.
create or replace function is_currently_suspended() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from broker_suspensions
    where broker_id = auth.uid() and expires_at > now() and ended_at is null
  )
$$;

-- Defense-in-depth for Delete Account's residual-session window (approved plan: "a currently-valid
-- JWT cannot be used to continue meaningful activity"). The PRIMARY lock is the Auth ban + session
-- revocation in the delete-broker edge function; this is the backstop for the brief window between
-- an admin clicking Delete and that ban/revoke actually taking effect on an already-open session.
create or replace function is_currently_deleted() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_deleted from profiles where id = auth.uid()), false)
$$;

-- ============================================================================
-- 3. broker_contact_violations — one row per blocked chat message from a BROKER (never a lender; see
--    tg_scan_message() below). Links to the admin_alerts row (which already stores the flagged text)
--    and the message/deal for context, rather than duplicating the content. Same admin-only RLS shape.
-- ============================================================================

create table broker_contact_violations (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references profiles(id),
  message_id uuid references messages(id) on delete cascade,
  deal_id uuid references deals(id),
  alert_id uuid references admin_alerts(id),
  created_at timestamptz not null default now()
);

alter table broker_contact_violations enable row level security;

create policy broker_contact_violations_admin_read on broker_contact_violations for select to authenticated
  using (is_admin());

create index broker_contact_violations_broker_idx on broker_contact_violations (broker_id, created_at);

-- ============================================================================
-- 4. submit_deal() — three additional gates, same shape as every other check already in this function
--    (H-1's name-mismatch gate, the prequal-address gate).
--
--    auth.uid() is null guard (fixed on review, 2026-09-04): this function has NEVER had one, since
--    its very first version (migration 20260705000002). Its ownership check —
--    `if d.broker_id <> auth.uid() then raise exception 'not your deal'` — silently no-ops for an
--    anonymous caller: auth.uid() is NULL, `<>` against NULL is NULL, and PL/pgSQL treats a NULL IF
--    condition as false, so the raise never fires. Combined with the default PUBLIC/anon EXECUTE grant
--    every new Postgres function gets (this one was also never explicitly revoked from anon), this
--    meant anyone holding only the public anon key — no login at all — could submit ANY broker's draft
--    deal by guessing/knowing its UUID. Same bug class already found and fixed on broker_deal_declines
--    (migration 77) and block_lender_institution (migration 78); flagged during this round's review as
--    a separate, pre-existing issue orthogonal to the suspension/deletion work, and fixed here since it
--    was found in the course of adding related checks to this exact function.
--
--    Suspension: blocks only a NEW submission (draft -> submitted). Drafts stay fully editable/
--    creatable while suspended; an already-submitted deal is untouched; convert_prequal_to_live() is
--    deliberately NOT modified — it only ever applies to a deal that was submitted before any
--    suspension existed. Scoped to my_role() = 'broker' so an admin acting under the hidden Platform
--    Administration brokerage (migration 28) is never affected by a broker-only enforcement mechanism.
--
--    is_currently_deleted(): checked first, unconditionally (not role-scoped) — the defense-in-depth
--    half of Delete Account. See the function's own comment above.
-- ============================================================================

create or replace function submit_deal(p_deal_id uuid) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype; v_kind text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() then raise exception 'not your deal'; end if;
  if d.status <> 'draft' then raise exception 'deal already submitted'; end if;

  if is_currently_deleted() then
    raise exception 'This account has been deleted.';
  end if;

  if my_role() = 'broker' and is_currently_suspended() then
    raise exception 'Your account is currently suspended from submitting new deals.';
  end if;

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

-- Defense-in-depth pairing with the new auth.uid() null guard above, matching the same pattern used
-- for broker_deal_declines (migration 77) and block_lender_institution (migration 78): the internal
-- guard alone already closes the vulnerability, but explicitly revoking the default PUBLIC/anon grant
-- too means the fix doesn't depend solely on that one IF statement never being touched again.
revoke execute on function submit_deal(uuid) from public, anon;
grant execute on function submit_deal(uuid) to authenticated;

-- ============================================================================
-- 5. Option 2 — tg_scan_message() no longer raises. Flags the row (is_invalid = true) and lets the
--    INSERT succeed, so blocking and recording happen in ONE transaction: nothing can be skipped by a
--    client that bypasses the pre-check (the pre-check is being removed from the messages send path
--    entirely, per the review — it's no longer needed and would otherwise double-count). This is the
--    resolution to the finding that a BEFORE trigger cannot durably record a violation and then also
--    roll back the write: it stops needing to roll back at all.
--
--    "One attempted message = one violation regardless of how many contact patterns it contains":
--    scan_contact_info() already short-circuits and returns a single reason on the first match, so
--    this fires at most once per message, unconditionally.
--
--    Broker-only counting: messages.sender_role is already stored on the row (no extra lookup needed).
--    Lender-sent violations are still flagged + logged to admin_alerts exactly as before; they simply
--    never touch broker_contact_violations or the suspension logic, since lenders don't submit deals.
--
--    Anti-overlap + fresh strike cycles (revised twice on review, 2026-09-04 — this is the second,
--    corrected revision): a new automatic suspension is created only when TWO conditions both hold:
--    (a) no automatic suspension is currently active for this broker, and (b) the broker has
--    accumulated >= 3 violations, counting ONLY violations that are BOTH within the trailing 30 days
--    AND created after the EFFECTIVE END of the broker's most recent automatic suspension (if they
--    have one at all — a broker with no prior automatic suspension has no such floor, so the count is
--    simply the plain rolling-30-day count, unchanged from before).
--
--    "Effective end" = coalesce(ended_at, expires_at) of that most recent (by starts_at) automatic
--    suspension: its actual early-lift time if an admin manually ended it, otherwise its originally
--    scheduled expiry. This corrects the FIRST revision (which anchored to starts_at instead) — that
--    version let violations sent DURING the still-active suspension count toward the NEXT cycle simply
--    because they occurred after the CURRENT one's start, which is not the desired behavior: a broker
--    who reoffends while already serving a suspension should not get partial credit toward being
--    suspended again the moment they're released. Anchoring to the effective END instead means every
--    violation recorded while expires_at > now() (i.e. strictly before the suspension's real end,
--    whichever end that turns out to be) automatically fails the "created_at > effective_end" test —
--    no separate "was this during an active suspension" branch is needed, the single comparison
--    already excludes them. Once the suspension's effective end has genuinely passed, the broker's
--    fresh-cycle count starts at zero and needs a full new 3 to trigger the next one. Admin manually
--    ending a suspension early moves this floor forward to that early end, per instruction — the new
--    cycle begins counting from when the broker actually regained the ability to submit, not from the
--    originally scheduled date.
--
--    Every violation recorded during an active suspension is still permanently written to
--    broker_contact_violations exactly as always (this trigger's INSERT into that table is entirely
--    unconditional on suspension state) — this logic only changes what COUNTS toward the NEXT
--    automatic threshold via a read-time filter; no historical row is ever deleted, reset, or excluded
--    from admin/audit visibility (admin_broker_enforcement_detail still returns full, unfiltered
--    history, including every during-suspension violation).
--
--    Manual suspensions never anchor this: the anchor query filters `where is_automatic`, so an
--    admin's manual suspension can never reset or otherwise affect the automatic strike cycle, and a
--    currently-active MANUAL suspension does not block a new automatic one either (approved: manual
--    and automatic coexist independently).
-- ============================================================================

create or replace function tg_scan_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first text;
  v_last text;
  v_reason text;
  v_deal_id uuid;
  v_alert_id uuid;
  v_violation_count integer;
  v_active_auto boolean;
  v_last_auto_end timestamptz;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;

  select first_name, last_name into v_first, v_last from profiles where id = new.sender_id;
  v_reason := scan_contact_info(new.content, v_first, v_last);

  if v_reason is null then
    new.is_invalid := false;
    return new;
  end if;

  new.is_invalid := true;

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

-- ============================================================================
-- 6. send_deal_message() — return type changes (messages rowtype -> a custom shape carrying
--    is_invalid + a recomputed block_reason), so DROP is required before CREATE. Behavior: the INSERT
--    always succeeds now (the trigger flags, never rejects); the message_received notification and
--    the deal_chats.updated_at bump are skipped when the message was flagged, so a blocked attempt
--    produces zero observable side effects for the recipient (no notification, no thread reordering,
--    no unread bump — see my_chat_threads() below for the read-side half of that guarantee).
--    block_reason is scan_contact_info() recomputed on the already-known-flagged content, purely to
--    preserve the specific "it looks like it contains an email address" style message the UI showed
--    before Option 2 — cheap (pure/immutable function), not a second source of truth for the decision.
-- ============================================================================

drop function if exists send_deal_message(uuid, text, uuid);

create or replace function send_deal_message(p_deal_id uuid, p_content text, p_lender_id uuid default null)
returns table (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  sender_role user_role,
  content text,
  is_invalid boolean,
  is_read boolean,
  created_at timestamptz,
  block_reason text
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  d deals%rowtype;
  c deal_chats%rowtype;
  v_role user_role;
  v_recipient uuid;
  m messages%rowtype;
  v_first text;
  v_last text;
  v_reason text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if is_currently_deleted() then raise exception 'This account has been deleted.'; end if;
  if coalesce(btrim(p_content), '') = '' then raise exception 'message is empty'; end if;
  select * into d from deals where id = p_deal_id;
  if d.id is null then raise exception 'deal not found'; end if;

  if d.broker_id = v_uid then
    if p_lender_id is null then raise exception 'a lender thread is required to reply'; end if;
    select * into c from deal_chats where deal_id = p_deal_id and lender_id = p_lender_id;
    if c.id is null then raise exception 'no chat exists with this lender'; end if;
    v_role := 'broker';
    v_recipient := p_lender_id;
  else
    if not (lender_can_see_deal(d) or i_offered_on(d.id)) then
      raise exception 'you cannot message on this deal';
    end if;
    select * into c from deal_chats where deal_id = p_deal_id and lender_id = v_uid;
    if c.id is null then
      insert into deal_chats (deal_id, broker_id, lender_id)
      values (p_deal_id, d.broker_id, v_uid)
      returning * into c;
    end if;
    v_role := 'lender';
    v_recipient := d.broker_id;
  end if;

  -- The messages BEFORE-INSERT anti-contact trigger flags (never rejects) offending content.
  insert into messages (chat_id, sender_id, sender_role, content)
  values (c.id, v_uid, v_role, p_content)
  returning * into m;

  if m.is_invalid then
    select first_name, last_name into v_first, v_last from profiles where id = v_uid;
    v_reason := scan_contact_info(p_content, v_first, v_last);
  else
    update deal_chats set updated_at = now() where id = c.id;
    perform notify(v_recipient, 'message_received',
                   format('You have a new message on deal %s.', d.deal_number), d.id);
  end if;

  return query select m.id, m.chat_id, m.sender_id, m.sender_role, m.content, m.is_invalid, m.is_read, m.created_at, v_reason;
end $$;

-- Hardening (fixed on review, 2026-09-04): this function is DROPped and recreated above (its return
-- type changed), which resets its ACL to the Postgres default of EXECUTE granted to PUBLIC — the plain
-- `grant ... to authenticated` alone does not remove that default grant. Its own `if v_uid is null`
-- guard already rejects an anonymous caller safely (a proper NULL-safe check, unlike the bug class
-- fixed on submit_deal below), so this was not an active vulnerability — but leaving the PUBLIC grant in
-- place means the fix depends solely on that one IF statement never being touched again, which is
-- exactly the reasoning submit_deal's own revoke below is built on. Applying it here too for consistency.
revoke execute on function send_deal_message(uuid, text, uuid) from public, anon;
grant execute on function send_deal_message(uuid, text, uuid) to authenticated;

-- ============================================================================
-- 7. Read-side enforcement: an is_invalid message must never be visible, counted, or previewed for
--    the counterparty. Three places needed this, all fixed together:
--      - messages_participants (RLS): the actual security boundary. A non-sender participant can only
--        select a row when it is NOT invalid; the sender and admin can always select their own /
--        anyone's respectively. Without this, a direct SELECT on `messages` would leak the exact
--        contact info the trigger is supposed to hide.
--      - my_chat_threads(): the unread count and "last message" preview both exclude is_invalid rows,
--        for BOTH participants uniformly — a blocked attempt must not bump anyone's unread badge or
--        become a thread's preview text.
--      - mark_chat_read(): excluded too, so a hidden message a participant never actually saw is never
--        marked "read" on their behalf (harmless either way, just more correct).
-- ============================================================================

drop policy if exists messages_participants on messages;

create policy messages_participants on messages for select to authenticated
  using (
    is_admin()
    or sender_id = auth.uid()
    or (
      not is_invalid
      and exists (select 1 from deal_chats c where c.id = chat_id
                  and (c.broker_id = auth.uid() or c.lender_id = auth.uid()))
    )
  );

create or replace function my_chat_threads()
returns table (
  chat_id uuid,
  deal_id uuid,
  deal_number text,
  deal_status deal_status,
  i_am_broker boolean,
  counterparty_ordinal integer,
  last_content text,
  last_at timestamptz,
  last_sender_role user_role,
  unread integer
)
language sql stable security definer set search_path = public as $$
  select c.id, c.deal_id, d.deal_number, d.status,
         (c.broker_id = auth.uid()) as i_am_broker,
         row_number() over (partition by c.deal_id order by c.created_at)::integer as counterparty_ordinal,
         lm.content, lm.created_at, lm.sender_role,
         coalesce((select count(*) from messages mm
                   where mm.chat_id = c.id and mm.sender_id <> auth.uid()
                     and not mm.is_read and not mm.is_invalid), 0)::integer as unread
  from deal_chats c
  join deals d on d.id = c.deal_id
  left join lateral (
    select content, created_at, sender_role
    from messages m where m.chat_id = c.id and not m.is_invalid
    order by m.created_at desc limit 1
  ) lm on true
  where c.broker_id = auth.uid() or c.lender_id = auth.uid()
  order by c.updated_at desc
$$;

create or replace function mark_chat_read(p_chat_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from deal_chats c
                 where c.id = p_chat_id and (c.broker_id = v_uid or c.lender_id = v_uid)) then
    raise exception 'not your chat';
  end if;
  update messages set is_read = true
   where chat_id = p_chat_id and sender_id <> v_uid and not is_read and not is_invalid;
end $$;

grant execute on function mark_chat_read(uuid) to authenticated;
grant execute on function my_chat_threads() to authenticated;

-- ============================================================================
-- 8. Admin RPCs — same hardened pattern as migrations 77-79: auth.uid() null guard, is_admin() check,
--    security definer, search_path pinned, revoke from public/anon, grant to authenticated only.
--
--    admin_broker_directory() reads auth.users.email via a cross-schema join inside this function —
--    the ONLY place in the codebase that exposes a user's email, and only to an is_admin() caller.
--    "Currently suspended" / "suspension_expires_at" use the LATEST-expiring active suspension when
--    more than one is active at once (manual + automatic coexisting), matching "remains suspended
--    while ANY unexpired suspension exists."
--
--    is_auth_banned (added on review, 2026-09-04): Delete Account's Auth ban (delete-broker edge
--    function, admin.updateUserById with a ~100-year ban_duration) can fail independently of the DB
--    half succeeding, and profiles.is_deleted alone can't tell the two apart — the Admin Brokers UI
--    needs Supabase Auth's OWN ban state as the source of truth for whether "Delete Account" is truly
--    complete, rather than a second DB flag that could drift from it. auth.users.banned_until is that
--    source of truth: it's the real column GoTrue's ban feature writes to (the same field
--    admin.updateUserById(...) sets), already reachable here since this function already joins
--    auth.users for email — same table, same SECURITY DEFINER privileges, no new grant needed.
--    "Banned" = banned_until is set AND still in the future (a ban this app sets is always ~100 years
--    out, but the comparison is written generally rather than assuming that specific duration).
-- ============================================================================

create or replace function admin_broker_directory()
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  brokerage_name text,
  is_broker_admin boolean,
  is_deleted boolean,
  is_auth_banned boolean,
  is_suspended boolean,
  suspension_expires_at timestamptz,
  violations_30d integer,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;

  return query
    select
      p.id, p.first_name, p.last_name,
      u.email,
      p.phone,
      br.name as brokerage_name,
      p.is_broker_admin,
      p.is_deleted,
      (u.banned_until is not null and u.banned_until > now()) as is_auth_banned,
      (bs.broker_id is not null) as is_suspended,
      bs.max_expires_at as suspension_expires_at,
      coalesce(bv.violations_30d, 0)::integer as violations_30d,
      p.created_at
    from profiles p
    join auth.users u on u.id = p.id
    left join brokerages br on br.id = p.brokerage_id
    left join (
      select broker_id, max(expires_at) as max_expires_at
      from broker_suspensions
      where expires_at > now() and ended_at is null
      group by broker_id
    ) bs on bs.broker_id = p.id
    left join (
      select broker_id, count(*) as violations_30d
      from broker_contact_violations
      where created_at >= now() - interval '30 days'
      group by broker_id
    ) bv on bv.broker_id = p.id
    where p.role = 'broker'
    order by p.created_at desc;
end $$;

revoke execute on function admin_broker_directory() from public, anon;
grant execute on function admin_broker_directory() to authenticated;

create or replace function admin_broker_enforcement_detail(p_broker_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;

  select jsonb_build_object(
    'is_deleted', p.is_deleted,
    'is_suspended', exists (
      select 1 from broker_suspensions
      where broker_id = p_broker_id and expires_at > now() and ended_at is null
    ),
    'violations_30d', (
      select count(*) from broker_contact_violations
      where broker_id = p_broker_id and created_at >= now() - interval '30 days'
    ),
    'suspensions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'reason', s.reason,
        'is_automatic', s.is_automatic,
        'created_by_name', nullif(trim(concat(cb.first_name, ' ', cb.last_name)), ''),
        'starts_at', s.starts_at,
        'expires_at', s.expires_at,
        'ended_at', s.ended_at,
        'ended_by_name', nullif(trim(concat(eb.first_name, ' ', eb.last_name)), ''),
        'is_active', (s.expires_at > now() and s.ended_at is null)
      ) order by s.starts_at desc)
      from broker_suspensions s
      left join profiles cb on cb.id = s.created_by
      left join profiles eb on eb.id = s.ended_by
      where s.broker_id = p_broker_id
    ), '[]'::jsonb),
    'violations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'flagged_content', a.flagged_content,
        'deal_number', d.deal_number,
        'created_at', v.created_at
      ) order by v.created_at desc)
      from broker_contact_violations v
      left join admin_alerts a on a.id = v.alert_id
      left join deals d on d.id = v.deal_id
      where v.broker_id = p_broker_id
    ), '[]'::jsonb)
  ) into result
  from profiles p
  where p.id = p_broker_id;

  if result is null then raise exception 'broker not found'; end if;
  return result;
end $$;

revoke execute on function admin_broker_enforcement_detail(uuid) from public, anon;
grant execute on function admin_broker_enforcement_detail(uuid) to authenticated;

create or replace function admin_suspend_broker(p_broker_id uuid, p_days integer, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  if p_days is null or p_days <= 0 then raise exception 'duration must be a positive number of days'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if not exists (select 1 from profiles where id = p_broker_id and role = 'broker') then
    raise exception 'broker not found';
  end if;

  insert into broker_suspensions (broker_id, reason, is_automatic, created_by, starts_at, expires_at)
  values (p_broker_id, p_reason, false, auth.uid(), now(), now() + (p_days || ' days')::interval);
end $$;

revoke execute on function admin_suspend_broker(uuid, integer, text) from public, anon;
grant execute on function admin_suspend_broker(uuid, integer, text) to authenticated;

create or replace function admin_end_suspension(p_suspension_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s broker_suspensions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;

  select * into s from broker_suspensions where id = p_suspension_id for update;
  if s.id is null then raise exception 'suspension not found'; end if;
  if s.ended_at is not null then raise exception 'this suspension was already ended'; end if;
  if s.expires_at <= now() then raise exception 'this suspension has already expired'; end if;

  update broker_suspensions set ended_at = now(), ended_by = auth.uid() where id = p_suspension_id;
end $$;

revoke execute on function admin_end_suspension(uuid) from public, anon;
grant execute on function admin_end_suspension(uuid) to authenticated;

-- ============================================================================
-- 9. Delete Account (soft-delete only — see the migration header). This RPC only ever sets the
--    profiles metadata; it CANNOT ban the Auth user (Postgres has no access to the GoTrue HTTP Admin
--    API) — that half is the new delete-broker edge function, which calls this RPC (forwarding the
--    calling admin's own JWT, so is_admin() is enforced exactly as everywhere else) and then
--    separately performs the Auth-level ban.
--
--    Session revocation: an earlier draft of this migration also had admin_revoke_broker_sessions(),
--    a security definer function that reached directly into auth.sessions / auth.refresh_tokens
--    (GoTrue's own internal schema, not this repo's) to force-invalidate an already-issued session.
--    Reviewed and removed: this repo could not verify from this environment (no node_modules, no
--    internet access) whether the installed @supabase/supabase-js (^2.110.0) exposes a supported,
--    documented Admin API for "revoke every session belonging to user X", and manipulating GoTrue's
--    internal tables directly — with column shapes that have changed across GoTrue versions
--    historically — was judged too risky to ship unverified. The Auth ban below is independently
--    sufficient for stopping all FUTURE sign-ins and token refreshes on its own; is_currently_deleted()
--    (see above) is the defense-in-depth layer for the narrow residual window where an
--    already-issued, still-valid access token could otherwise keep working until it naturally expires.
--    See the chat record for the full comparison of alternatives if immediate session revocation is
--    wanted later (extending is_currently_deleted() checks further vs. a confirmed Admin API method
--    vs. a dashboard-driven manual step) — none were implemented here to avoid guessing.
-- ============================================================================

create or replace function admin_soft_delete_broker(p_broker_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from profiles where id = p_broker_id and role = 'broker') then
    raise exception 'broker not found';
  end if;

  update profiles
    set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where id = p_broker_id;
end $$;

revoke execute on function admin_soft_delete_broker(uuid, text) from public, anon;
grant execute on function admin_soft_delete_broker(uuid, text) to authenticated;

-- ============================================================================
-- 10. convert_prequal_to_live() — auth.uid() is null guard (found on review, fixed 2026-09-04): found
--    while investigating whether any deal-submission-adjacent path could bypass the checks added to
--    submit_deal() above. This function predates this round (migration 48, later only referenced in a
--    comment by migration 65, never redefined) and has never had this guard: its ownership check —
--    `if d.broker_id <> auth.uid() and not is_admin() then raise exception 'not your deal'` — silently
--    no-ops for an anonymous caller. auth.uid() is NULL, `<>` against NULL is NULL, and
--    `NULL and <anything>` that isn't `false` is still NULL — PL/pgSQL treats a NULL IF condition as
--    false, so the raise never fires. (is_admin() itself returns a concrete `false`, not NULL, for an
--    anonymous caller — it's built on EXISTS, which never returns NULL — so `not is_admin()` evaluates
--    to `true`, but that doesn't rescue the AND: `NULL and true` is still NULL.) Combined with this
--    function never having been revoked from the default PUBLIC/anon EXECUTE grant, anyone holding only
--    the public anon key — no login at all — could convert ANY broker's prequal to a live deal by
--    guessing/knowing its UUID, overwriting the property address, closing date, and COF date. Same bug
--    class as submit_deal above, broker_deal_declines (migration 77), and block_lender_institution
--    (migration 78).
--
--    The fix is the guard alone, placed before the deal lookup/ownership logic per the established
--    pattern. Every other check, the update, the deal_identities upsert, the notify() call, and the
--    return shape are byte-for-byte unchanged from migration 48's version — verified by direct
--    comparison before writing this replacement, per instruction not to alter behavior beyond the fix.
-- ============================================================================

create or replace function convert_prequal_to_live(
  p_deal_id          uuid,
  p_property_address text,
  p_closing_date     date,
  p_cof_date         date default null
) returns deals
language plpgsql security definer set search_path = public as $$
declare d deals%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from deals where id = p_deal_id for update;
  if d.id is null then raise exception 'deal not found'; end if;
  if d.broker_id <> auth.uid() and not is_admin() then raise exception 'not your deal'; end if;
  -- order matters: conversion clears `prequal`, so the "already live" case must be tested first or
  -- a second attempt would report the less helpful "not a prequal".
  if d.prequal_converted_at is not null then raise exception 'this prequal is already a live deal'; end if;
  if not coalesce(d.prequal, false) then raise exception 'this deal is not a prequal'; end if;
  if d.status not in ('submitted', 'offer_received') then
    raise exception 'only a submitted prequal can be moved to a live deal';
  end if;
  if coalesce(btrim(p_property_address), '') = '' then
    raise exception 'a property address is required to move this deal to a live deal';
  end if;
  if p_closing_date is null then
    raise exception 'a closing date is required to move this deal to a live deal';
  end if;

  update deals set
    prequal              = false,
    prequal_converted_at = now(),
    closing_date         = p_closing_date,
    cof_date             = coalesce(p_cof_date, cof_date)
  where id = p_deal_id
  returning * into d;

  -- the address lives in deal_identities (hidden from lenders until acceptance — invariant #1)
  insert into deal_identities (deal_id, property_address)
  values (p_deal_id, btrim(p_property_address))
  on conflict (deal_id) do update set property_address = excluded.property_address;

  -- Offers carry over untouched; tell the lenders holding one that the deal is live now. The body
  -- carries the closing date only — never the address or the borrower's name.
  perform notify(o.lender_id, 'prequal_converted',
                 format('Deal %s moved from prequal to a live deal (closing %s). Your offer still stands.',
                        d.deal_number, to_char(p_closing_date, 'YYYY-MM-DD')),
                 d.id, o.id)
  from offers o
  where o.deal_id = d.id and o.status = 'pending';

  return d;
end $$;

revoke execute on function convert_prequal_to_live(uuid, text, date, date) from public, anon;
grant execute on function convert_prequal_to_live(uuid, text, date, date) to authenticated;
