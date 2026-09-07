"use client"

import { RotateCcw, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { trashDaysLeft } from "./format"
import { useWorkspace } from "./workspace-context"

/**
 * Полоса над рабочей областью проекта из корзины.
 *
 * Не прячется по таймеру, в отличие от пробной полосы рядом: та напоминает об
 * остатке, а эта объясняет, почему в открытом проекте нет ни заливки, ни
 * переименования. Убери её — и человек будет искать пропавшие кнопки.
 *
 * Срок здесь же: он и есть ответ на вопрос «сколько у меня времени решить».
 */
export function TrashBanner() {
  const { t, selected, restoreProject } = useWorkspace()

  if (!selected?.deletedAt) return null

  const daysLeft = trashDaysLeft(selected.deletedAt)

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-white/[0.12] bg-white/[0.05] px-4 py-2.5 text-[13px] text-ws-2"
    >
      <Trash2 className="h-4 w-4 shrink-0 text-ws-4" />
      <span className="min-w-0 flex-1 truncate">
        {t.trashBannerViewOnly}
        {" · "}
        {daysLeft === 0
          ? t.trashLastDay
          : tf(t.trashDaysLeft, { days: daysLeft })}
      </span>
      <button
        type="button"
        onClick={() => restoreProject(selected)}
        className="flex shrink-0 items-center gap-1.5 rounded-[7px] border border-white/[0.14] px-2.5 py-1 text-[12.5px] hover:bg-white/[0.06]"
      >
        <RotateCcw className="h-[15px] w-[15px]" />
        {t.mRestore}
      </button>
    </div>
  )
}
