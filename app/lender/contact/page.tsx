'use client'

import { LenderHeader } from '@/components/lender-header'
import { ContactPage } from '@/components/contact-page'

export default function LenderContactPage() {
  return <ContactPage header={<LenderHeader />} thankYouKey="thankYouLender" />
}
