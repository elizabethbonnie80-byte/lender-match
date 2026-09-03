-- Round 4 (approved 2026-09-03): a 5-institution cap on broker → lender-institution blocking, plus a
-- durable audit trail of every block/unblock so Admin can spot patterns (a broker sitting at 5/5,
-- rapid rotation, unblock-then-immediately-block-another). Per-broker, institution-level — unchanged
-- from the existing feature (lender_can_see_deal, lender-side lender_blocked_brokerages) except for
-- the two things below. Not brokerage-wide; the lender-side "block a brokerage" flow is untouched.
--
-- Pre-migration data check (see docs/backlog or the chat record for the exact wording asked): this
-- migration adds NO table-level CHECK/constraint capping existing rows, specifically so it can never
-- fail or silently truncate data regardless of what's already in broker_blocked_institutions on
-- staging/prod. The 5-cap is enforced only going forward, on NEW inserts, inside
-- block_lender_institution() below. A broker already holding 6+ rows (if any exist) keeps them
-- untouched; they simply cannot add a 6th until they drop back under 5 by unblocking. Read-only
-- diagnostic to run first (see chat): select broker_id, count(*) from broker_blocked_institutions
-- group by broker_id having count(*) > 5;
--
-- ============================================================================
-- 1. Audit table — one row per block/unblock event. Admin-read-only; nobody else gets a SELECT
--    policy, and there is no INSERT/UPDATE/DELETE policy for anyone — the only way a row is ever
--    written is the trigger below (security definer, bypasses RLS), so this cannot be tampered with
--    or bypassed from the client, and ordinary brokers/lenders have zero direct visibility into it.
--
--    broker_id / institution_id are nullable with ON DELETE SET NULL, NOT cascade: this table is
--    meant to survive the records it references (profiles/lender_institutions are "retire, never
--    delete" by convention anyway — see CLAUDE.md — but the audit trail should not depend on nobody
--    ever deleting one). broker_name / brokerage_name / institution_name are SNAPSHOTS taken by the
--    trigger at the moment of the event, not a live join — so a historical row stays fully readable
--    (who did what, and to which institution) even if the underlying profile/institution is later
--    deleted, and — as a side effect — a later rename doesn't retroactively rewrite what an old event
--    says, which is the more correct behavior for an audit log regardless. broker_name/institution_name
--    are NOT NULL because the trigger only ever fires from a real block_blocked_institutions row,
--    whose own (still-cascading) FKs guarantee the referenced profile/institution existed at that
--    instant; brokerage_name stays nullable, matching the existing left-join pattern elsewhere.
-- ============================================================================

create table broker_block_audit (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid references profiles(id) on delete set null,
  institution_id uuid references lender_institutions(id) on delete set null,
  broker_name text not null,
  brokerage_name text,
  institution_name text not null,
  action text not null check (action in ('blocked', 'unblocked')),
  created_at timestamptz not null default now()
);

alter table broker_block_audit enable row level security;

create policy block_audit_admin_read on broker_block_audit for select to authenticated
  using (is_admin());

-- ============================================================================
-- 2. Audit trigger — fires on every INSERT/DELETE against broker_blocked_institutions, regardless of
--    which code path wrote the row (the new RPC below, or a service-role script). This is the
--    "database-side mechanism" the audit trail depends on, not the frontend voluntarily logging it.
--    `on conflict ... do nothing` on the RPC's insert means a redundant re-block never fires this
--    trigger (no row is actually inserted), so a duplicate 'blocked' event can't happen; an unblock of
--    an institution that wasn't blocked deletes zero rows for the same reason. The RPC additionally
--    short-circuits a re-block of an already-blocked institution before it would even attempt the
--    (conflicting, no-op) insert — see block_lender_institution() below — so this trigger only ever
--    fires for a genuine state change either way.
--
--    Snapshots broker_name/brokerage_name/institution_name from the CURRENT profiles/brokerages/
--    lender_institutions rows at the moment of the event (see the table comment above for why).
--
--    security definer (not the default invoker-rights trigger behavior) so it can write to
--    broker_block_audit even when the triggering statement itself ran as the broker's own
--    `authenticated` role (a plain client-side DELETE for unblock, which has no INSERT grant on the
--    audit table) — same reasoning `protect_privileged_profile_fields()` / `tg_scan_offer_comments()`
--    already rely on elsewhere in this codebase. Returns `trigger`, so — like `job_cache_invalidate`
--    (see CLAUDE.md security invariants) — PostgREST cannot expose it as a callable RPC regardless of
--    grants; no explicit revoke needed here.
-- ============================================================================

