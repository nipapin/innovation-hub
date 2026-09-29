"use client"

import { createContext, useContext } from "react"

/**
 * Виден ли человеку раздел «Производство». Ответ считает сервер
 * (lib/production/availability.ts) и отдаёт оболочке кабинета пропсом, а она —
 * этим контекстом вниз.
 *
 * Контекст, а не пропсы: вход в раздел рисуют два независимых места — боковое
 * меню оболочки и переключатель «Проекты | Производство» в верхней панели
 * рабочего пространства, которая живёт глубоко внутри страницы проектов.
 *
 * Умолчание — `false`: компонент без провайдера вход не показывает. Лишняя
 * дверь в выключенный раздел хуже отсутствующей.
 */
const ProductionAvailableContext = createContext(false)

export function ProductionAvailableProvider({
  value,
  children,
}: {
  value: boolean
  children: React.ReactNode
}) {
  return (
    <ProductionAvailableContext.Provider value={value}>
      {children}
    </ProductionAvailableContext.Provider>
  )
}

export function useProductionAvailable(): boolean {
  return useContext(ProductionAvailableContext)
}
