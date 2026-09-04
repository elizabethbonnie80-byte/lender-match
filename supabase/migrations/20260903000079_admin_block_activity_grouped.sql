-- Round 4 follow-up (approved 2026-09-03): the Admin Block Activity page moves from "one row per
-- individual audit event" (capped at the last 200, platform-wide) to "one row per broker with any
-- block/unblock history", with a per-broker detail drill-down. This migration only changes what the
-- two RPCs below return — no change to the 5-per-broker cap, block_lender_institution(), the audit
-- trigger, broker_block_audit's schema/durability design, RLS, or broker-facing blocking behavior.
-- Migration 78 is already applied to staging and is NOT edited here — this is purely additive
-- (create or replace on the same admin_block_activity() signature, plus one brand-new function).
--
-- ============================================================================
-- 1. admin_block_activity() — summary is now keyed off broker_block_audit (history), not
--    broker_blocked_institutions (current state only). The old version only included a broker if
--    they currently had ≥1 active block, so a broker who blocked and later unblocked everything
--    (real history, zero current blocks) simply vanished from the page — exactly the gap the client
--    asked to fix.
--
--    Built from three independently-aggregated pieces, joined on broker_id:
--      `latest`  — one row per broker via DISTINCT ON (broker_id) ordered by created_at desc, id desc
--                  (the id tiebreak makes "most recent" deterministic if two events for the same
--                  broker ever land on the exact same timestamp — id is a plain gen_random_uuid(),
--                  not sequential, so this is only about picking ONE row consistently on a tie, not
--                  about actually resolving which insert happened first). Its own snapshot
--                  broker_name/brokerage_name (taken by the trigger at write time — see migration 78)
--                  are reused here directly instead of a fresh live join to profiles/brokerages,
--                  which means a broker's row still shows a sensible name even if their profile is
--                  later deleted (same fallback chain migration 78 already established for the audit
--                  table itself).
--      `cur`     — current active blocks, LEFT JOINed so a broker with zero current blocks still
--                  gets a row (blocked_count 0, blocked_institutions '[]') rather than being dropped.
--      `recent`  — count of ALL audit rows (both actions) in the last 7 days, LEFT JOINed the same
--                  way. This is computed over the FULL broker_block_audit table, not a capped list —
--                  the previous design point (returning only the last 200 events platform-wide) was
--                  reviewed and rejected specifically because a 7-day count derived from a globally
--                  capped list can silently undercount once total platform activity exceeds the cap.
--
--    The top-level `events` array is removed entirely: nothing in the revised frontend consumes a
--    platform-wide event list any more (per-broker detail now goes through
--    admin_broker_block_history() below), so carrying it would just be unused payload.
--
--    The final `summary` array is ordered `latest.created_at desc, latest.broker_id` — the broker_id
--    tiebreak only guarantees a stable, repeatable row order if two different brokers' most recent
--    events happen to share the exact same timestamp; it has no effect on which broker "really" acted
--    more recently, only on how ties render consistently across page loads.
--
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
        'broker_id', latest.broker_id,
        'broker_name', latest.broker_name,
        'brokerage_name', latest.brokerage_name,
        'blocked_count', coalesce(cur.blocked_count, 0),
        'blocked_institutions', coalesce(cur.blocked_institutions, '[]'::jsonb),
        'changes_7d', coalesce(recent.changes_7d, 0),
        'latest_action', latest.action,
        'latest_institution_name', latest.institution_name,
        'latest_created_at', latest.created_at
      ) order by latest.created_at desc, latest.broker_id)
      from (
        select distinct on (broker_id)
          broker_id, broker_name, brokerage_name, action, institution_name, created_at
        from broker_block_audit
        order by broker_id, created_at desc, id desc
      ) latest
      left join (
        select bb.broker_id,
               count(*) as blocked_count,
               jsonb_agg(li.name order by li.name) as blocked_institutions
        from broker_blocked_institutions bb
        join lender_institutions li on li.id = bb.institution_id
        group by bb.broker_id
      ) cur on cur.broker_id = latest.broker_id
      left join (
        select broker_id, count(*) as changes_7d
        from broker_block_audit
        where created_at >= now() - interval '7 days'
        group by broker_id
      ) recent on recent.broker_id = latest.broker_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function admin_block_activity() from public, anon;
grant execute on function admin_block_activity() to authenticated;

-- ============================================================================
-- 2. admin_broker_block_history(p_broker_id) — the per-broker detail drill-down ("View Activity").
--    Reads ONE broker's full audit history directly, filtered by broker_id, so it is never subject
--    to the platform-wide crowding-out problem the old capped `events` array had (a busy OTHER
--    broker could never push a quiet broker's own history out of frame here, since each broker's
--    history is queried independently).
--
--    Deliberately NO LIMIT: an earlier draft capped this at 500 rows, reasoned (incorrectly — the
--    arithmetic was simply wrong, 500 / 10 events-per-day is 50 days, not "well over a year") to be
--    a safe margin. Reviewed and rejected: "View Activity" is meant to show that broker's full
--    audit history, and a broker legitimately could pass 500 events well within the product's
--    lifetime, at which point this would silently start dropping their oldest events with no
--    indication to the admin that anything was cut. Returning everything is correct for now; if
--    per-broker volume ever grows large enough to matter, add real pagination (a p_cursor/p_limit
--    pair, ordered by created_at) rather than reintroducing a silent cap.
--
--    Ordered `created_at desc, id desc` — the id tiebreak only makes the row order deterministic if
--    two of this broker's own events share the exact same timestamp; it does not change which events
--    are returned, only their relative order on a tie.
--
--    Same security shape as admin_block_activity() and every other function in this feature:
--    explicit auth.uid() null guard, is_admin() check, security definer + search_path pinned,
--    revoked from public/anon, granted only to authenticated.
-- ============================================================================

create or replace function admin_broker_block_history(p_broker_id uuid)
returns table(
  id uuid,
  action text,
  institution_id uuid,
  institution_name text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not is_admin() then
    raise exception 'admin only';
  end if;

  return query
    select a.id, a.action, a.institution_id, a.institution_name, a.created_at
    from broker_block_audit a
    where a.broker_id = p_broker_id
    order by a.created_at desc, a.id desc;
end $$;

revoke execute on function admin_broker_block_history(uuid) from public, anon;
grant execute on function admin_broker_block_history(uuid) to authenticated;
