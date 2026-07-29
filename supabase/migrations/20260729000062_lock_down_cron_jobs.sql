-- Security fix: the pg_cron job functions were callable by any signed-in user.
--
-- Found while checking the advisors after the 57-61 deploy. Every job_* function is SECURITY DEFINER with
-- no internal guard, and Postgres grants EXECUTE to PUBLIC on every new function — so `anon` and
-- `authenticated` inherited it and nothing ever revoked it. Verified against the local DB with a lender
-- session: 8 of the 9 were callable.
--
-- This is Security invariant #6 for the third time in this project (after documents_to_purge in migration
-- 52 and invoices_to_purge in 60, both of which name `public` in their revoke). Pre-existing since
-- migration 04 for seven of these; the two invoice jobs added in migration 60 inherited the same pattern.
--
-- Impact was moderate, not an escalation: no privilege gain and no data exposure, only the ability to run
-- a scheduled maintenance action early. The ones that mattered:
--   • job_purge_expired_documents / job_purge_archived_invoices — dispatch the destructive purges. They
--     only remove material already past retention, but an unauthenticated trigger of a delete is not
--     something to leave open.
--   • job_expire_old_deals / job_archive_expired_deals — expire or archive deals and notify brokers.
--   • job_auto_offer_digest — sends notifications, so a spam lever.
--   • job_trigger_closing_surveys / job_apply_rating_penalties — create surveys / recompute the penalty
--     flag. Deterministic, so little to gain, but still unauthorized writes.
-- job_reset_monthly_switches was already blocked in practice, and NOT by its grant: the
-- profiles_privilege_guard trigger refuses changes to offer_switches_this_month unless is_admin(). Useful
-- to know that defence-in-depth held, and equally that it is the only reason it held.
--
-- The cron scheduler runs these as the role that scheduled them (postgres), which keeps its own explicit
-- grant, and the purge dispatchers reach their edge functions with the service-role key. So nothing that
-- is supposed to call these loses access.
--
-- ⚠️ RULE FOR NEW JOB FUNCTIONS: a job_* function must be revoked from `public` in the same migration
-- that creates it. `revoke ... from anon, authenticated` alone is a no-op.

revoke execute on function job_expire_old_deals()        from public, anon, authenticated;
revoke execute on function job_archive_expired_deals()   from public, anon, authenticated;
revoke execute on function job_trigger_closing_surveys() from public, anon, authenticated;
revoke execute on function job_reset_monthly_switches()  from public, anon, authenticated;
revoke execute on function job_apply_rating_penalties()  from public, anon, authenticated;
revoke execute on function job_auto_offer_digest()       from public, anon, authenticated;
revoke execute on function job_purge_expired_documents() from public, anon, authenticated;
revoke execute on function job_archive_paid_invoices()   from public, anon, authenticated;
revoke execute on function job_purge_archived_invoices() from public, anon, authenticated;

-- Keep the service role able to run them: `pnpm smoke` drives several of these directly to test the
-- scheduled behaviour, and so does any manual operational re-run.
grant execute on function job_expire_old_deals()        to service_role;
grant execute on function job_archive_expired_deals()   to service_role;
grant execute on function job_trigger_closing_surveys() to service_role;
grant execute on function job_reset_monthly_switches()  to service_role;
grant execute on function job_apply_rating_penalties()  to service_role;
grant execute on function job_auto_offer_digest()       to service_role;
grant execute on function job_purge_expired_documents() to service_role;
grant execute on function job_archive_paid_invoices()   to service_role;
grant execute on function job_purge_archived_invoices() to service_role;
