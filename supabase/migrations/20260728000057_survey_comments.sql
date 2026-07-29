-- Client answers 2026-07-28 (B-3): the closing survey needs a free-text comments field, and the admin
-- needs to read it. The admin side already exists (the survey report / listSurveyReport), so this adds
-- the column and threads it through submit_survey.
--
-- The comments are broker → PLATFORM ADMIN only: they are never shown to the lender being rated, and
-- `surveys` has no lender-facing policy. So this text is deliberately NOT run through the anti-contact
-- scan — that guard exists to keep broker and lender from identifying each other, and there is no
-- counterparty here. (`not_closed_reason` is free text on the same table for the same reason.)

alter table surveys add column if not exists comments text;

-- Same signature plus a trailing optional p_comments, so existing callers keep working. Kept as CREATE
-- OR REPLACE with a default: adding a defaulted trailing parameter to a plpgsql function does not need a
-- DROP (the return type is unchanged), but it DOES create a second overload if the arg list differs, so
-- the old 7-arg form is dropped explicitly below.
create or replace function submit_survey(
  p_survey_id uuid,
  p_closed_with_lender boolean,
  p_commitment_on_time boolean default null,
  p_doc_review_on_time boolean default null,
  p_funded_on_time boolean default null,
  p_satisfaction smallint default null,
  p_not_closed_reason text default null,
  p_comments text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_broker uuid;
begin
  select broker_id into v_broker from surveys where id = p_survey_id and not is_completed;
  if v_broker is null then
    raise exception 'survey not found or already completed';
  end if;
  if v_broker <> auth.uid() then
    raise exception 'only the deal broker can complete this survey';
  end if;

  if p_closed_with_lender then
    if p_satisfaction is null or p_satisfaction < 1 or p_satisfaction > 5 then
      raise exception 'satisfaction (1-5) is required when the deal closed with the lender';
    end if;
    update surveys set
      closed_with_lender = true,
      commitment_on_time = p_commitment_on_time,
      doc_review_on_time = p_doc_review_on_time,
      funded_on_time     = p_funded_on_time,
      satisfaction       = p_satisfaction,
      not_closed_reason  = null,
      comments           = nullif(btrim(coalesce(p_comments, '')), ''),
      is_completed       = true,
      completed_at       = now()
    where id = p_survey_id;
  else
    update surveys set
      closed_with_lender = false,
      commitment_on_time = null,
      doc_review_on_time = null,
      funded_on_time     = null,
      satisfaction       = null,
      not_closed_reason  = p_not_closed_reason,
      comments           = nullif(btrim(coalesce(p_comments, '')), ''),
      is_completed       = true,
      completed_at       = now()
    where id = p_survey_id;
  end if;
end $$;

-- Drop the superseded 7-arg overload: leaving it would make submit_survey(...) ambiguous for callers
-- that omit the trailing arguments, and PostgREST would pick by name anyway.
drop function if exists submit_survey(uuid, boolean, boolean, boolean, boolean, smallint, text);

revoke execute on function submit_survey(uuid, boolean, boolean, boolean, boolean, smallint, text, text) from anon;
grant execute on function submit_survey(uuid, boolean, boolean, boolean, boolean, smallint, text, text) to authenticated;
