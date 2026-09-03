'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrokerHeader } from '@/components/broker-header'
import { AccountSettings } from '@/components/account-settings'
import { BlockManager } from '@/components/block-manager'
import { NotificationPreferences } from '@/components/notification-preferences'
import { useT } from '@/components/i18n-provider'
import { createClient } from '@/lib/supabase/client'
import {
  listLenderInstitutions,
  listBlockedInstitutions,
  blockInstitution,
  unblockInstitution,
  MAX_BLOCKED_INSTITUTIONS,
  type Org,
} from '@/lib/queries/blocks'
import { Toaster } from 'sonner'
import { Bell } from 'lucide-react'

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted">
        <span className="text-primary">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const t = useT('settings')
  const supabase = useMemo(() => createClient(), [])

  const [institutions, setInstitutions] = useState<Org[]>([])
  const [blockedIds, setBlockedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [orgs, blocked] = await Promise.all([listLenderInstitutions(supabase), listBlockedInstitutions(supabase)])
    setInstitutions(orgs)
    setBlockedIds(blocked)
  }, [supabase])

  useEffect(() => {
    let active = true
    load().catch(() => {}).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load])

  const onBlock = async (id: string) => {
    await blockInstitution(supabase, id)
    setBlockedIds((prev) => [...prev, id])
  }
  const onUnblock = async (id: string) => {
    await unblockInstitution(supabase, id)
    setBlockedIds((prev) => prev.filter((x) => x !== id))
  }

  return (
    <div className="min-h-screen bg-background">
      <BrokerHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Account (wired): profile · email · password */}
        <AccountSettings />

        {/* Lender Blocking (wired: broker_blocked_institutions → hides your deals from that institution) */}
        <BlockManager
          t={t}
          title={t('secLenderBlocking')}
          addLabel={t('blockLender')}
          intro={t('blockingIntro')}
          orgs={institutions}
          blockedIds={blockedIds}
          loading={loading}
          onBlock={onBlock}
          onUnblock={onUnblock}
          maxBlocked={MAX_BLOCKED_INSTITUTIONS}
          limitHelperText={t('blockLimitHelper', { max: MAX_BLOCKED_INSTITUTIONS })}
          limitReachedText={t('blockLimitReached', { max: MAX_BLOCKED_INSTITUTIONS })}
        />

        {/* Notifications (wired) */}
        <Section icon={<Bell className="h-4 w-4" />} title={t('secNotifications')}>
          <NotificationPreferences role="broker" />
        </Section>
      </main>
    </div>
  )
}
