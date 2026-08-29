'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminHeader } from '@/components/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RowActions } from '@/components/row-actions'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Toaster, toast } from 'sonner'
import { Building2, Plus, Pencil, Eye, EyeOff, CheckCircle, Percent } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import {
  listOrganizations, createOrganization, renameOrganization, setOrganizationActive,
  setBrokerageInvoiceBps, type AdminOrg, type OrgTable,
} from '@/lib/queries/admin'

/** The invoice-fee dialog's own value space: 'standard' clears the override (null). */
type BpsChoice = 'standard' | '3' | '4' | '5'

/**
 * Admin: add / rename / deactivate brokerages and lender institutions (client feedback 2026-07-20 #9).
 *
 * Both tables share the same shape and the same admin-only RLS (`lookup_write` / `inst_write` are
 * `for all … using (is_admin())`), so one screen with a tab switch covers both and no RPC is needed.
 * Removal is a DEACTIVATE, never a delete: profiles/deals hold FKs into these tables, and is_active
 * already hides the row from the sign-up dropdowns.
 */
export default function OrganizationsPage() {
  const t = useT('admin')
  const supabase = useMemo(() => createClient(), [])
  const [table, setTable] = useState<OrgTable>('brokerages')
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AdminOrg | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [bpsTarget, setBpsTarget] = useState<AdminOrg | null>(null)
  const [bpsValue, setBpsValue] = useState<BpsChoice>('standard')

  const load = useCallback(async (which: OrgTable) => {
    setOrgs(await listOrganizations(supabase, which))
  }, [supabase])

  useEffect(() => {
    let active = true
    setLoading(true)
    load(table)
      .then(() => { if (active) setLoadError(null) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('orgsLoadErr')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, table, t])

  const errMessage = (err: unknown, fallback: string) => {
    const m = err instanceof Error ? err.message : ''
    return m === 'DUPLICATE_NAME' ? t('orgDuplicateErr') : m || fallback
  }

  const doAdd = async () => {
    if (!newName.trim()) { toast.error(t('orgNameRequired')); return }
    setSaving(true)
    try {
      await createOrganization(supabase, table, newName)
      await load(table)
      toast.success(t('orgCreatedToast', { name: newName.trim() }))
      setAddOpen(false)
      setNewName('')
    } catch (err) {
      toast.error(errMessage(err, t('orgSaveErr')))
    } finally {
      setSaving(false)
    }
  }

  const doRename = async () => {
    if (!renameTarget) return
    if (!renameValue.trim()) { toast.error(t('orgNameRequired')); return }
    setSaving(true)
    try {
      await renameOrganization(supabase, table, renameTarget.id, renameValue)
      await load(table)
      toast.success(t('orgRenamedToast', { name: renameValue.trim() }))
      setRenameTarget(null)
    } catch (err) {
      toast.error(errMessage(err, t('orgSaveErr')))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (o: AdminOrg) => {
    setBusyId(o.id)
    try {
      await setOrganizationActive(supabase, table, o.id, !o.isActive)
      await load(table)
      toast.success(o.isActive ? t('orgDeactivatedToast', { name: o.name }) : t('orgActivatedToast', { name: o.name }))
    } catch (err) {
      toast.error(errMessage(err, t('orgSaveErr')))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Brokerage invoice fee override (2026-08-29): only ever changes brokerages.invoice_bps, consulted
   * solely by accept_offer at the moment a NEW invoice is created — never touches an existing invoice.
   */
  const doSetBps = async () => {
    if (!bpsTarget) return
    setSaving(true)
    try {
      const bps = bpsValue === 'standard' ? null : (Number(bpsValue) as 3 | 4 | 5)
      await setBrokerageInvoiceBps(supabase, bpsTarget.id, bps)
      await load(table)
      toast.success(bps === null
        ? t('orgBpsClearedToast', { name: bpsTarget.name })
        : t('orgBpsSetToast', { name: bpsTarget.name, bps }))
      setBpsTarget(null)
    } catch (err) {
      toast.error(errMessage(err, t('orgSaveErr')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader />
      <Toaster richColors position="top-right" />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('orgsTitle')}</h1>
          <p className="text-muted-foreground text-sm max-w-3xl">{t('orgsIntro')}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Tabs value={table} onValueChange={(v) => setTable(v as OrgTable)}>
            <TabsList>
              <TabsTrigger value="brokerages">{t('tabBrokerages')}</TabsTrigger>
              <TabsTrigger value="lender_institutions">{t('tabLenders')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" className="gap-1.5" onClick={() => { setNewName(''); setAddOpen(true) }}>
            <Plus className="h-4 w-4" />
            {table === 'brokerages' ? t('addBrokerage') : t('addLender')}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-foreground">{t('orgsLoading')}</p>
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground mb-1">{t('orgsLoadErr')}</p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
          ) : orgs.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t('noOrgs')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('orgColName')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('colStatus')}</th>
                    {table === 'brokerages' && (
                      <th className="px-6 py-3 text-left font-semibold text-foreground">{t('orgColInvoiceFee')}</th>
                    )}
                    <th className="px-6 py-3 text-left font-semibold text-foreground">{t('orgColCreated')}</th>
                    <th className="px-6 py-3 text-center font-semibold text-foreground">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className={`border-b border-border last:border-b-0 hover:bg-muted/40 ${o.isActive ? '' : 'opacity-60'}`}>
                      <td className="px-6 py-4 font-medium text-foreground">{o.name}</td>
                      <td className="px-6 py-4">
                        {o.isActive ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircle className="h-3.5 w-3.5" /> {t('orgStatusActive')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            <EyeOff className="h-3.5 w-3.5" /> {t('orgStatusInactive')}
                          </span>
                        )}
                      </td>
                      {table === 'brokerages' && (
                        <td className="px-6 py-4">
                          {o.invoiceBps ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <Percent className="h-3.5 w-3.5" /> {t('orgBpsOverrideBadge', { bps: o.invoiceBps })}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t('orgBpsStandard')}</span>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4 text-muted-foreground">{o.createdAt.slice(0, 10)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <RowActions
                            label={t('colActions')}
                            align="center"
                            disabled={busyId === o.id}
                            actions={[
                              {
                                label: t('orgRename'),
                                icon: <Pencil className="h-4 w-4" />,
                                onSelect: () => { setRenameTarget(o); setRenameValue(o.name) },
                              },
                              table === 'brokerages' && {
                                label: t('orgSetBps'),
                                icon: <Percent className="h-4 w-4" />,
                                onSelect: () => { setBpsTarget(o); setBpsValue(o.invoiceBps ? (String(o.invoiceBps) as BpsChoice) : 'standard') },
                              },
                              o.isActive
                                ? {
                                    label: t('orgDeactivate'),
                                    icon: <EyeOff className="h-4 w-4" />,
                                    destructive: true,
                                    onSelect: () => void toggleActive(o),
                                  }
                                : {
                                    label: t('orgActivate'),
                                    icon: <Eye className="h-4 w-4" />,
                                    onSelect: () => void toggleActive(o),
                                  },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-4 max-w-3xl">{t('orgsDeactivateNote')}</p>
      </main>

      {/* Add */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{table === 'brokerages' ? t('addBrokerage') : t('addLender')}</DialogTitle>
            <DialogDescription>{t('orgAddDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-name">{t('orgColName')}</Label>
            <Input
              id="org-name" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder={t('orgNamePlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={doAdd} disabled={saving} className={newName.trim() ? '' : 'opacity-50'}>
              {saving ? t('orgSaving') : t('orgCreate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('orgRenameTitle', { name: renameTarget?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('orgRenameDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-rename">{t('orgColName')}</Label>
            <Input id="org-rename" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={doRename} disabled={saving} className={renameValue.trim() ? '' : 'opacity-50'}>
              {saving ? t('orgSaving') : t('orgSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Invoice Fee (brokerages only) — never touches an existing invoice; consulted only the
          next time accept_offer creates a new one for this brokerage. */}
      <Dialog open={!!bpsTarget} onOpenChange={(o) => { if (!o) setBpsTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('orgBpsTitle', { name: bpsTarget?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('orgBpsDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-bps">{t('orgColInvoiceFee')}</Label>
            <Select value={bpsValue} onValueChange={(v) => setBpsValue(v as BpsChoice)}>
              <SelectTrigger id="org-bps" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t('orgBpsStandardOption')}</SelectItem>
                <SelectItem value="3">{t('orgBpsOption', { bps: 3 })}</SelectItem>
                <SelectItem value="4">{t('orgBpsOption', { bps: 4 })}</SelectItem>
                <SelectItem value="5">{t('orgBpsOption', { bps: 5 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBpsTarget(null)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={doSetBps} disabled={saving}>
              {saving ? t('orgSaving') : t('orgSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
