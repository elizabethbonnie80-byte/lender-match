-- Fix "structure of query does not match function result type" in admin_broker_directory(), surfaced
-- on staging immediately after migration 81 resolved the prior ambiguity error and let this function
-- actually execute for the first time. Root cause: auth.users.email is `character varying(255)`
-- (GoTrue's own schema, not one of ours), but this function's RETURNS TABLE declares `email text`.
-- RETURN QUERY checks the query's result row structure against the declared output structure by
-- comparing actual type OIDs positionally — unlike a plain top-level SELECT, it does not apply the
-- usual implicit varchar->text cast, so the two are treated as incompatible. auth.users is joined
-- ONLY here in the whole codebase, and email is the only column read from it directly into the output
-- row (banned_until is only used inside a boolean expression, so its own type never has to match
-- anything) — every other returned column was verified against this repo's own schema migrations and
-- already matches its declared type exactly. Fix is an explicit cast at the point of selection;
-- everything else in the function — signature, RETURNS TABLE, auth/admin checks, security
-- definer/search_path, joins, ordering, revoke/grant — is byte-for-byte unchanged from migration 81.

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
      u.email::text,
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
      where broker_contact_violations.created_at >= now() - interval '30 days'
      group by broker_id
    ) bv on bv.broker_id = p.id
    where p.role = 'broker'
    order by p.created_at desc;
end $$;

revoke execute on function admin_broker_directory() from public, anon;
grant execute on function admin_broker_directory() to authenticated;
