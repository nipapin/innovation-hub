"use client"

import { useState } from "react"
import { LifeBuoy } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { HelpModal } from "@/components/help/help-modal"
import type { HelpTopicId } from "@/lib/help/topics"
import { cn } from "@/lib/utils"

/**
 * Вход в справку у заголовка секции — третий и последний уровень входа.
 *
 * Три вопроса, три входа, и путать их не надо:
 *
 *   что делает раздел      → `HelpPageButton` при названии страницы, с F1
 *   что делает эта секция  → эта кнопка при заголовке секции
 *   почему параметр такой  → `HelpDot` вплотную к параметру
 *
 * От страничной кнопки отличается двумя вещами, и обе принципиальны.
 *
 * **Нет F1.** Клавиша обязана быть однозначной, а секций на странице несколько:
 * повесив её на каждую, мы получили бы гонку обработчиков и случайную статью в
 * ответ на нажатие. F1 остаётся за страницей целиком.
 *
 * **Нет чипа с подписью.** Заголовок секции мельче заголовка страницы, и «F1»
 * рядом с ним перетягивал бы внимание на себя. Голая иконка читается как
 * продолжение заголовка, а не как ещё один элемент управления.
 *
 * Ставится ТОЛЬКО когда у секции есть своя статья. Кнопка, ведущая на ту же
 * статью, что уже открыта сверху, — не помощь, а обещание подробностей,
 * которых нет (docs/HELP_SYSTEM.md §7).
 */
export function HelpSectionButton({
  id,
  className,
}: {
  id: HelpTopicId
  className?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.helpSectionButton}
        title={t.helpSectionButton}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-border/60 px-1.5 py-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground",
          className,
        )}
      >
        <LifeBuoy className="h-[15px] w-[15px]" />
      </button>

      {open ? <HelpModal id={id} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
