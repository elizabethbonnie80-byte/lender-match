'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Toaster } from 'sonner'
import { Ban, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { getBlockActivity, type BlockActivity } from '@/lib/queries/admin'

/**
 * Round 4 (2026-09-03) — admin-only monitoring of the 5-per-broker lender-institution block cap:
 * who's currently blocking whom, and the recent block/unblock history (broker_block_audit, written
 * only by a database trigger — migration 20260903000078). Deliberately a plain table/list, no
 * scoring/graphs — the point is letting Admin notice patterns (a broker stuck at 5/5, rapid
 * rotation) by eye, not automating a verdict.
 */
export default function BlockActivityPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<BlockActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const activity = await getBlockActivity(supabase)
    setData(activity)
  }, [supabase])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('blockActivityLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, t])

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
        ) : (
          <div className="space-y-6">
            {/* Current state: one row per broker who currently has ≥1 active block. */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  {t('blockActivityCurrentHeading')}
                </h2>
              </div>
              {!data || data.summary.length === 0 ? (
                <div className="py-12 text-center">
                  <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('blockActivityNoCurrent')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBroker')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBrokerage')}</th>
                        <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colBlockedCount')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBlockedInstitutions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.summary.map((s) => (
                        <tr key={s.brokerId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                          <td className="px-6 py-4 font-medium text-foreground">{s.brokerName}</td>
                          <td className="px-6 py-4 text-foreground">{s.brokerageName ?? '—'}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center justify-center min-w-8 px-2 py-1 rounded font-medium ${
                              s.blockedCount >= 5 ? 'bg-red-100 text-red-800' : 'bg-primary/10 text-primary'
                            }`}>
                              {s.blockedCount}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-foreground">{s.blockedInstitutions.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent activity: last 200 block/unblock events across all brokers, newest first. */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  {t('blockActivityRecentHeading')}
                </h2>
              </div>
              {!data || data.events.length === 0 ? (
                <div className="py-12 text-center">
                  <Ban className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('blockActivityNoEvents')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBroker')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colBrokerage')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colInstitution')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colAction')}</th>
                        <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colCreated')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => (
                        <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                          <td className="px-6 py-4 font-medium text-foreground">{e.brokerName}</td>
                          <td className="px-6 py-4 text-foreground">{e.brokerageName ?? '—'}</td>
                          <td className="px-6 py-4 text-foreground">{e.institutionName}</td>
                          <td className="px-6 py-4">
                            {e.action === 'blocked' ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                {t('blockActivityBlockedAction')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                {t('blockActivityUnblockedAction')}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
