-- Client revision 2026-07-25 (B-22): "When the offer is open (see below) the bps removed from the
-- offer should be 3 bps. Right now it's showing as 5 bps."
--
-- `product_years('open')` returns NULL because an open mortgage has no fixed term, so platform_bps_for
-- fell through to its `else 5` branch. That was Bubble parity and was recorded as OQ#30 ("'Open' has no
-- years → 5 bps, pending"). The client has now decided: an open term is billed like a term of 3 years
-- or less. **This settles OQ#30.**
--
-- ⚠️ This changes MONEY. platform_bps_for feeds accept_offer's invoice amount (loan_amount × bps),
-- invoices.platform_bps, and the "Final Commission Amount" preview in the Make Offer / auto-offer
-- dialogs. Existing invoices are NOT rewritten — they keep the bps they were issued with, which is
-- correct: an invoice is a record of what was billed.
--
-- The 3/4/5 table itself is unchanged and still matches the acknowledgement copy the client supplied in
-- B-26 ("3 bps for terms of 3 years or less, 4 bps for 4-year terms, 5 bps for 5 years or more").

create or replace function platform_bps_for(p mortgage_product) returns integer
language sql immutable set search_path = public as $$
  select case
    -- an open term has no product_years; the client bills it at the ≤3-year rate (B-22, settles OQ#30)
    when p = 'open' then 3
    when product_years(p) <= 3 then 3
    when product_years(p) = 4 then 4
    else 5
  end
$$;

comment on function platform_bps_for(mortgage_product) is
  'Platform fee in basis points by term: <=3y and OPEN -> 3, 4y -> 4, else 5. Open was 5 until the client decided otherwise on 2026-07-25 (B-22), which settled OQ#30.';
