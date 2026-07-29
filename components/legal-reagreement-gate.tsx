'use client'

// Client revision A-3: "We had talked about having a pop-up when the TOS or Privacy policy changes so
// people have to re-agree to everything" — confirmed 2026-07-28 ("Re-prompted would be great - yes
// please").
//
// Mounted once in the root layout, next to SiteFooter. It is inert for anyone not signed in, and inert
// for signed-in users who are up to date — which is everyone, almost always. It only becomes visible
// after an admin publishes a new version of the Terms or the Privacy Policy.
//
// Deliberate choices:
//  • The dialog cannot be dismissed. That is the point of a re-agreement prompt; an escapable one is
//    just a notification. Radix's onEscapeKeyDown/onPointerDownOutside are suppressed and no close
//    button is rendered.
//  • The documents open in a NEW TAB. Linking in-place would navigate away from the modal, and the user
//    needs to be able to read what they are agreeing to.
//  • "Sign out" is offered as the only other way out, so a user who does not agree is not trapped.
//  • Auth routes are skipped: a fresh sign-up gets its acceptance rows from the handle_new_user trigger,
//    but the OTP screens render mid-flow and a modal over them would be alarming.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FileText, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  listPendingLegalDocs,
  acceptPublishedLegalDocs,
  type PendingLegalDoc,
} from '@/lib/queries/legal-acceptance'
import { useT } from '@/components/i18n-provider'
import { BRAND } from '@/lib/brand'

/** Routes where a blocking modal would interrupt an auth flow rather than protect anything. */
const SKIP_PREFIXES = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/pending-approval', '/legal']

const DOC_HREF: Record<PendingLegalDoc['docType'], string> = {
  terms_and_conditions: '/legal/terms',
  privacy_policy: '/legal/privacy',
}

export function LegalReagreementGate() {
  const t = useT('legalGate')
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [pending, setPending] = useState<PendingLegalDoc[]>([])
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const skip = SKIP_PREFIXES.some((p) => pathname?.startsWith(p))

  const check = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setPending([])
      return
    }
    setPending(await listPendingLegalDocs(supabase))
  }, [supabase])

  useEffect(() => {
    if (skip) {
      setPending([])
      return
    }
    void check()
  }, [skip, pathname, check])

  if (skip || pending.length === 0) return null

  const accept = async () => {
    if (!agreed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await acceptPublishedLegalDocs(supabase)
      setPending([])
      setAgreed(false)
      // Server components may render policy-dependent copy; refresh so nothing is stale.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  const docLabel = (d: PendingLegalDoc) =>
    d.docType === 'terms_and_conditions' ? t('docTerms') : t('docPrivacy')

  // A hand-rolled overlay rather than the shared Dialog: Dialog ships a close button and
  // escape/outside-click dismissal, and this must not be dismissable.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-gate-title"
    >
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start gap-3 mb-4">
          <FileText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h2 id="legal-gate-title" className="text-lg font-semibold text-foreground">
              {t('title')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{t('intro', { brand: BRAND })}</p>
          </div>
        </div>

        <ul className="space-y-2 mb-5">
          {pending.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <span className="text-sm text-foreground">
                {docLabel(d)}
                <span className="text-xs text-muted-foreground ml-2">{t('versionLabel', { version: d.version })}</span>
              </span>
              <a
                href={DOC_HREF[d.docType]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 shrink-0"
              >
                {t('read')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </li>
          ))}
        </ul>

        <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
            aria-label={t('confirmLabel')}
          />
          <span className="text-sm text-foreground">{t('confirmLabel')}</span>
        </label>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={signOut} disabled={submitting}>
            {t('signOut')}
          </Button>
          {/* Faux-disabled, like the rest of the app's forms: clickable, with the reason visible. */}
          <Button onClick={accept} disabled={submitting} className={!agreed ? 'opacity-50' : ''}>
            {submitting ? t('submitting') : t('accept')}
          </Button>
        </div>
      </div>
    </div>
  )
}
