-- Fix PL/pgSQL "column reference is ambiguous" bugs found on staging after migration 80 (2026-09-04
-- broker enforcement) was applied there. Two functions declare `returns table (...)` output columns
-- that are ALSO real column names on tables they query. PL/pgSQL treats every RETURNS TABLE output
-- column as an implicit variable in scope for the whole function body, and Postgres's default
-- `plpgsql.variable_conflict = error` means any UNQUALIFIED reference to one of those names inside the
-- function raises "column reference \"x\" is ambiguous" the instant that statement runs — it can't tell
-- whether you mean the table column or the function's own output variable. The fix is qualification
-- only: every other line and behavior of both functions is unchanged, and both keep their existing
-- revoke/grant hardening from migration 80 (this migration does not touch grants — `create or replace`
-- preserves the ACL already set there).
--
-- admin_broker_directory(): RETURNS TABLE(..., created_at timestamptz, ...) collided with the bare
-- `created_at` in the violations_30d subquery's WHERE clause (querying broker_contact_violations).
-- This is exactly what broke Admin > Manage > Brokers on staging.
--
-- send_deal_message(): RETURNS TABLE(id uuid, ...) collided with THREE separate bare `id` references
-- (against deals, profiles, and deal_chats respectively). Because PL/pgSQL raises this error the moment
-- it reaches the offending statement, and the FIRST bare `id` (the deals lookup) runs on every single
-- call, this function has been completely non-functional for every message send — broker replies, a
-- lender opening a new thread, and every bulk "Message N deals" action — since migration 80 was
-- applied. Found on review while investigating the admin_broker_directory() report, not yet reported
-- as its own symptom.

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
      where broker_contact_violations.created_at >= now() - interval '30 days'
      group by broker_id
    ) bv on bv.broker_id = p.id
    where p.role = 'broker'
    order by p.created_at desc;
end $$;

revoke execute on function admin_broker_directory() from public, anon;
grant execute on function admin_broker_directory() to authenticated;

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
  select * into d from deals where deals.id = p_deal_id;
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
    select first_name, last_name into v_first, v_last from profiles where profiles.id = v_uid;
    v_reason := scan_contact_info(p_content, v_first, v_last);
  else
    update deal_chats set updated_at = now() where deal_chats.id = c.id;
    perform notify(v_recipient, 'message_received',
                   format('You have a new message on deal %s.', d.deal_number), d.id);
  end if;

  return query select m.id, m.chat_id, m.sender_id, m.sender_role, m.content, m.is_invalid, m.is_read, m.created_at, v_reason;
end $$;

revoke execute on function send_deal_message(uuid, text, uuid) from public, anon;
grant execute on function send_deal_message(uuid, text, uuid) to authenticated;
