import { SITE_NAME } from "@/lib/site"
import type { Metadata } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Suspense } from 'react'

import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { VisitorTracker } from '@/components/site/visitor-tracker'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: SITE_NAME,
  description: 'Explore curated video content on innovation, technology, and design.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning — расширения браузера (Dark Reader и т.п.)
    // дописывают свои data-атрибуты в <html> до гидратации.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} min-h-screen font-sans antialiased`}
      >
        {children}
        <Suspense fallback={null}>
          <VisitorTracker />
        </Suspense>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
