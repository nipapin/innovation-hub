"use client"

import { createContext, useContext } from "react"

/**
 * Разделы админки, погашенные на этой установке (lib/features.ts) — списком
 * адресов.
 *
 * Контекст, а не пропсы: навигацию рисуют четыре независимых компонента —
 * боковое меню кабинета, меню админки, колонка инструментов области и карточки
 * хаба. Протаскивать список через каждого было бы четыре одинаковых пропса,
 * которые однажды забудут передать в новом месте, и раздел вернулся бы в меню.
 *
 * Значение по умолчанию — пустой список: компонент без провайдера показывает
 * всё, что разрешено правами, то есть ведёт себя как до появления выключателей.
 * Защитой это не является в любом случае: настоящий отказ дают гейт страницы и
 * гвард роута.
 */
const DisabledToolsContext = createContext<readonly string[]>([])

export function DisabledToolsProvider({
  value,
  children,
}: {
  value: readonly string[]
  children: React.ReactNode
}) {
  return (
    <DisabledToolsContext.Provider value={value}>
      {children}
    </DisabledToolsContext.Provider>
  )
}

export function useDisabledAdminTools(): readonly string[] {
  return useContext(DisabledToolsContext)
}
