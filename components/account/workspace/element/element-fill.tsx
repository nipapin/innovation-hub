"use client"

import { useMemo } from "react"

import { readElement, slotFill } from "@/lib/tools/element/slots"
import { cn } from "@/lib/utils"
import type { DriveFile } from "../types"
import { useWorkspace } from "../workspace-context"
import { entriesOf } from "./tree"

/**
 * Полоска заполненности по нижнему краю папки элемента.
 *
 * Зачем: папку собирают несколько человек — один кладёт одно, другой другое, а
 * третий проверяет и запускает. До сих пор узнать, много ли не хватает, можно
 * было только открыв папку, и «готово ли» приходилось выяснять поштучно.
 *
 * Считается БЕЗ единого запроса: дерево проекта уже загружено целиком, а форма
 * сборки прочитана один раз на выбор проекта. Поэтому здесь нет ни кэша, ни
 * файла-карты в папке — считать заново дешевле, чем хранить второй источник
 * правды, который правки из десктопа не обновляют (см. `lib/tools/element/names.ts`).
 *
 * Форма — как у полосы срока в корзине (`trash-lifespan.tsx`), и это намеренно:
 * там полоса про убывание срока, здесь про набор состава, но читаются они
 * одинаково — «сколько осталось до края». Родителю нужны `relative` и
 * `overflow-hidden`, иначе полоса вылезет за скругление рамки.
 */
export function ElementFill({ file }: { file: DriveFile }) {
  const { elementForm, isElementFolder } = useWorkspace()
  const isElement = isElementFolder(file)

  const fill = useMemo(() => {
    if (!isElement || !elementForm) return null
    return slotFill(readElement(elementForm.rows, entriesOf(file)))
  }, [isElement, elementForm, file])

  // Слотов нет вовсе — делить не на что, и пустая полоса сказала бы неправду.
  if (!fill || fill.total === 0) return null

  const ratio = Math.max(0, Math.min(1, fill.filled / fill.total))
  const done = fill.filled >= fill.total

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-foreground/[0.05]"
    >
      <span
        className={cn(
          "block h-full rounded-r-full transition-[width]",
          // Ярче только когда собрано целиком: это единственное состояние, в
          // котором полосу нужно заметить издалека — папку можно запускать.
          done ? "bg-emerald-500/80" : "bg-emerald-500/40",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </span>
  )
}
