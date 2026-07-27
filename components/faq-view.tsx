'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Search, HelpCircle, FileText, DollarSign, Clock, Shield, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listFaqs, type Faq } from '@/lib/queries/faqs'
import { FAQ_CATEGORY_ORDER } from '@/lib/enums'
import { useEnums } from '@/lib/use-enums'
import { useT } from '@/components/i18n-provider'
import type { Database } from '@/lib/database.types'

type FaqCategory = Database['public']['Enums']['faq_category']

const CATEGORY_ICON: Record<FaqCategory, React.ReactNode> = {
  getting_started: <HelpCircle className="h-4 w-4" />,
  deals_and_offers: <FileText className="h-4 w-4" />,
  rates_and_fees: <DollarSign className="h-4 w-4" />,
  timelines_and_notifications: <Clock className="h-4 w-4" />,
  compliance_and_privacy: <Shield className="h-4 w-4" />,
  support_and_account: <Users className="h-4 w-4" />,
}

export function FaqView({
  title,
  subtitle,
  contactHref = '/contact',
}: {
  title: string
  /** Omitted on the lender FAQ — client 2026-07-23 (A-27) asked for that grey line to go. */
  subtitle?: string
  contactHref?: string
}) {
  const t = useT('faqView')
  const { FAQ_CATEGORY_LABEL } = useEnums()
  const supabase = useMemo(() => createClient(), [])
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeCategory, setActiveCategory] = useState<FaqCategory | 'all'>('all')

  useEffect(() => {
    let active = true
    listFaqs(supabase)
      .then((f) => { if (active) setFaqs(f) })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : t('errorLoad')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [supabase])

  // Categories that actually have FAQs, in canonical order.
  const presentCategories = useMemo(
    () => FAQ_CATEGORY_ORDER.filter((c) => faqs.some((f) => f.category === c)),
    [faqs],
  )

  const filteredCategories = useMemo(() => {
    const q = searchTerm.toLowerCase().trim()
    return presentCategories
      .filter((c) => activeCategory === 'all' || c === activeCategory)
      .map((category) => ({
        category,
        items: faqs.filter(
          (f) =>
            f.category === category &&
            (!q || f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [faqs, presentCategories, activeCategory, searchTerm])

  const totalResults = filteredCategories.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>

      {/* Search + category chips */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        {presentCategories.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                activeCategory === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary'
              }`}
            >
              {t('allTopics')}
            </button>
            {presentCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                  activeCategory === cat
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary'
                }`}
              >
                {CATEGORY_ICON[cat]}
                {FAQ_CATEGORY_LABEL[cat]}
              </button>
            ))}
          </div>
        )}
      </div>

      {searchTerm && (
        <p className="text-sm text-muted-foreground mb-4">
          {totalResults === 0
            ? t('noResults')
            : totalResults === 1
              ? t('resultsOne', { count: totalResults, query: searchTerm })
              : t('resultsMany', { count: totalResults, query: searchTerm })}
        </p>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <HelpCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4 animate-pulse" />
          <p className="text-sm font-semibold text-foreground">{t('loading')}</p>
        </div>
      ) : loadError ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <HelpCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground mb-1">{t('errorTitle')}</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <HelpCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground mb-1">{t('noQuestionsTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {faqs.length === 0 ? t('noQuestionsEmpty') : t('noQuestionsFilter')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredCategories.map(({ category, items }) => (
            <div key={category} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted">
                <span className="text-primary">{CATEGORY_ICON[category]}</span>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  {FAQ_CATEGORY_LABEL[category]}
                </h2>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {items.length === 1 ? t('questionsOne', { count: items.length }) : t('questionsMany', { count: items.length })}
                </Badge>
              </div>
              <div className="px-6">
                <Accordion type="multiple">
                  {items.map((item) => (
                    <AccordionItem key={item.id} value={item.id}>
                      <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline hover:text-primary text-left">
                        {item.title}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {item.content}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact CTA */}
      <div className="mt-8 bg-primary/5 border border-primary/20 rounded-lg p-6 text-center">
        <p className="text-sm font-semibold text-foreground mb-1">{t('ctaTitle')}</p>
        <p className="text-sm text-muted-foreground mb-4">
          {t('ctaSubtitle')}
        </p>
        <Link
          href={contactHref}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t('ctaButton')}
        </Link>
      </div>
    </main>
  )
}
