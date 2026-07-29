-- Client answers 2026-07-28, follow-up (A-25). They first said "invoices can be deleted after 1 calendar
-- year"; we flagged that deletion is irreversible and that accounting records are normally kept longer.
-- Their revised answer, verbatim:
--
--   "If we can archive the invoices without causing any issues with the website, as in taking up too much
--    space/storage, or slowing the website down, then we would like to archive the paid invoices for 7yrs
--    if possible. After that, they can be deleted."
--
-- ⚠️ AMBIGUITY, resolved conservatively and flagged back to them: "archive the paid invoices for 7yrs"
-- does not say WHEN a paid invoice enters the archive. Two readings — archive as soon as it is paid, or
-- archive after the 1 year from their earlier message. We take the SECOND, because it keeps recently
-- paid invoices where the admin can already see them and only files away the old ones, i.e. the reading
-- that hides less data. Both thresholds are single literals in the two functions below, so switching to
-- "archive on payment" is a one-line change if they say otherwise.
--
-- Timeline per invoice:  paid  ──1 year──▶  archived  ──7 years from paid──▶  deleted (row + PDF)
--
-- Archiving is a FLAG, not a move: no second table, no data rewritten. The admin Invoices page filters
-- on it, so archived invoices simply stop cluttering the default list and remain fully readable under an
-- "Archived" filter. Lenders were already unaffected — client revision A-24/B-28 limited their invoice
-- list to Pending and Overdue, so paid invoices never appeared there.

alter table invoices add column if not exists archived_at timestamptz;

comment on column invoices.archived_at is
  'Client 2026-07-28 (A-25): set by job_archive_paid_invoices 1 year after payment. A flag only — the row stays in place and stays admin-readable. Deleted (row + Storage PDF) 7 years after payment by the purge-invoices edge function.';

-- The admin list's default view is "not archived", and the purge scans by archived_at — both want this.
create index if not exists invoices_archived_idx on invoices (archived_at) where archived_at is not null;

-- ── Archive: paid, and paid more than 1 year ago ───────────────────────────────
-- Keyed off paid_at, not created_at: the retention clock the client cares about starts at payment.
-- Invoices marked paid before paid_at was being written (Bubble parity note OQ#12) fall back to
-- updated_at so a null can never make a row immortal.
create or replace function job_archive_paid_invoices() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update invoices
     set archived_at = now(), updated_at = now()
   where status = 'paid'
     and archived_at is null
     and coalesce(paid_at, updated_at) < now() - interval '1 year';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Purge: archived, and paid more than 7 years ago ───────────────────────────
-- Returns the rows for the edge function to delete, because the PDF bytes live in Storage and only the
-- API can remove them — same split as documents_to_purge() (migration 52). Deleting the row here would
-- orphan the object forever.
--
-- ⚠️ revoke from PUBLIC, not just anon/authenticated: Postgres grants EXECUTE to PUBLIC on every new
-- function, so those roles inherit it and a narrower revoke is a no-op. This is Security invariant #6 —
-- it is the exact bug documents_to_purge() shipped with.
create or replace function invoices_to_purge()
returns table (id uuid, pdf_path text)
language sql stable security definer set search_path = public as $$
  select i.id, i.pdf_path
    from invoices i
   where i.archived_at is not null
     and coalesce(i.paid_at, i.updated_at) < now() - interval '7 years'
$$;

revoke execute on function invoices_to_purge() from public, anon, authenticated;
grant execute on function invoices_to_purge() to service_role;

comment on function invoices_to_purge() is
  'Client 2026-07-28 (A-25): archived invoices past the 7-year retention, for the purge-invoices edge function to delete (row + Storage PDF). Service-role only — it spans every lender''s billing history.';

-- ── Schedules ─────────────────────────────────────────────────────────────────
-- Monthly, not daily: both thresholds move in years, so a daily scan would be pure noise. The purge is
-- driven from the edge function (it needs Storage), wired the same way as purge_expired_documents —
-- GUC → Vault, so it no-ops until the deployment sets purge_invoices_url.
select cron.schedule('archive_paid_invoices', '0 3 1 * *', $$select job_archive_paid_invoices()$$);

create or replace function job_purge_archived_invoices() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  -- Same GUC-then-Vault lookup as tg_notify_email (migration 33): the app.* GUCs cannot be set on
  -- hosted Supabase, so hosted reads the Vault. Absent config = no-op, never an error.
  v_url := coalesce(
    nullif(current_setting('app.purge_invoices_url', true), ''),
    (select decrypted_secret from vault.decrypted_secrets where name = 'purge_invoices_url')
  );
  v_key := coalesce(
    nullif(current_setting('app.service_role_key', true), ''),
    (select decrypted_secret from vault.decrypted_secrets where name = 'notify_service_role_key')
  );
  if v_url is null or v_key is null then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
  );
exception when others then
  raise warning 'job_purge_archived_invoices: dispatch failed: %', sqlerrm;
end $$;

select cron.schedule('purge_archived_invoices', '30 3 1 * *', $$select job_purge_archived_invoices()$$);
