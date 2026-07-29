import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { getLocale } from '@/lib/i18n/server'
import { getMessages } from '@/lib/i18n/messages'
import { I18nProvider } from '@/components/i18n-provider'
import { SiteFooter } from '@/components/site-footer'
import { LegalReagreementGate } from '@/components/legal-reagreement-gate'
import { BRAND } from '@/lib/brand'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: BRAND,
  description: `${BRAND} — anonymous mortgage marketplace connecting brokers and lenders.`,
  // Round 3 rebrand — LenderMatch favicon package (public/, from the client's asset set).
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = getMessages(locale)
  return (
    <html lang={locale}>
      {/* Column layout so the footer sits at the bottom of short pages instead of mid-screen.
          Client 2026-07-28 (A-2): the footer is back, and "consistent throughout the site" — so it is
          mounted here once rather than pasted into each page as it was before. */}
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <I18nProvider locale={locale} messages={messages}>
          <div className="flex-1">{children}</div>
          <SiteFooter className="mt-0" />
          {/* A-3: inert unless the signed-in user is behind on a published legal document. */}
          <LegalReagreementGate />
        </I18nProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
