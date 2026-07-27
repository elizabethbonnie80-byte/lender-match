'use client'

import { LenderHeader } from '@/components/lender-header'
import { FaqView } from '@/components/faq-view'
import { useT } from '@/components/i18n-provider'

export default function LenderFaqPage() {
  const t = useT('faqView')
  return (
    <div className="min-h-screen bg-background">
      <LenderHeader />

      <FaqView
        title={t('titleLender')}
        contactHref="/lender/contact"
      />
    </div>
  )
}
