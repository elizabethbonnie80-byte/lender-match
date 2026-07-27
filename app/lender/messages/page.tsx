import { LenderHeader } from "@/components/lender-header"
import { MessagesInbox } from "@/components/messages-inbox"

export default function LenderMessagesPage() {
  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">Messages</h1>
        </div>
        <MessagesInbox />
      </main>
    </div>
  )
}
