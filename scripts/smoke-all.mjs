/**
 * Runs the whole smoke suite against local Supabase and prints a compact pass/fail summary.
 * Each smoke self-cleans, so the suite is re-runnable without a db reset. Exits non-zero if any fail.
 *
 *   node scripts/smoke-all.mjs            # (re)seed, then run every smoke
 *   node scripts/smoke-all.mjs --no-seed  # run the smokes against the current DB state
 *   pnpm smoke                            # same as the first form
 *
 * Note: smoke-invoice-pdf needs the edge-functions runtime (`pnpm supabase functions serve`). If it
 * fails with "Function not found", start the runtime and re-run — the rest of the suite is unaffected.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const noSeed = process.argv.includes("--no-seed")

// Seed first so the run is reproducible (all idempotent). Skipped with --no-seed.
const SEED = ["seed-users.mjs", "seed-maturing.mjs", "seed-admin.mjs"]

// Every smoke, roughly in dependency order (core slice/offer loop first, then feature areas).
const SMOKES = [
  "smoke-slice.mjs",
  "smoke-delete-draft.mjs",
  "smoke-offers.mjs",
  "smoke-auto-offer.mjs",
  "smoke-prequal.mjs",
  "smoke-doc-name-gate.mjs",
  "smoke-switch.mjs",
  "smoke-invoice-security.mjs",
  "smoke-admin-invoice-management.mjs",
  "smoke-anti-contact.mjs",
  "smoke-notifications.mjs",
  "smoke-expired.mjs",
  "smoke-open-filter.mjs",
  "smoke-open-filtered.mjs",
  "smoke-optional-transaction-type.mjs",
  "smoke-maturing.mjs",
  "smoke-decline.mjs",
  "smoke-blocking.mjs",
  "smoke-block-limit.mjs",
  "smoke-messages.mjs",
  "smoke-broker-enforcement.mjs",
  "smoke-signup.mjs",
  "smoke-admin.mjs",
  "smoke-faqs.mjs",
  "smoke-logos.mjs",
  "smoke-surveys.mjs",
  "smoke-penalty.mjs",
  "smoke-invoice-archive.mjs",
  "smoke-legal-reagreement.mjs",
  "smoke-password-reset.mjs",
  "smoke-invoice-pdf.mjs", // needs `supabase functions serve`
]

function run(script) {
  return spawnSync(process.execPath, [join(here, script)], { encoding: "utf8" })
}

async function main() {
  if (!noSeed) {
    process.stdout.write("Seeding… ")
    for (const s of SEED) {
      const r = run(s)
      if (r.status !== 0) {
        console.log(`\n✗ seed step ${s} failed:\n${r.stdout ?? ""}${r.stderr ?? ""}`)
        process.exit(1)
      }
    }
    console.log("done.\n")
  }

  const results = []
  for (const s of SMOKES) {
    const r = run(s)
    const ok = r.status === 0
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    // last non-empty line = the smoke's own summary
    const summary = out.trim().split("\n").filter(Boolean).pop() ?? ""
    results.push({ script: s, ok, out, summary })
    console.log(`${ok ? "✓" : "✗"}  ${s.padEnd(28)} ${summary}`)
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.log(`\n─── ${failed.length} smoke(s) FAILED — full output ───`)
    for (const f of failed) {
      console.log(`\n### ${f.script}\n${f.out.trim()}`)
    }
  }

  console.log(
    `\n${failed.length === 0 ? "✓ ALL SMOKES PASSED" : `✗ ${failed.length}/${results.length} SMOKE(S) FAILED`}` +
      ` (${results.length - failed.length}/${results.length} green)`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
