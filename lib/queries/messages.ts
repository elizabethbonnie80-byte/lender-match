import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

type DB = SupabaseClient<Database>
type UserRole = Database["public"]["Enums"]["user_role"]
type DealStatus = Database["public"]["Enums"]["deal_status"]

export type ChatThread = {
  chatId: string
  dealId: string
  dealNumber: string
  dealStatus: DealStatus
  iAmBroker: boolean
  counterparty: string // anonymized label — never a name
  lastMessage: string | null
  lastAt: string | null
  lastSenderRole: UserRole | null
  unread: number
}

export type ChatMessage = {
  id: string
  content: string
  senderRole: UserRole
  isMine: boolean
  createdAt: string
  pending?: boolean // client-only: an optimistic bubble awaiting server confirmation
}

/**
 * Global inbox — every thread the current user is in (RPC my_chat_threads), newest activity first.
 * Counterparty is a role label, kept anonymous: the broker sees "Lender 1/2/…" (ordinal per deal so
 * multiple lender threads on one deal are distinguishable) and the lender sees "Broker".
 */
export async function listThreads(supabase: DB): Promise<ChatThread[]> {
  const { data, error } = await supabase.rpc("my_chat_threads")
  if (error) throw new Error(error.message)
  return (data ?? []).map((t) => ({
    chatId: t.chat_id,
    dealId: t.deal_id,
    dealNumber: t.deal_number ?? "—",
    dealStatus: t.deal_status,
    iAmBroker: t.i_am_broker,
    counterparty: t.i_am_broker ? `Lender ${t.counterparty_ordinal}` : "Broker",
    lastMessage: t.last_content,
    lastAt: t.last_at,
    lastSenderRole: t.last_sender_role,
    unread: t.unread,
  }))
}

/**
 * Messages in a thread (RLS messages_participants), oldest → newest for the conversation view.
 * `.eq("is_invalid", false)` on top of RLS: RLS already keeps the counterparty from ever selecting a
 * blocked message, but it still lets the SENDER read their own — this filter hides it from their own
 * conversation view too, matching "must not appear as a successfully sent message" for both sides.
 */
export async function listMessages(supabase: DB, chatId: string): Promise<ChatMessage[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from("messages")
    .select("id, content, sender_role, sender_id, created_at")
    .eq("chat_id", chatId)
    .eq("is_invalid", false)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((m) => ({
    id: m.id,
    content: m.content,
    senderRole: m.sender_role,
    isMine: m.sender_id === user?.id,
    createdAt: m.created_at,
  }))
}

/**
 * Send a message on a deal (RPC send_deal_message). Round 4 (Option 2): the INSERT always succeeds —
 * the anti-contact trigger flags offending content (is_invalid = true) instead of rejecting the
 * write, so blocking and recording the violation happen atomically server-side regardless of what the
 * client does. The RPC's return value is the sole source of truth for whether it was blocked; there is
 * deliberately no separate client-side pre-check call any more (it would be redundant now that this
 * one call is authoritative, and calling both would double-count violations).
 *
 * Lender initiating from a deal feed: pass just dealId. Lender replying: dealId (+ their own thread is
 * found by the RPC). Broker replying: pass chatId + iAmBroker so we resolve the thread's lender_id
 * (readable from deal_chats via RLS — an opaque id, never a name).
 */
export async function sendMessage(
  supabase: DB,
  opts: { dealId: string; content: string; chatId?: string | null; iAmBroker?: boolean },
): Promise<{ blocked: boolean; reason: string | null }> {
  let lenderId: string | undefined
  if (opts.iAmBroker && opts.chatId) {
    const { data, error } = await supabase
      .from("deal_chats")
      .select("lender_id")
      .eq("id", opts.chatId)
      .single()
    if (error) throw new Error(error.message)
    lenderId = data.lender_id
  }
  const { data, error } = await supabase.rpc("send_deal_message", {
    p_deal_id: opts.dealId,
    p_content: opts.content,
    p_lender_id: lenderId,
  })
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return { blocked: !!row?.is_invalid, reason: row?.block_reason ?? null }
}

/** Mark all messages in a thread that I did not send as read. */
export async function markChatRead(supabase: DB, chatId: string) {
  const { error } = await supabase.rpc("mark_chat_read", { p_chat_id: chatId })
  if (error) throw new Error(error.message)
}