create or replace function tg_audit_broker_block() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_broker_id uuid := coalesce(new.broker_id, old.broker_id);
  v_institution_id uuid := coalesce(new.institution_id, old.institution_id);
  v_broker_name text;
  v_brokerage_name text;
  v_institution_name text;
begin
  select trim(concat(p.first_name, ' ', p.last_name)), br.name
    into v_broker_name, v_brokerage_name
    from profiles p left join brokerages br on br.id = p.brokerage_id
    where p.id = v_broker_id;

  select li.name into v_institution_name from lender_institutions li where li.id = v_institution_id;

  if tg_op = 'INSERT' then
    insert into broker_block_audit (broker_id, institution_id, broker_name, brokerage_name, institution_name, action)
      values (v_broker_id, v_institution_id, v_broker_name, v_brokerage_name, v_institution_name, 'blocked');
    return new;
  elsif tg_op = 'DELETE' then
    insert into broker_block_audit (broker_id, institution_id, broker_name, brokerage_name, institution_name, action)
      values (v_broker_id, v_institution_id, v_broker_name, v_brokerage_name, v_institution_name, 'unblocked');
    return old;
  end if;
  return null;
end $$;

create trigger broker_blocked_institutions_audit_ins
  after insert on broker_blocked_institutions
  for each row execute function tg_audit_broker_block();

create trigger broker_blocked_institutions_audit_del
  after delete on broker_blocked_institutions
  for each row execute function tg_audit_broker_block();

-- ============================================================================
-- 3. Close the direct-insert bypass. `bbi_owner` was `for all` (select/insert/update/delete), which
--    means a broker's own authenticated client could always insert into broker_blocked_institutions
--    directly via PostgREST, completely sidestepping any cap check living only inside a new RPC. Split
--    it into select + delete only — insert now has NO policy matching `authenticated`, so it is denied
--    by RLS's default-deny, and the ONLY way to add a block is block_lender_institution() below (a
--    security definer function, which bypasses RLS the same way every other write-RPC in this
--    codebase does). Unblocking stays a direct client-side DELETE, per the reviewed decision — it was
--    never the part that could exceed a maximum, and existing RLS already scopes it to the caller's
--    own rows.
-- ============================================================================

drop policy if exists bbi_owner on broker_blocked_institutions;

create policy bbi_owner_select on broker_blocked_institutions for select to authenticated
  using (broker_id = auth.uid());

create policy bbi_owner_delete on broker_blocked_institutions for delete to authenticated
  using (broker_id = auth.uid());

-- ============================================================================
-- 4. block_lender_institution — the sole insert path, and the sole place the 5-per-broker cap is
--    checked. Race safety: pg_advisory_xact_lock(hashtext(broker_id::text)) is acquired BEFORE either
--    check below and held for the rest of this transaction (released automatically at COMMIT/
--    ROLLBACK). Two simultaneous calls from the SAME broker are therefore fully serialized — the
--    second one blocks until the first's transaction ends, then re-reads current state and sees the
--    first call's effect, so "both read count=4, both pass, both insert, land at 6" cannot happen. The
--    lock is keyed per broker (hashtext of their own uid), so it never contends across different
--    brokers' concurrent calls. hashtext() collisions between two different brokers are physically
--    possible (32-bit hash) but harmless: worst case is two unrelated brokers occasionally serializing
--    against each other for the microseconds a transaction takes — the actual checks below always
--    read `where broker_id = v_uid`, so correctness never depends on the hash being collision-free.
--
--    Idempotent re-block: the already-blocked check runs BEFORE the 5-cap count, and under the same
--    lock. Without this ordering, a broker already at 5/5 whose stale UI or a retried request tries
--    to "block" an institution they already have blocked would be rejected with BLOCK_LIMIT_REACHED
--    even though nothing would actually change — re-blocking an existing block is a no-op, not a new
--    block, and must not consume a slot that's already spent. Returning early here also means no
--    insert happens, so the audit trigger correctly does not fire a spurious extra 'blocked' event.
--
--    auth.uid() is null guard + revoke from public/anon: same reasoning as broker_deal_declines
--    (migration 77) — Postgres grants EXECUTE to PUBLIC on every new function by default, which every
--    role including anon inherits, so both the explicit revoke AND the internal null check are needed;
--    the null check also protects the function even if a future migration ever loosens the grant again.
-- ============================================================================

