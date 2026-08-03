"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Send, MessagesSquare, Building2, Tag, XCircle, CheckCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MakeOfferDialog } from "@/components/make-offer-dialog"
import { createClient } from "@/lib/supabase/client"
import {
  listThreads,
  listMessages,
  sendMessage,
  markChatRead,
  type ChatThread,
  type ChatMessage,
} from "@/lib/queries/messages"
import { declineDeal, hasLenderOfferedOnDeal } from "@/lib/queries/offers"
import { notifyUnreadChanged } from "@/hooks/use-unread"
import { scanContact } from "@/lib/queries/anti-contact"
import { DEAL_STATUS_LABEL } from "@/lib/enums"
import { useT } from "@/components/i18n-provider"

// Deal is still open to a first offer in these statuses (mirrors the New/Maturing Deals feeds).
const OFFERABLE_STATUSES = new Set(["submitted", "offer_received"])

/**
 * Global broker↔lender inbox: a thread list (all deals, newest activity first) beside the selected
 * conversation. Anonymity holds — the counterparty is a role label, never a name — and every message
 * runs through the anti-contact pre-check before send. Realtime keeps both panes live.
 */
export function MessagesInbox() {
  const t = useT("messagesInbox")
  const supabase = useRef(createClient()).current
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Lender-only deal actions on the open thread: make an offer (once) or decline (deletes the chat).
  const [hasOffered, setHasOffered] = useState(false)
  const [offerTarget, setOfferTarget] = useState<string[] | null>(null)
  const [declineConfirmOpen, setDeclineConfirmOpen] = useState(false)

  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId
  const selected = threads.find((t) => t.chatId === selectedId) ?? null
  const scrollBottomRef = useRef<HTMLDivElement | null>(null)

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listThreads(supabase))
    } catch (e) {
      // Transient (a realtime tick will retry) but shouldn't vanish silently — log for debuggability.
      console.warn("messages-inbox: refreshThreads failed", e)
    }
  }, [supabase])

  const loadMessages = useCallback(
    async (chatId: string) => {
      try {
        setMessages(await listMessages(supabase, chatId))
        await markChatRead(supabase, chatId)
        // Opening a thread happens without navigating, so the header's Messages dot has no other
        // trigger to re-count on — same reason as the notification bell (F-1).
        notifyUnreadChanged()
      } catch (e) {
        console.warn("messages-inbox: loadMessages failed", e)
      }
    },
    [supabase],
  )

  // Initial load.
  useEffect(() => {
    refreshThreads().finally(() => setLoading(false))
  }, [refreshThreads])

  // Realtime: any message change to one of my chats refreshes the list; if it lands in the open
  // thread, refresh that conversation too. RLS scopes delivery to threads I participate in.
  useEffect(() => {
    const channel = supabase
      .channel("messages-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        void refreshThreads()
        const chatId = (payload.new as { chat_id?: string } | null)?.chat_id
        if (chatId && chatId === selectedRef.current) void loadMessages(chatId)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, refreshThreads, loadMessages])

  // Scroll to the newest message when the conversation changes.
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, selectedId])

  // Lender only: does this deal already have an offer from me? Gates the Make Offer button — a
  // lender can only offer once per deal. Re-checked whenever the open thread changes.
  useEffect(() => {
    if (!selected || selected.iAmBroker) {
      setHasOffered(false)
      return
    }
    let active = true
    hasLenderOfferedOnDeal(supabase, selected.dealId)
      .then((v) => { if (active) setHasOffered(v) })
      .catch(() => { if (active) setHasOffered(false) })
    return () => {
      active = false
    }
  }, [supabase, selected?.dealId, selected?.iAmBroker])

  const select = async (chatId: string) => {
    setSelectedId(chatId)
    setError(null)
    setMessages([])
    await loadMessages(chatId)
    void refreshThreads() // clear the unread badge
  }

  // Deep-link: /messages?chat=<id> (the lender feeds' "Message" button links here once a thread exists)
  // auto-opens that conversation as soon as the thread list has loaded. Runs once.
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (autoSelectedRef.current || threads.length === 0) return
    const wanted = new URLSearchParams(window.location.search).get("chat")
    if (!wanted) {
      autoSelectedRef.current = true
      return
    }
    if (threads.some((th) => th.chatId === wanted)) {
      autoSelectedRef.current = true
      void select(wanted)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads])

  const send = async () => {
    const content = draft.trim()
    if (!selected || !content || sending) return
    const { chatId, dealId, iAmBroker } = selected
    // Optimistic: show the bubble and clear the box instantly, then reconcile with the server.
    const tempId = `temp-${Date.now()}`
    const optimistic: ChatMessage = {
      id: tempId,
      content,
      senderRole: iAmBroker ? "broker" : "lender",
      isMine: true,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setMessages((prev) => [...prev, optimistic])
    setDraft("")
    setSending(true)
    setError(null)
    try {
      const reason = await scanContact(supabase, content, "chat_message", dealId)
      if (reason) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        setDraft(content)
        setError(t("contactBlocked", { reason }))
        return
      }
      await sendMessage(supabase, { dealId, content, chatId, iAmBroker })
      await loadMessages(chatId) // replaces the temp bubble with the server row
      void refreshThreads()
    } catch (err) {
      // Roll back the optimistic bubble and restore the draft so nothing is lost.
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setDraft(content)
      setError(err instanceof Error ? err.message : t("sendError"))
    } finally {
      setSending(false)
    }
  }

  // Called by <MakeOfferDialog> after make_offer succeeds — the button hides for good afterward.
  const onOfferSent = () => {
    setHasOffered(true)
    setOfferTarget(null)
  }

  // Decline removes the deal from every feed AND deletes this chat (decline_deal RPC), so the
  // thread disappears from the inbox immediately. Closes the confirm dialog right away, like the
  // other decline flows in the app — an error surfaces below the (still open) conversation.
  const confirmDecline = async () => {
    if (!selected) return
    const { dealId, chatId } = selected
    setDeclineConfirmOpen(false)
    try {
      await declineDeal(supabase, dealId)
      setThreads((prev) => prev.filter((t) => t.chatId !== chatId))
      setSelectedId(null)
      setMessages([])
    } catch (err) {
      setError(err instanceof Error ? err.message : t("declineErr"))
    }
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[28rem] rounded-lg border border-border overflow-hidden bg-card">
      {/* Thread list */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">{t("conversationsTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("conversationsSub")}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : threads.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("noThreads")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {threads.map((t) => (
                <li key={t.chatId}>
                  <button
                    type="button"
                    onClick={() => void select(t.chatId)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      t.chatId === selectedId ? "bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{t.dealNumber}</span>
                      <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {DEAL_STATUS_LABEL[t.dealStatus]}
                      </span>
                      {t.unread > 0 && (
                        <span className="ml-auto min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-destructive text-destructive-foreground text-[0.65rem] font-semibold flex items-center justify-center">
                          {t.unread}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate min-w-0">{t.counterparty}</span>
                      {t.lastAt && (
                        <span className="ml-auto shrink-0 whitespace-nowrap">
                          {formatDistanceToNow(new Date(t.lastAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    {t.lastMessage && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {t.lastSenderRole === (t.iAmBroker ? "broker" : "lender") ? "You: " : ""}
                        {t.lastMessage}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground px-6">
            <MessagesSquare className="h-10 w-10 mb-3" />
            <p className="text-sm font-medium text-foreground">{t("selectTitle")}</p>
            <p className="text-xs">{t("selectSub")}</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {t("dealHeader", { number: selected.dealNumber, party: selected.counterparty })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {DEAL_STATUS_LABEL[selected.dealStatus]} · {t("identityHint")}
                </p>
              </div>
              {!selected.iAmBroker && OFFERABLE_STATUSES.has(selected.dealStatus) && (
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {hasOffered ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <CheckCircle className="h-3.5 w-3.5" />
                      {t("offerSentBadge")}
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setOfferTarget([selected.dealId])}
                      >
                        <Tag className="h-3.5 w-3.5" />
                        {t("makeOfferBtn")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setDeclineConfirmOpen(true)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {t("declineBtn")}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 px-4 py-4">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">{t("emptyConvo")}</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          m.isMine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        } ${m.pending ? "opacity-60" : ""}`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p className={`text-[0.65rem] mt-1 ${m.isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={scrollBottomRef} />
                </div>
              )}
            </ScrollArea>

            <div className="border-t border-border p-3">
              {error && <p className="text-xs text-destructive mb-2">{error}</p>}
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={t("inputPlaceholder")}
                  rows={2}
                  className="resize-none flex-1 min-w-0"
                />
                <Button onClick={() => void send()} disabled={sending || !draft.trim()} size="icon" className="shrink-0">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <MakeOfferDialog dealIds={offerTarget} onClose={() => setOfferTarget(null)} onSuccess={onOfferSent} />

      <AlertDialog open={declineConfirmOpen} onOpenChange={setDeclineConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("declineConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("declineConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDecline()}>
              {t("declineConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
