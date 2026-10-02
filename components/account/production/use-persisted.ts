"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Состояние раздела, которое помнит браузер: свёрнутые блоки, раскрытые
 * ролики. Человек настроил вид один раз — при следующем заходе он тот же.
 *
 * Первый рендер — со значением по умолчанию, сохранённое подхватывается после
 * монтирования: сервер localStorage не видит, и разные значения на сервере и в
 * браузере сломали бы гидратацию.
 */
export function usePersisted<T>(key: string, initial: T) {
  const storageKey = `production:${key}`
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // Хранилище недоступно или значение битое — остаёмся на умолчании.
    }
  }, [storageKey])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(resolved))
        } catch {
          // Не записалось — вид всё равно меняется, просто не запомнится.
        }
        return resolved
      })
    },
    [storageKey],
  )

  return [value, update] as const
}
