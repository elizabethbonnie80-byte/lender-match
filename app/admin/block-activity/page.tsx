'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Toaster, toast } from 'sonner'
import { Ban, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  getBlockActivity,
  getBrokerBlockHistory,
  type BlockActivitySummaryRow,
  type BlockHistoryEvent,
} from '@/lib/queries/admin'
import { MAX_BLOCKED_INSTITUTIONS } from '@/lib/queries/blocks'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function ActionBadge({ action, t }: { action: 'blocked' | 'unblocked'; t: (key: string) => string }) {
  return action === 'blocked' ? (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
      {t('blockActivityBlockedAction')}
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
      {t('blockActivityUnblockedAction')}
    </span>
  )
}

/**
 * Round 4 (2026-09-03) — admin-only monitoring of the 5-per-broker lender-institution block cap.
 * Grouped view (2026-09-03 follow-up): one row per broker with any block/unblock history, sorted by
 * their most recent activity; "View Activity" drills into that broker's full event history plus
 * their current blocked institutions. Deliberately a plain table/list, no scoring/graphs — the point
 * is letting Admin notice patterns (a broker stuck at 5/5, rapid rotation) by eye.
 */
export default function BlockActivityPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [summary, setSummary] = useState<BlockActivitySummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedBroker, setSelectedBroker] = useState<BlockActivitySummaryRow | null>(null)
  const [history, setHistory] = useState<BlockHistoryEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    const activity = await getBlockActivity(supabase)
    setSummary(activity.summary)
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('blockActivityLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

  const viewActivity = (row: BlockActivitySummaryRow) => {
    setSelectedBroker(row)
    setHistory([])
    setHistoryLoading(true)
    getBrokerBlockHistory(supabase, row.brokerId)
      .then(setHistory)
      .catch((err) => toast.error(err instanceof Error ? err.message : t('blockActivityLoadErr')))
      .finally(() => setHistoryLoading(false))
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('blockActivityTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">{t('blockActivitySubtitle')}</p>
        </div>

        {loading ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Ban className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">{t('blockActivityLoading')}</p>
          </div>
        ) : loadError ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Ban className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">{t('blockActivityLoadErr')}</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </div>
        ) : summary.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{t('blockActivityNoHistory')}</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBroker')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBrokerage')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colBlockedCount')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colChanges7d')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colLatestActivity')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colLastActive')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colViewActivity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.brokerId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-6 py-4 font-medium text-foreground">{row.brokerName}</td>
                      <td className="px-6 py-4 text-foreground">{row.brokerageName ?? '—'}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center justify-center min-w-14 px-2 py-1 rounded font-medium ${
                          row.blockedCount >= MAX_BLOCKED_INSTITUTIONS ? 'bg-red-100 text-red-800' : 'bg-primary/10 text-primary'
                        }`}>
                          {t('blockActivityOfMax', { count: row.blockedCount, max: MAX_BLOCKED_INSTITUTIONS })}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-foreground">{row.changes7d}</td>
                      <td className="px-6 py-4 text-foreground">
                        {row.latestAction === 'blocked'
                          ? t('blockActivityLatestBlocked', { institution: row.latestInstitutionName })
                          : t('blockActivityLatestUnblocked', { institution: row.latestInstitutionName })}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">{new Date(row.latestCreatedAt).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                        <Button size="sm" variant="outline" onClick={() => viewActivity(row)}>
                          {t('viewActivityAction')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <Dialog open={!!selectedBroker} onOpenChange={(o) => { if (!o) setSelectedBroker(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedBroker?.brokerName}</DialogTitle>
          </DialogHeader>
          {selectedBroker && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">{selectedBroker.brokerageName ?? '—'}</p>
                <p className="text-sm font-medium text-foreground mt-1">
                  {t('blockActivityCurrentlyBlocked', {
                    count: selectedBroker.blockedCount,
                    max: MAX_BLOCKED_INSTITUTIONS,
                  })}
                </p>
                {selectedBroker.blockedInstitutions.length > 0 && (
                  <p className="text-sm text-foreground mt-1">{selectedBroker.blockedInstitutions.join(', ')}</p>
                )}
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                  {t('blockActivityHistoryHeading')}
                </p>
                {historyLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t('blockActivityHistoryLoading')}</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t('blockActivityHistoryEmpty')}</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-1.5">
                    {history.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/50 border border-border rounded-md">
                        <span className="text-sm text-foreground truncate">{e.institutionName}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <ActionBadge action={e.action} t={t} />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(e.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
