"use client"

import { useEffect, useState } from "react"
import { LifeBuoy } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { HelpModal } from "@/components/help/help-modal"
import type { HelpTopicId } from "@/lib/help/topics"

/**
 * Вход в справку на уровне страницы: иконка в строке с названием раздела.
 *
 * Знак «?» у параметра отвечает «почему именно эта настройка так устроена».
 * Здесь вопрос другой — «что вообще делает этот раздел», — поэтому и вход
 * привязан к названию инструмента, а не к отдельному элементу под ним.
 *
 * Без подписи: строка «Справка по разделу» под описанием читалась как ещё один
 * абзац шапки и спорила с ним за внимание. Иконка рядом с заголовком — это
 * привычная форма, а `F1` рядом с ней объясняет себя сама.
 *
 * F1 открывает то же самое. Кнопка на странице одна, поэтому клавиша
 * однозначна; браузерную справку при этом перехватываем только тогда, когда
 * человек не печатает и на экране нет другого диалога.
 */
export function HelpPageButton({ id }: { id: HelpTopicId }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "F1" || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      // Печатает — F1 может быть чем угодно в его редакторе, но не нашим.
      const target = event.target as HTMLElement | null
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return
      }

      // На экране уже диалог (словари, подтверждение) — второе окно под ним
      // человек не увидит, а фокус уедет.
      if (document.querySelector('[role="dialog"]')) return

      event.preventDefault()
      setOpen(true)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.helpPageButton}
        title={t.helpPageButton}
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-border/60 px-2 py-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <LifeBuoy className="h-[18px] w-[18px]" />
        <kbd className="font-mono text-[10.5px] leading-none text-muted-foreground/70">
          F1
        </kbd>
      </button>

      {open ? <HelpModal id={id} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
