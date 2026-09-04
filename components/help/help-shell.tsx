"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, LifeBuoy } from "lucide-react"

import { I18nProvider, useI18n } from "@/components/account/i18n"

/**
 * Каркас справки: шапка и колонка текста.
 *
 * Скроллится документ, а не панель (контракт §8.1): справку читают подряд, и
 * внутренний скролл-контейнер здесь только мешал бы — в нём не работает поиск
 * браузера по длинной странице так, как человек ожидает.
 *
 * `I18nProvider` монтируется своей копией: справка живёт вне `WorkspaceShell`,
 * а язык оба провайдера читают из одного ключа `localStorage` — переключение в
 * кабинете доедет сюда после перезагрузки вкладки.
 */
export function HelpShell({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <Chrome>{children}</Chrome>
    </I18nProvider>
  )
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const pathname = usePathname()
  const isArticle = pathname !== "/help"

  return (
    <div className="min-h-dvh bg-ws-well font-sans text-ws-1">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ws-well/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[58px] w-full max-w-[860px] items-center gap-3 px-6">
          <Link
            href="/help"
            className="flex items-center gap-2 text-[14px] font-semibold text-ws-1"
          >
            <LifeBuoy className="h-5 w-5 text-ws-action" />
            {t.helpTitle}
          </Link>

          {isArticle ? (
            <Link
              href="/help"
              className="ml-auto flex items-center gap-1.5 text-[13px] text-ws-4 hover:text-ws-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t.helpBack}
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[860px] px-6 py-8">{children}</main>
    </div>
  )
}
