/**
 * Smoke for the New Deals ad-hoc server-side filtering (open_deals_filtered): criteria narrow the
 * open feed on the server, results stay a subset of the unfiltered feed and respect visibility
 * (lender_can_see_deal — e.g. expired deals never appear).
 *   node scripts/seed-users.mjs && node scripts/seed-maturing.mjs && node scripts/smoke-open-filtered.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { service } from "./_demo-lib.mjs"

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const PASSWORD = "Test1234!"

let failures = 0
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}
async function clientFor(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return c
}
const nums = (rows) => (rows ?? []).map((r) => r.deal_number).sort()

async function main() {
  const lender = await clientFor("lender@loanlink.test")

  // Baseline: no criteria = the full open feed; must agree with open_deals_for_lender(null).
  const { data: baseline, error: bErr } = await lender.rpc("open_deals_filtered", {})
  check("open_deals_filtered runs with no criteria", !bErr, bErr?.message)
  const { data: viaSaved } = await lender.rpc("open_deals_for_lender", {})
  check("no-criteria feed matches open_deals_for_lender", nums(baseline).join() === nums(viaSaved).join(),
    `${nums(baseline).length} vs ${nums(viaSaved).length}`)
  check("baseline feed is non-empty", (baseline?.length ?? 0) > 0, "seed open deals (seed-maturing) first")

  const baseNums = new Set(nums(baseline))

  // Province filter (single-value, matching the saved_filters criteria shape open_deals_filtered was
  // rebuilt around in migration 30). A seeded Ontario open deal (DEAL-2026-88) exists, so the result
  // must be NON-EMPTY — this guards against a silently-empty/errored RPC passing the "every row is
  // ontario" assertion vacuously — all Ontario, a subset of the feed, and never an expired deal.
  const { data: on, error: onErr } = await lender.rpc("open_deals_filtered", { p_province: "ontario" })
  check("province filter runs", !onErr, onErr?.message)
  check("province=ontario returns only ontario deals (non-empty)",
    (on ?? []).length > 0 && (on ?? []).every((r) => r.province === "ontario"),
    `${(on ?? []).length} rows`)
  check("filtered results are a subset of the feed", nums(on).every((n) => baseNums.has(n)))
  check("an expired deal never appears (visibility)", !baseNums.has("DEAL-2025-742"))

  // Product filter (single-value): a product present in the feed → all rows carry it, non-empty.
  const someProduct = baseline?.[0]?.mortgage_product
  if (someProduct) {
    const { data: byProd } = await lender.rpc("open_deals_filtered", { p_mortgage_product: someProduct })
    check("product filter returns only that product (non-empty)",
      (byProd ?? []).length > 0 && (byProd ?? []).every((r) => r.mortgage_product === someProduct))
  }

  // Loan floor beyond any deal → empty.
  const { data: none } = await lender.rpc("open_deals_filtered", { p_loan_amount_min: 1000000000000 })
  check("an out-of-range loan floor returns nothing", (none?.length ?? 0) === 0)

  // Combined criteria still a subset. Ontario + loan ≥ 1 matches the seeded Ontario open deal, so the
  // result must be NON-EMPTY — otherwise `[].every(...)` would pass this assertion vacuously (the exact
  // bug class that bit open_deals_filtered after migration 30; see CLAUDE.md testing note).
  const { data: combo } = await lender.rpc("open_deals_filtered", { p_province: "ontario", p_loan_amount_min: 1 })
  check("combined criteria stay a non-empty subset",
    (combo?.length ?? 0) > 0 && nums(combo).every((n) => baseNums.has(n)), `${combo?.length ?? 0} rows`)

  // ── Round 3 criteria (migration 43): flag one baseline deal via the service role, filter it out /
  // filter down to it, then restore the row exactly as found. Needs ≥2 open deals so the
  // exclusion-side results stay NON-EMPTY (never vacuous).
  const svc = service()
  const markNum = nums(baseline)[0]
  const { data: markRow } = await svc.from("deals")
    .select("id, reverse_mortgage, assets_liquid_value, no_lender_exceptions_required, gds, tds, acres, door_count, door_titles_count, amortization_years")
    .eq("deal_number", markNum).single()
  try {
    await svc.from("deals").update({
      reverse_mortgage: true, assets_liquid_value: 50000, no_lender_exceptions_required: true,
    }).eq("id", markRow.id)
    await svc.from("deal_credit_issues").insert({ deal_id: markRow.id, credit_issue: "active_bankruptcy" })

    // Exclude reverse mortgages (rides p_others_excluded) → the marked deal drops out, rest stays.
    const { data: noRev, error: revErr } = await lender.rpc("open_deals_filtered", {
      p_others_excluded: ["reverse_mortgage"],
    })
    check("exclude reverse_mortgage drops the flagged deal (non-empty rest)",
      !revErr && (noRev?.length ?? 0) > 0 && !nums(noRev).includes(markNum),
      revErr?.message ?? `${noRev?.length ?? 0} rows`)

    // Exclude a credit issue the marked deal carries → same shape.
    const { data: noBk } = await lender.rpc("open_deals_filtered", {
      p_credit_issues_excluded: ["active_bankruptcy"],
    })
    check("exclude a carried credit issue drops the flagged deal (non-empty rest)",
      (noBk?.length ?? 0) > 0 && !nums(noBk).includes(markNum), `${noBk?.length ?? 0} rows`)

    // Require-style criteria narrow TO the marked deal (others have null assets / unchecked box).
    const { data: liq } = await lender.rpc("open_deals_filtered", { p_assets_liquid_min: 1 })
    check("assets_liquid_min keeps only deals with enough liquid assets",
      nums(liq).includes(markNum) && (liq ?? []).length >= 1, `${liq?.length ?? 0} rows`)
    const { data: noExc } = await lender.rpc("open_deals_filtered", { p_require_no_exceptions: true })
    check("require_no_exceptions keeps the no-exceptions deal",
      nums(noExc).includes(markNum), `${noExc?.length ?? 0} rows`)

    // ── Dwelling type as an EXCLUSION list (migration 56; client A-1) ──────────
    const { data: markDwell } = await svc.from("deals").select("dwelling_type").eq("id", markRow.id).single()
    if (markDwell?.dwelling_type) {
      const { data: excluded, error: exErr } = await lender.rpc("open_deals_filtered", {
        p_dwelling_types_excluded: [markDwell.dwelling_type],
      })
      check("excluding a dwelling type drops that deal",
        !exErr && !nums(excluded).includes(markNum), exErr?.message ?? `${excluded?.length ?? 0} rows`)
      const { data: other } = await lender.rpc("open_deals_filtered", {
        p_dwelling_types_excluded: ["apartment_high_rise"],
      })
      check("excluding a DIFFERENT dwelling type keeps it", nums(other).includes(markNum))
    }
    // a deal with no dwelling type recorded is not one of the excluded types (null-safe, same rule as 54)
    await svc.from("deals").update({ dwelling_type: null }).eq("id", markRow.id)
    const { data: nullDwell } = await lender.rpc("open_deals_filtered", {
      p_dwelling_types_excluded: ["detached", "apartment_high_rise"],
    })
    check("a deal with NO dwelling type survives an exclusion list", nums(nullDwell).includes(markNum))
    await svc.from("deals").update({ dwelling_type: markDwell?.dwelling_type ?? null }).eq("id", markRow.id)

    // ── Null-safe MAX filters (migration 54; client A-15 + B-18/19/20) ──────────
    // `NULL <= 5` is NULL, not TRUE, so a max filter used to throw away every deal that simply had no
    // value for that field. A max is an exclusion tool: it must only drop deals that EXCEED it.
    await svc.from("deals").update({
      gds: null, tds: null, acres: null, door_count: null, door_titles_count: null,
      amortization_years: null,
    }).eq("id", markRow.id)

    for (const [label, params] of [
      ["gds_max", { p_gds_max: 40 }],
      ["tds_max", { p_tds_max: 40 }],
      ["acres_max", { p_acres_max: 5 }],
      ["max_doors", { p_max_doors: 2 }],
      ["max_door_titles", { p_max_door_titles: 2 }],
      ["amortization_max", { p_amortization_max: 25 }],
    ]) {
      const { data, error } = await lender.rpc("open_deals_filtered", params)
      check(`${label} KEEPS a deal whose value is null`,
        !error && nums(data).includes(markNum), error?.message ?? `${data?.length ?? 0} rows`)
    }

    // …and still excludes one that genuinely exceeds the max.
    await svc.from("deals").update({ door_count: 9, gds: 55 }).eq("id", markRow.id)
    const { data: overDoors } = await lender.rpc("open_deals_filtered", { p_max_doors: 2 })
    check("max_doors still drops a deal with MORE doors than allowed",
      !nums(overDoors).includes(markNum), `${overDoors?.length ?? 0} rows`)
    const { data: overGds } = await lender.rpc("open_deals_filtered", { p_gds_max: 40 })
    check("gds_max still drops a deal above the ceiling", !nums(overGds).includes(markNum))

    // 0 was never the broken case (`0 <= 2` is TRUE) — assert it anyway so nobody "fixes" it later.
    await svc.from("deals").update({ door_count: 0 }).eq("id", markRow.id)
    const { data: zeroDoors } = await lender.rpc("open_deals_filtered", { p_max_doors: 2 })
    check("max_doors keeps a deal with 0 doors", nums(zeroDoors).includes(markNum))
  } finally {
    await svc.from("deal_credit_issues").delete().eq("deal_id", markRow.id).eq("credit_issue", "active_bankruptcy")
    await svc.from("deals").update({
      reverse_mortgage: markRow.reverse_mortgage,
      assets_liquid_value: markRow.assets_liquid_value,
      no_lender_exceptions_required: markRow.no_lender_exceptions_required,
      gds: markRow.gds, tds: markRow.tds, acres: markRow.acres,
      door_count: markRow.door_count, door_titles_count: markRow.door_titles_count,
      amortization_years: markRow.amortization_years,
    }).eq("id", markRow.id)
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
