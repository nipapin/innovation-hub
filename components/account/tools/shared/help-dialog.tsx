"use client"

import type { LucideIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWorkspace } from "@/components/account/workspace/workspace-context"

export type HelpRow = {
  icon: LucideIcon
  /** Что нажать. Уже человеческая подпись, не код клавиши. */
  key: string
  title: string
  desc: string
}

/**
 * Справка по клавишам — общая рамка для инструментов раздела.
 *
 * Строки приходят от инструмента: у титров это набор инструментов таймлинии, у
 * озвучки — генерация и подгонка. Общее — вид таблицы и то, что справка
 * открывается по F1 и из настроек.
 */
export function ToolHelpDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: HelpRow[]
}) {
  const { t } = useWorkspace()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.srtHotkeysTitle}</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-2">
          {rows.map((row) => {
            const Icon = row.icon
            return (
              <div
                key={row.title}
                className="grid grid-cols-[26px_120px_1fr] items-start gap-3 border-b border-foreground/[0.06] py-3 last:border-b-0"
              >
                <Icon className="h-[19px] w-[19px] text-ws-accent" />
                <div className="flex">
                  <kbd className="whitespace-nowrap rounded border border-foreground/[0.10] bg-ws-well px-2 py-[2px] font-mono text-[12px] text-ws-2">
                    {row.key}
                  </kbd>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-ws-1">{row.title}</span>
                  <span className="text-pretty text-[12px] leading-relaxed text-ws-3">
                    {row.desc}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
