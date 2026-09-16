import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Suspense } from 'react'

import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { VisitorTracker } from '@/components/site/visitor-tracker'
import { BrandingProvider } from '@/components/branding/branding-context'
import { accentCss, DEFAULT_ACCENT } from '@/lib/branding'
import { resolveBranding } from '@/lib/branding-server'
import { THEME_COOKIE, THEME_INIT_SCRIPT, isThemeChoice } from '@/lib/theme'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

/**
 * Заголовок вкладки — тоже от компании: иначе у её сотрудника во вкладке весь
 * день висит чужое имя. `generateMetadata`, а не константа, потому что ответ
 * зависит от того, кто смотрит.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveBranding()
  return {
    title: branding.name,
    description:
      'Explore curated video content on innovation, technology, and design.',
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  /**
   * Тема ставится в разметку НА СЕРВЕРЕ — первый кадр приходит уже правильным
   * (docs/THEMING_PLAN.md §5). Выбранную знает кука; `system` знает только
   * браузер, поэтому её доставляет инлайновый скрипт ниже.
   */
  const cookieStore = await cookies()
  const raw = cookieStore.get(THEME_COOKIE)?.value
  const choice = isThemeChoice(raw) ? raw : "system"

  /**
   * Акцент компании вошедшего (THEMING_PLAN §6). Правила садятся на `:root`,
   * поэтому их подхватывает и градиент подложки. Умолчание ничего не
   * переопределяет — стиль просто не печатается.
   */
  const branding = await resolveBranding()
  const accent =
    branding.accent === DEFAULT_ACCENT ? null : accentCss(branding.accent)

  return (
    // suppressHydrationWarning — расширения браузера (Dark Reader и т.п.)
    // дописывают свои data-атрибуты в <html> до гидратации. Сюда же попадает и
    // правка data-theme скриптом ниже.
    <html
      lang="en"
      data-theme={choice === "system" ? undefined : choice}
      suppressHydrationWarning
    >
      <head>
        {choice === "system" ? (
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        ) : null}
        {accent ? <style dangerouslySetInnerHTML={{ __html: accent }} /> : null}
      </head>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} min-h-screen font-sans antialiased`}
      >
        <BrandingProvider
          value={{
            name: branding.name,
            monogram: branding.monogram,
            logoUrl: branding.logoUrl,
          }}
        >
          {children}
        </BrandingProvider>
        <Suspense fallback={null}>
          <VisitorTracker />
        </Suspense>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
