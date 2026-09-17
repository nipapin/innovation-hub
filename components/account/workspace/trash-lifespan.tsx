"use client"

import { cn } from "@/lib/utils"
import { TRASH_RETENTION_DAYS, trashDaysLeft } from "./format"

/**
 * Полоска остатка срока по нижнему краю карточки корзины.
 *
 * Показывает не «сколько пролежало», а сколько осталось: полоса укорачивается
 * к концу срока, и пустеющий край сам говорит «пора решать». Цвет меняется
 * только под конец — на последней неделе и в последние сутки; крась она всё
 * время, девять строк списка стали бы девятью цветными плашками, и красное
 * перестало бы значить «срочно».
 *
 * Родителю нужны `relative` и `overflow-hidden`, иначе полоса вылезет за
 * скругление рамки.
 */
export function TrashLifespan({ deletedAt }: { deletedAt: string }) {
  const left = trashDaysLeft(deletedAt)
  const ratio = Math.max(0, Math.min(1, left / TRASH_RETENTION_DAYS))

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-foreground/[0.05]"
    >
      <span
        className={cn(
          "block h-full rounded-r-full transition-[width]",
          left <= 1
            ? "bg-destructive/75"
            : left <= 7
              ? "bg-amber-500/60"
              : "bg-foreground/20",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </span>
  )
}
