-- Client revision A-3: re-prompt existing users to accept the Terms of Service / Privacy Policy when a
-- new version is published. Asked on 2026-07-23 ("We had talked about having a pop-up … re-agree to
-- everything. Is that functional now?" — answer: no, never built) and confirmed on 2026-07-28
-- ("Re-prompted would be great - yes please").
--
-- `legal_documents` already versions the docs and publishes one live row per type (the admin editor
-- enforces that). What was missing is any record of WHICH version a user accepted, so nothing could tell
-- a stale acceptance from a current one.
--
-- Design: an append-only acceptance log keyed to the document ROW, not to the version string. Version
-- strings are admin-typed free text, so two different documents could carry the same one; the row id
-- cannot collide. Append-only (no updates, no deletes for users) because this is the audit trail that
-- answers "what exactly did this user agree to, and when" — the whole point of the request.

create table legal_acceptances (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  legal_document_id   uuid not null references legal_documents(id) on delete cascade,
  -- Denormalised copies so the log still reads correctly if a document is later edited or unpublished.
  doc_type            legal_doc_type not null,
  doc_version         text not null,
  accepted_at         timestamptz not null default now(),
  unique (user_id, legal_document_id)
);

create index legal_acceptances_user_idx on legal_acceptances (user_id);

alter table legal_acceptances enable row level security;

-- A user sees and creates only their own acceptances; nobody can amend or erase one.
create policy legal_acceptances_own_read on legal_acceptances for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy legal_acceptances_own_insert on legal_acceptances for insert to authenticated
  with check (user_id = auth.uid());
-- Deliberately NO update/delete policy: the log is append-only. Admins read it for oversight but do not
-- rewrite it — an editable consent record is worth nothing.

comment on table legal_acceptances is
  'Client revision A-3: append-only record of which published legal document version each user accepted. Drives the re-agreement prompt via pending_legal_documents().';

-- ── What is this user still missing? ──────────────────────────────────────────
-- Returns the published documents the caller has not accepted — normally empty, one or two rows right
-- after the admin publishes a new version. SECURITY DEFINER only to read legal_documents + the caller's
-- own acceptances without tripping RLS recursion; it is scoped to auth.uid() and returns no other
-- user's data, so it is safe for `authenticated` to call.
create or replace function pending_legal_documents()
returns table (id uuid, doc_type legal_doc_type, version text)
language sql stable security definer set search_path = public as $$
  select d.id, d.type, d.version
    from legal_documents d
   where d.is_published
     and auth.uid() is not null
     and not exists (
       select 1 from legal_acceptances a
        where a.user_id = auth.uid()
          and a.legal_document_id = d.id
     )
   order by d.type
$$;

revoke execute on function pending_legal_documents() from public, anon;
grant execute on function pending_legal_documents() to authenticated;

-- ── Accept everything currently published ─────────────────────────────────────
-- One call rather than one per document: the prompt presents both docs together and the client asked to
-- "re-agree to everything", so a partial acceptance is not a state worth being able to reach.
-- Idempotent — re-accepting keeps the FIRST timestamp, because that is when the user actually agreed.
create or replace function accept_published_legal_documents() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into legal_acceptances (user_id, legal_document_id, doc_type, doc_version)
  select auth.uid(), d.id, d.type, d.version
    from legal_documents d
   where d.is_published
  on conflict (user_id, legal_document_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function accept_published_legal_documents() from public, anon;
grant execute on function accept_published_legal_documents() to authenticated;

-- ── New sign-ups ──────────────────────────────────────────────────────────────
-- Recorded in the trigger rather than from the client: at sign-up with email confirmation ON there is no
-- session yet, so the browser could not call the RPC, and a new user would be prompted to re-accept the
-- terms they had just ticked. `profiles.tos_accepted` already carries the checkbox — this simply writes
-- the matching acceptance rows. Everything else is migration 05 verbatim.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role user_role;
begin
  -- Only provision a profile when the signup declared a role. Programmatic/service-role
  -- user creation without a role (e.g. internal tooling) is left untouched.
  if meta ->> 'role' is null then
    return new;
  end if;
  v_role := (meta ->> 'role')::user_role;

  insert into profiles (
    id, role, first_name, last_name, phone,
    brokerage_id, lender_institution_id,
    is_approved, pending_approval,
    tos_accepted, tos_accepted_at, tos_version
  )
  values (
    new.id,
    v_role,
    coalesce(meta ->> 'first_name', ''),
    coalesce(meta ->> 'last_name', ''),
    meta ->> 'phone',
    case when v_role = 'broker' then (meta ->> 'brokerage_id')::uuid end,
    case when v_role = 'lender' then (meta ->> 'lender_institution_id')::uuid end,
    false,
    v_role = 'lender',                          -- lenders await manual admin approval
    coalesce((meta ->> 'tos_accepted')::boolean, false),
    case when (meta ->> 'tos_accepted')::boolean then now() end,
    meta ->> 'tos_version'
  );

  -- A-3: log the sign-up acceptance against every currently published document.
  if coalesce((meta ->> 'tos_accepted')::boolean, false) then
    insert into legal_acceptances (user_id, legal_document_id, doc_type, doc_version)
    select new.id, d.id, d.type, d.version
      from legal_documents d
     where d.is_published
    on conflict (user_id, legal_document_id) do nothing;
  end if;

  return new;
end $$;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every existing user agreed to the terms at sign-up (the sign-up form has always required the
-- checkbox), so recording that against the CURRENTLY published documents is the honest reading — and
-- the alternative is prompting the entire user base for something they already did. Timestamped from
-- the profile's creation, not now(), so the log does not claim they agreed today.
insert into legal_acceptances (user_id, legal_document_id, doc_type, doc_version, accepted_at)
select p.id, d.id, d.type, d.version, p.created_at
  from profiles p
 cross join legal_documents d
 where d.is_published
on conflict (user_id, legal_document_id) do nothing;
