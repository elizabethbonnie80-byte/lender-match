-- Client answers 2026-07-28, follow-up (B-4): the rating penalty must key off the TURN-TIME answers, not
-- overall satisfaction. Verbatim:
--
--   "Yes, please key the penalty off the turn-time answers. So please include both of the 2 turn-time
--    questions, and if either one of those two questions gets 4 no's within the last 10 surveys, the
--    penalty would apply."
--
-- This replaces migration 04's rule (avg(satisfaction) < 3 over the last 5 completed surveys), which
-- came from the simplified scope; their May 4 document had always said turn time. The EFFECT is
-- unchanged and stays where it is — lender_can_see_deal() + the admin-configurable 45d/14d windows
-- (migrations 23/26) — so only the trigger moves.
--
-- Two judgement calls, both recorded because the wording does not settle them:
--
--  1. WHICH surveys make up "the last 10". The two turn-time questions only exist on a survey where the
--     deal closed with the lender (submit_survey nulls them otherwise), so a not-closed survey carries no
--     turn-time signal. Counting it toward the window would let a lender dilute the sample with deals
--     that never closed. The window is therefore the last 10 completed surveys that HAVE turn-time
--     answers.
--  2. NO MINIMUM sample size. Migration 04 needed `cnt >= 5` because an average over one survey is
--     noise; an absolute count of 4 cannot trigger on fewer than 4 surveys, so the floor is implicit.
--
-- Note the two counts are independent: 4 late commitments OR 4 late document reviews each trigger on
-- their own. A lender with 3 of each is NOT penalized, which is what "either one of those two questions
-- gets 4 no's" says.

create or replace function job_apply_rating_penalties() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with recent as (
    -- The last 10 rated surveys per lender, newest first.
    select s.lender_id, s.commitment_on_time, s.doc_review_on_time,
           row_number() over (partition by s.lender_id order by s.completed_at desc) rn
    from surveys s
    where s.is_completed
      and s.commitment_on_time is not null
      and s.doc_review_on_time is not null
  ),
  tallies as (
    select lender_id,
           count(*) filter (where not commitment_on_time) as commitment_no,
           count(*) filter (where not doc_review_on_time) as doc_review_no
    from recent
    where rn <= 10
    group by lender_id
  ),
  verdicts as (
    select lender_id, (commitment_no >= 4 or doc_review_no >= 4) as penalize
    from tallies
  )
  update profiles p
     set penalty_active = v.penalize
    from verdicts v
   where p.id = v.lender_id
     and p.penalty_active is distinct from v.penalize;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function job_apply_rating_penalties() is
  'Weekly recompute of profiles.penalty_active. Client 2026-07-28 (B-4): a lender is penalized when EITHER turn-time question was answered "no" 4+ times across their last 10 rated surveys. Superseded the original avg(satisfaction) < 3 over 5 rule.';