create or replace function block_lender_institution(p_institution_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from profiles where id = v_uid and role = 'broker') then
    raise exception 'only brokers can block lender institutions';
  end if;

  if not exists (select 1 from lender_institutions where id = p_institution_id and is_active) then
    raise exception 'lender institution not found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  if exists (
    select 1 from broker_blocked_institutions
    where broker_id = v_uid and institution_id = p_institution_id
  ) then
    -- Already blocked: harmless no-op. Not a new block, so it must not raise BLOCK_LIMIT_REACHED and
    -- must not insert (hence must not audit) anything.
    return;
  end if;

  select count(*) into v_count from broker_blocked_institutions where broker_id = v_uid;
  if v_count >= 5 then
    raise exception 'BLOCK_LIMIT_REACHED';
  end if;

  insert into broker_blocked_institutions (broker_id, institution_id)
    values (v_uid, p_institution_id)
    on conflict (broker_id, institution_id) do nothing;
end $$;

revoke execute on function block_lender_institution(uuid) from public, anon;
grant execute on function block_lender_institution(uuid) to authenticated;

-- ============================================================================
-- 5. admin_block_activity — one is_admin()-gated jsonb aggregate for the new /admin/block-activity
--    monitoring page, mirroring the admin_analytics() shape (one call, one blob) rather than several
--    round trips. `summary` is the current state (one row per broker who currently has ≥1 active
--    block, live-joined to profiles/brokerages/lender_institutions — those rows only exist while the
--    broker and their blocks still do, so a live join is correct here); `events` is the last 200 audit
--    rows across all brokers, newest first, read directly off broker_block_audit's own snapshot
--    columns (broker_name/brokerage_name/institution_name) rather than joining — the whole point of
--    those columns is that an event stays fully readable after the referenced profile/institution is
--    deleted (ON DELETE SET NULL leaves broker_id/institution_id null, but the snapshot text
--    survives). "A table/list is enough" per the reviewed spec, deliberately no scoring/graphs.
--    Written as plpgsql with an explicit auth.uid()/is_admin() raise (rather than admin_analytics()'s
--    `case when not is_admin() then '{}'` fallback style) plus an explicit revoke from public/anon,
--    per the same hardening asked for every new security definer function in this batch —
--    admin_analytics()'s softer style is already safe by construction (is_admin() never returns
--    NULL), but this is the more defensive, more consistent choice given how recently
--    broker_deal_declines needed the same guard.
-- ============================================================================

create or replace function admin_block_activity() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'broker_id', s.broker_id,
        'broker_name', s.broker_name,
        'brokerage_name', s.brokerage_name,
        'blocked_count', s.blocked_count,
        'blocked_institutions', s.blocked_institutions
      ) order by s.blocked_count desc, s.broker_name)
      from (
        select
          bb.broker_id,
          trim(concat(p.first_name, ' ', p.last_name)) as broker_name,
          br.name as brokerage_name,
          count(*) as blocked_count,
          array_agg(li.name order by li.name) as blocked_institutions
        from broker_blocked_institutions bb
        join profiles p on p.id = bb.broker_id
        left join brokerages br on br.id = p.brokerage_id
        join lender_institutions li on li.id = bb.institution_id
        group by bb.broker_id, p.first_name, p.last_name, br.name
      ) s
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'broker_id', e.broker_id,
        'broker_name', e.broker_name,
        'brokerage_name', e.brokerage_name,
        'institution_id', e.institution_id,
        'institution_name', e.institution_name,
        'action', e.action,
        'created_at', e.created_at
      ) order by e.created_at desc)
      from (
        select id, broker_id, broker_name, brokerage_name, institution_id, institution_name, action, created_at
        from broker_block_audit
        order by created_at desc
        limit 200
      ) e
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function admin_block_activity() from public, anon;
grant execute on function admin_block_activity() to authenticated;
