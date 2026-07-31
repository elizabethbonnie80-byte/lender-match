'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'
import { AuthHeader } from '@/components/auth-header'
import { LegalContent } from '@/components/legal-content'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/components/i18n-provider'
import { getPublishedLegalDoc, LEGAL_SLUG_TO_TYPE, type PublishedLegalDoc } from '@/lib/queries/legal'

/**
 * Public, unauthenticated view of a published legal document (Privacy Policy / Terms). Reachable at
 * /legal/privacy and /legal/terms — the sign-up checkbox and the footer link here. RLS
 * (legal_read_published) lets even anon visitors read the published version.
 */
export default function LegalDocPage() {
  const t = useT('legalPublic')
  const params = useParams<{ doc: string }>()
  const router = useRouter()
  const slug = String(params?.doc ?? '')
  const type = LEGAL_SLUG_TO_TYPE[slug]
  const supabase = useMemo(() => createClient(), [])
  const [doc, setDoc] = useState<PublishedLegalDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * E-2 (client 2026-07-30): this used to be a hardcoded `<Link href="/sign-up">`. That was right when
   * sign-up was the only route here, and became wrong when A-2 put these links in the footer of every
   * page — a signed-in broker reading the Terms was offered "Back to sign up".
   *
   * Resolved after paint because `window.history` is not available during SSR. When there is nothing to
   * go back to we render NO control rather than falling back to "/": that only happens when the document
   * was opened in a new tab (the sign-up checkbox and the re-agreement gate both use target="_blank"),
   * where the user closes the tab — and "/" redirects to /sign-in, which is the last place to send
   * someone who is already signed in. The slot keeps its height so nothing shifts when it appears.
   */
  const [canGoBack, setCanGoBack] = useState(false)
  useEffect(() => { setCanGoBack(window.history.length > 1) }, [])

  const title =
    type === 'privacy_policy' ? t('privacyTitle') : type === 'terms_and_conditions' ? t('termsTitle') : t('unknownTitle')

  useEffect(() => {
    let active = true
    if (!type) {
      setLoading(false)
      return
    }
    getPublishedLegalDoc(supabase, type)
      .then((d) => { if (active) setDoc(d) })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : t('loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase, type, t])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AuthHeader />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="h-5 mb-6">
          {canGoBack && (
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> {t('back')}
            </button>
          )}
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
        {doc && (
          <p className="text-xs text-muted-foreground mb-8">
            {t('lastUpdated', { date: doc.updatedAt.slice(0, 10), version: doc.version })}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t('loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !type ? (
          <p className="text-sm text-muted-foreground">{t('unknownBody')}</p>
        ) : !doc ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">{t('notPublishedTitle')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('notPublishedBody')}</p>
          </div>
        ) : (
          <LegalContent html={doc.content} />
        )}
      </main>
    </div>
  )
}
