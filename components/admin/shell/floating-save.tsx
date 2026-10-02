"use client"

import { useEffect, useId, useRef, useSyncExternalStore } from "react"
import { Loader2, Save } from "lucide-react"
import { tf, useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"

/**
 * Кнопка «Сохранить», которая всегда на виду.
 *
 * Форма регистрирует здесь свои несохранённые правки, а хост в оболочке админки
 * рисует кнопку в правом нижнем углу — где бы человек ни был на странице.
 * Кнопка внизу формы терялась: правишь верх длинной страницы, а сохранять надо
 * идти через три карточки.
 *
 * Одна запись — одна кнопка, а не общая «сохранить всё»: у секций своя цена
 * ошибки (у «Тестового периода» состав набора идёт через подтверждение), и
 * общая кнопка не говорила бы, ЧТО именно уедет. Когда изменённых секций
 * несколько, на кнопке подписано, чья она.
 */

type Entry = {
  id: string
  label: string
  busy: boolean
  disabled: boolean
  save: () => void
}

let entries: Entry[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function put(entry: Entry) {
  const at = entries.findIndex((item) => item.id === entry.id)
  entries =
    at === -1
      ? [...entries, entry]
      : entries.map((item, index) => (index === at ? entry : item))
  emit()
}

function drop(id: string) {
  if (!entries.some((item) => item.id === id)) return
  entries = entries.filter((item) => item.id !== id)
  emit()
}

/**
 * Показать кнопку, пока есть что сохранять (или идёт сохранение — иначе кнопка
 * исчезала бы из-под курсора вместе со спиннером).
 */
export function useFloatingSave({
  label,
  dirty,
  busy = false,
  disabled = false,
  onSave,
}: {
  /** Название секции — видно, только когда изменённых секций несколько. */
  label: string
  dirty: boolean
  busy?: boolean
  /** Правка есть, но в таком виде не сохранится (например, нечитаемый цвет). */
  disabled?: boolean
  onSave: () => void
}) {
  const id = useId()
  // Обработчик — через ссылку: он новый на каждый рендер, и перерегистрация
  // ради него дёргала бы хост без всякой перемены на экране.
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const shown = dirty || busy

  useEffect(() => {
    if (!shown) {
      drop(id)
      return
    }
    put({ id, label, busy, disabled, save: () => saveRef.current() })
  }, [id, shown, label, busy, disabled])

  useEffect(() => () => drop(id), [id])
}

export function FloatingSaveHost() {
  const { t } = useI18n()
  const list = useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries,
  )
  if (list.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {list.map((entry) => (
        <Button
          key={entry.id}
          size="lg"
          onClick={entry.save}
          disabled={entry.busy || entry.disabled}
          className="pointer-events-auto shadow-lg shadow-black/30"
        >
          {entry.busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {list.length > 1
            ? tf(t.floatingSaveOf, { section: entry.label })
            : t.floatingSave}
        </Button>
      ))}
    </div>
  )
}

/* Третья крошка в шапке: что именно открыто внутри инструмента. */

let crumb: string | null = null
const crumbListeners = new Set<() => void>()
const subscribeCrumb = (listener: () => void) => {
  crumbListeners.add(listener)
  return () => crumbListeners.delete(listener)
}

export function useAdminCrumb(label: string | null) {
  useEffect(() => {
    crumb = label
    crumbListeners.forEach((listener) => listener())
    return () => {
      crumb = null
      crumbListeners.forEach((listener) => listener())
    }
  }, [label])
}

export function useCurrentAdminCrumb(): string | null {
  return useSyncExternalStore(
    subscribeCrumb,
    () => crumb,
    () => null,
  )
}
