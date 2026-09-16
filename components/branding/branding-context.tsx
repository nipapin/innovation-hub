"use client"

import { createContext, useContext } from "react"
import { SITE_MONOGRAM, SITE_NAME } from "@/lib/site"

export type Branding = {
  name: string
  monogram: string
  logoUrl: string | null
}

/**
 * Имя и значок площадки для клиентских шапок — docs/THEMING_PLAN.md §6.3.
 *
 * Контекстом, а не импортом `SITE_NAME`: константа подставляется на СБОРКЕ, то
 * есть одна на всю установку, а теперь их столько, сколько компаний. Значение
 * приходит сверху, из серверного layout, где известно, кто смотрит.
 *
 * Умолчание — сама установка. Поэтому шапки на страницах без провайдера
 * (публичный сайт, письма) продолжают работать как прежде, и переводить их все
 * разом не требуется.
 */
const Ctx = createContext<Branding>({
  name: SITE_NAME,
  monogram: SITE_MONOGRAM,
  logoUrl: null,
})

export function BrandingProvider({
  value,
  children,
}: {
  value: Branding
  children: React.ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBranding(): Branding {
  return useContext(Ctx)
}
