/**
 * Smoke for the Round 3 Phase 3 Prequal → Live Deal flow (migration 48).
 *
 * Confirmed client rules: lenders bid on a prequal, then the broker's "Move to Live Deal" adds the
 * address + closing date (+ COF) — existing offers carry over and stay acceptable, and the deal does
 * NOT re-enter the lender marketplace afterwards. Plus the two data-layer guards this flow implies:
 * a deal with no property address can only be SUBMITTED as a prequal (OQ#41 / client feedback #7),
 * and an offer cannot be ACCEPTED while the deal is still an unconverted prequal (the invoice needs
 * a closing date).
 *
 *   node scripts/seed-users.mjs && node scripts/smoke-prequal.mjs
 */
import { service, signIn, idByEmail, ensureApprovedLender, attachDealDocuments } from "./_demo-lib.mjs"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

async function main() {
  const svc = service()
  const brokerId = await idByEmail(svc, "broker@loanlink.test")
  const lenderId = await idByEmail(svc, "lender@loanlink.test")
  if (!brokerId || !lenderId) throw new Error("Seed the test users first (pnpm seed).")
  const { data: bp } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).single()
  // a second approved lender, to prove a converted prequal never reaches someone who did not bid
  await ensureApprovedLender(svc, { email: "lender2@loanlink.test", first: "Leah", last: "Nguyen", institution: "RFA" })

  const broker = await signIn("broker@loanlink.test")
  const lender = await signIn("lender@loanlink.test")
  const lender2 = await signIn("lender2@loanlink.test")

  const created = []

  /** A draft with everything a submit needs except the property address / closing date. */
  async function makeDraft({ prequal = true, address = null, closingDate = null } = {}) {
    const { data: d, error } = await broker.from("deals").insert({
      broker_id: brokerId, brokerage_id: bp.brokerage_id, status: "draft",
      loan_amount: 520000, property_value: 650000, ltv: 80,
      mortgage_product: "5_year_fixed", province: "ontario", transaction_type: "prime",
      city: "Kingston", prequal, closing_date: closingDate,
    }).select("id").single()
    if (error) throw new Error(`insert draft: ${error.message}`)
    created.push(d.id)
    await broker.from("deal_identities").insert({
      deal_id: d.id, borrower_first_name: "Pre", borrower_last_name: "Qual", property_address: address,
    })
    await attachDealDocuments(broker, d.id)
    return d.id
  }
  const inFeed = async (client, dealId) => {
    const { data } = await client.rpc("open_deals_for_lender", {})
    return (data ?? []).some((r) => r.id === dealId)
  }

  try {
    // ── 1. The submit gate: no address ⇒ must be a prequal ──
    const noAddress = await makeDraft({ prequal: false })
    const { error: subErr } = await broker.rpc("submit_deal", { p_deal_id: noAddress })
    check("submit REFUSED: no address and not a prequal", !!subErr, subErr?.message)
    check("the refusal names the fix", /prequal/i.test(subErr?.message ?? ""), subErr?.message)

    await broker.from("deals").update({ prequal: true }).eq("id", noAddress)
    const { error: subOk } = await broker.rpc("submit_deal", { p_deal_id: noAddress })
    check("submit ALLOWED once flagged as a prequal", !subOk, subOk?.message)

    // ── 2. Lenders see the prequal and can bid on it ──
    const prequalDeal = noAddress
    check("prequal is in the lender's New Deals feed", await inFeed(lender, prequalDeal))
    check("the other lender sees it too", await inFeed(lender2, prequalDeal))

    const { data: offer, error: offErr } = await lender.rpc("make_offer", {
      p_deal_id: prequalDeal, p_mortgage_product: "5_year_fixed", p_rate: 5.05,
      p_rate_lock_days: 120, p_commission_bps: 40,
    })
    check("lender bids on the prequal", !offErr && !!offer, offErr?.message)

    // ── 3. Acceptance is blocked until the deal is live (the invoice needs a closing date) ──
    const { error: earlyAccept } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
    check("accept REFUSED while still a prequal", !!earlyAccept, earlyAccept?.message)
    const { data: stillPending } = await svc.from("offers").select("status").eq("id", offer.id).single()
    check("the offer is untouched by the refused accept", stillPending?.status === "pending")
    const { count: invCount } = await svc.from("invoices").select("id", { count: "exact", head: true }).eq("deal_id", prequalDeal)
    check("no invoice was created", (invCount ?? 0) === 0)

    // ── 4. Conversion guards ──
    const { error: notMine } = await lender.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "1 Hijack Rd", p_closing_date: "2026-12-01",
    })
    check("a non-owner cannot convert the deal", !!notMine, notMine?.message)

    const { error: noAddr } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "   ", p_closing_date: "2026-12-01",
    })
    check("conversion needs a property address", !!noAddr, noAddr?.message)

    const { error: noClose } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "18 King St E, Kingston, ON", p_closing_date: null,
    })
    check("conversion needs a closing date", !!noClose, noClose?.message)

    // ── 5. The conversion itself ──
    const { error: convErr } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal,
      p_property_address: "18 King St E, Kingston, ON K7L 3A2",
      p_closing_date: "2026-12-01",
      p_cof_date: "2026-11-20",
    })
    check("broker moves the prequal to a live deal", !convErr, convErr?.message)

    const { data: live } = await svc.from("deals")
      .select("prequal, prequal_converted_at, closing_date, cof_date, status").eq("id", prequalDeal).single()
    check("prequal flag cleared + conversion stamped", live?.prequal === false && !!live?.prequal_converted_at)
    check("closing + COF dates written", live?.closing_date === "2026-12-01" && live?.cof_date === "2026-11-20")
    const { data: ident } = await svc.from("deal_identities").select("property_address").eq("deal_id", prequalDeal).single()
    check("property address written to deal_identities", /18 King St E/.test(ident?.property_address ?? ""))

    // Offers carry over untouched, and the lender is told (without the address leaking).
    const { data: carried } = await svc.from("offers").select("status, rate").eq("id", offer.id).single()
    check("the prequal offer carried over unchanged", carried?.status === "pending" && Number(carried.rate) === 5.05)
    const { data: notes } = await svc.from("notifications")
      .select("type, body").eq("recipient_id", lenderId).eq("deal_id", prequalDeal).eq("type", "prequal_converted")
    check("bidding lender notified of the conversion", (notes ?? []).length === 1)
    check("the notification leaks no address", !/King St/.test(notes?.[0]?.body ?? ""), notes?.[0]?.body)

    // ── 6. No marketplace re-entry ──
    check("converted deal is gone from the other lender's feed", !(await inFeed(lender2, prequalDeal)))
    const { data: seenByOther } = await lender2.from("deals").select("id").eq("id", prequalDeal)
    check("the other lender cannot read the deal row either", (seenByOther ?? []).length === 0)
    const { error: lateBid } = await lender2.rpc("make_offer", {
      p_deal_id: prequalDeal, p_mortgage_product: "5_year_fixed", p_rate: 4.99,
      p_rate_lock_days: 90, p_commission_bps: 35,
    })
    check("a lender who never bid cannot bid after conversion", !!lateBid, lateBid?.message)
    const { data: seenByBidder } = await lender.from("deals").select("id").eq("id", prequalDeal)
    check("the bidding lender still sees their deal", (seenByBidder ?? []).length === 1)

    // ── 7. Converting twice is refused; the carried-over offer is now acceptable ──
    const { error: twice } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: prequalDeal, p_property_address: "18 King St E", p_closing_date: "2026-12-05",
    })
    check("a converted deal cannot be converted again", !!twice, twice?.message)

    const { error: acceptErr } = await broker.rpc("accept_offer", { p_offer_id: offer.id })
    check("the carried-over offer is acceptable once live", !acceptErr, acceptErr?.message)
    const { data: inv } = await svc.from("invoices").select("closing_date, due_date, amount").eq("deal_id", prequalDeal).maybeSingle()
    check("invoice generated off the new closing date", inv?.closing_date === "2026-12-01" && inv?.due_date === "2026-12-22",
      `${inv?.closing_date} / ${inv?.due_date}`)

    // ── 8. A live (non-prequal) deal cannot be run through the conversion ──
    const liveDeal = await makeDraft({ prequal: false, address: "9 Main St, Kingston, ON", closingDate: "2026-12-15" })
    await broker.rpc("submit_deal", { p_deal_id: liveDeal })
    const { error: notPrequal } = await broker.rpc("convert_prequal_to_live", {
      p_deal_id: liveDeal, p_property_address: "9 Main St", p_closing_date: "2026-12-15",
    })
    check("a normal deal is rejected by convert_prequal_to_live", !!notPrequal, notPrequal?.message)

    // ── 9. Client 2026-07-27: a prequal expires for LENDERS (15 days) but not for the BROKER ──
    const aged = await makeDraft({ prequal: true })
    await broker.rpc("submit_deal", { p_deal_id: aged })
    check("fresh prequal is visible to lenders", await inFeed(lender2, aged))
    // the first lender bids, so we can prove a bidder keeps access past the window
    const { data: agedOffer } = await lender.rpc("make_offer", {
      p_deal_id: aged, p_mortgage_product: "5_year_fixed", p_rate: 5.1,
      p_rate_lock_days: 90, p_commission_bps: 30,
    })

    const backdate = (days) => new Date(Date.now() - days * 86_400_000).toISOString()
    await svc.from("deals").update({ created_at: backdate(16) }).eq("id", aged)

    check("past 15 days the prequal leaves the lender feed", !(await inFeed(lender2, aged)))
    const { data: agedRow } = await lender2.from("deals").select("id").eq("id", aged)
    check("a lender who never bid cannot read it either", (agedRow ?? []).length === 0)
    const { error: agedBid } = await lender2.rpc("make_offer", {
      p_deal_id: aged, p_mortgage_product: "5_year_fixed", p_rate: 4.9,
      p_rate_lock_days: 90, p_commission_bps: 30,
    })
    check("and cannot bid on it", !!agedBid, agedBid?.message)
    const { data: agedByBidder } = await lender.from("deals").select("id").eq("id", aged)
    check("the lender who already bid keeps access", (agedByBidder ?? []).length === 1)
    const { data: bidderOffer } = await svc.from("offers").select("status").eq("id", agedOffer.id).single()
    check("their offer is untouched", bidderOffer?.status === "pending")

    // The broker side: still active, NOT expired, and told exactly once.
    const { data: expiredCount } = await svc.rpc("job_expire_old_deals")
    const { data: afterJob } = await svc.from("deals")
      .select("status, expired_at, prequal_lender_notice_at").eq("id", aged).single()
    // it holds an offer, so the live status is offer_received — the point is that it is NOT expired
    check("the expiry job leaves the prequal active for the broker",
      ["submitted", "offer_received"].includes(afterJob?.status),
      `status=${afterJob?.status} expired_at=${afterJob?.expired_at}`)
    check("no expired_at stamped on the prequal", afterJob?.expired_at === null)
    check("the broker was told the lender window closed", !!afterJob?.prequal_lender_notice_at)
    const { data: brokerVisible } = await broker.from("deals").select("id").eq("id", aged)
    check("the broker still sees their prequal", (brokerVisible ?? []).length === 1)
    const noticeRows = async () => {
      const { data } = await svc.from("notifications")
        .select("body").eq("recipient_id", brokerId).eq("deal_id", aged).eq("type", "deal_expired")
      return data ?? []
    }
    const firstNotice = await noticeRows()
    check("exactly one notice was sent", firstNotice.length === 1, `${firstNotice.length}`)
    check("the notice says the file stays in the Deal Room", /Deal Room/i.test(firstNotice[0]?.body ?? ""),
      firstNotice[0]?.body)
    await svc.rpc("job_expire_old_deals")
    check("running the job again does not re-notify", (await noticeRows()).length === 1)

    // Control: a backdated LIVE deal still expires the old way.
    const agedLive = await makeDraft({ prequal: false, address: "4 Elm St, Kingston, ON", closingDate: "2026-12-20" })
    await broker.rpc("submit_deal", { p_deal_id: agedLive })
    await svc.from("deals").update({ created_at: backdate(16) }).eq("id", agedLive)
    await svc.rpc("job_expire_old_deals")
    const { data: liveAged } = await svc.from("deals").select("status, expired_at").eq("id", agedLive).single()
    check("a live deal past 15 days still expires", liveAged?.status === "expired" && !!liveAged?.expired_at,
      `status=${liveAged?.status}`)
    check("job_expire_old_deals reports a count", typeof expiredCount === "number", `${expiredCount}`)

    // ── 10. Client 2026-07-27: document retention no longer keys off closing_date alone ──
    const purgeIds = async () => {
      const { data, error } = await svc.rpc("documents_to_purge")
      if (error) throw new Error(`documents_to_purge: ${error.message}`)
      return new Set((data ?? []).map((r) => r.id))
    }
    const docIdsFor = async (dealId) => {
      const { data } = await svc.from("deal_documents").select("id").eq("deal_id", dealId)
      return (data ?? []).map((r) => r.id)
    }
    /** A submitted deal + documents, with the deal's closing date and the docs' upload date forced. */
    async function docCase({ closingDate, uploadedDaysAgo }) {
      const id = await makeDraft({ prequal: !closingDate, address: closingDate ? "7 Oak St, Kingston, ON" : null, closingDate })
      await broker.rpc("submit_deal", { p_deal_id: id })
      await svc.from("deal_documents").update({ created_at: backdate(uploadedDaysAgo) }).eq("deal_id", id)
      return id
    }
    const isoDay = (days) => backdate(days).slice(0, 10)

    const closedLongAgo = await docCase({ closingDate: isoDay(121), uploadedDaysAgo: 130 })
    const closedRecently = await docCase({ closingDate: isoDay(100), uploadedDaysAgo: 130 })
    const prequalOld = await docCase({ closingDate: null, uploadedDaysAgo: 121 })
    const prequalFresh = await docCase({ closingDate: null, uploadedDaysAgo: 10 })
    // the 240-day ceiling: closing date far in the future, so leg 1 and leg 2 both say "keep"
    const ceiling = await docCase({ closingDate: "2027-12-01", uploadedDaysAgo: 241 })
    const ceilingUnder = await docCase({ closingDate: "2027-12-01", uploadedDaysAgo: 200 })

    const due = await purgeIds()
    const allIn = async (dealId) => (await docIdsFor(dealId)).every((i) => due.has(i))
    const noneIn = async (dealId) => (await docIdsFor(dealId)).every((i) => !due.has(i))
    check("120+ days after the closing date → purge", await allIn(closedLongAgo))
    check("100 days after closing → keep", await noneIn(closedRecently))
    check("no closing date, uploaded 121 days ago → purge", await allIn(prequalOld))
    check("no closing date, uploaded 10 days ago → keep", await noneIn(prequalFresh))
    check("241 days after upload → purge even with a future closing date", await allIn(ceiling))
    check("200 days after upload with a future closing date → keep", await noneIn(ceilingUnder))

    const { error: brokerPurge } = await broker.rpc("documents_to_purge")
    check("documents_to_purge is not callable by a broker", !!brokerPurge, brokerPurge?.message)
    const { error: lenderPurge } = await lender.rpc("documents_to_purge")
    check("nor by a lender", !!lenderPurge, lenderPurge?.message)
  } finally {
    for (const id of created) {
      await svc.from("invoices").delete().eq("deal_id", id)
      await svc.from("surveys").delete().eq("deal_id", id)
      await svc.from("deal_identities").delete().eq("deal_id", id)
      await svc.from("deals").delete().eq("id", id)
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
