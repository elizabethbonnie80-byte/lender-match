// LenderMatch — anti-contact scan edge function (the "second layer").
//
// Anonymity holds until acceptance, so free-text written before acceptance may not contain contact
// info. Enforcement is layered:
//   • DB (migration 12): scan_contact_info + scan_and_log (regex) + block-before-persist triggers.
//   • This function: orchestrates the DETERMINISTIC layer (reuses scan_and_log so the regex result and
//     its admin_alert stay identical to the DB) and then applies the Claude second layer whenever the
//     text is regex-clean and longer than MIN_AI_LEN (see the note there — it was 20, from Bubble,
//     which silently exempted bare names; the client reported exactly that case on 2026-07-28).
//
// The frontend should call this function instead of the scan_and_log RPC once it is deployed WITH the
// ANTHROPIC_API_KEY secret set. Until then the client calls scan_and_log directly (regex only) and the
// triggers remain the hard backstop, so nothing regresses when the key is absent.
//
// Deploy:  supabase functions deploy anti-contact
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (NEVER commit the key)

import { createClient } from "npm:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const MODEL = "claude-haiku-4-5-20251001" // cheap, fast — this is a binary classification
// Client 2026-07-28 (B-16): "the AI only catches it if it says 'My name is'" — not the real cause. The
// model catches free-standing third-party names fine ("Please reach out to Rick McDonald about this
// file" → blocked); what it never saw was SHORT text. This gate was 20, inherited from Bubble
// (docs/extracted/flows.md:220), and a bare name is under it: "Rick McDonald" is 13 characters, so the
// exact case they reported returned clean without a model call.
//
// Now only long enough to skip acknowledgements ("ok", "thanks", "got it", "sounds good"), which carry
// no identity and are the only reason a floor exists at all. A name is at least a few characters, so
// this reaches every case they asked for. The cost is one Haiku call on short messages — the model is
// capped at 128 output tokens and the regex layer still short-circuits before it.
const MIN_AI_LEN = 4

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Body = { text?: string; source?: string; deal_id?: string | null }

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

/** Claude second layer: catches obfuscations regex misses (spelled-out digits, coded handles, "reach
 *  me off-platform", etc.). Returns a short reason when it detects contact-sharing, else null. */
async function aiDetect(text: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null // no key → skip AI layer (regex already ran)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 128,
      system:
        "You screen messages on an ANONYMOUS mortgage marketplace where brokers and lenders must not " +
        "share identifying or contact information until a deal is accepted. Decide whether the message " +
        "contains, or attempts to share, any contact/identifying info: email, phone number, external " +
        "URL or domain, a person's or company's name, a social handle, or any attempt to move the " +
        "conversation off-platform (including obfuscations like spelled-out digits or 'reach me " +
        "elsewhere'). Reply with ONLY minified JSON and NOTHING else — no markdown, no code fences, no " +
        "prose: {\"contact\":boolean,\"reason\":string}. " +
        "reason is a short noun phrase like 'a phone number' or 'an email address' (empty if contact is false).",
      messages: [{ role: "user", content: text }],
    }),
  })
  if (!res.ok) {
    console.error("[anti-contact] Claude API error", res.status, await res.text())
    return null // fail-open on the AI layer; the regex layer + triggers still protect the invariant
  }
  const data = await res.json()
  const raw = data?.content?.[0]?.text ?? "{}"
  // Models (esp. newer ones) sometimes wrap the JSON in a ```json code fence or add prose despite the
  // instruction — extract the first {...} object before parsing so a well-formed answer isn't dropped.
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(match ? match[0] : raw)
    return parsed?.contact ? String(parsed.reason || "contact information") : null
  } catch {
    console.error("[anti-contact] could not parse model output:", raw)
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json(405, { error: "method not allowed" })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json(401, { error: "missing authorization" })

  const { text, source, deal_id }: Body = await req.json().catch(() => ({}))
  const trimmed = (text ?? "").trim()
  if (!trimmed || !source) return json(200, { clean: true }) // nothing to scan

  // User-scoped client: preserves auth.uid() so scan_and_log uses the caller's own name + records the
  // alert against them, exactly as the direct-RPC path does.
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json(401, { error: "invalid session" })

  // Layer 1 — deterministic regex (also logs the admin_alert on a hit; identical to the DB path).
  const { data: regexReason, error: rpcErr } = await userClient.rpc("scan_and_log", {
    p_text: trimmed,
    p_source: source,
    p_deal_id: deal_id ?? undefined,
  })
  if (rpcErr) return json(400, { error: rpcErr.message })
  if (regexReason) return json(200, { clean: false, reason: regexReason, layer: "regex" })

  // Layer 2 — Claude, only when regex-clean and long enough to be worth a model call.
  if (trimmed.length <= MIN_AI_LEN) return json(200, { clean: true })
  const aiReason = await aiDetect(trimmed)
  if (!aiReason) return json(200, { clean: true })

  // AI hit → record the alert with detection='ai' using the service role (admin_alerts is admin-only).
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  await service.from("admin_alerts").insert({
    user_id: user.id,
    flagged_content: trimmed,
    source,
    detection: "ai",
    deal_id: deal_id ?? null,
  })
  return json(200, { clean: false, reason: aiReason, layer: "ai" })
})
