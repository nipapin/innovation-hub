"use client"

import { Copy, Scissors, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { fileIcon, fileIconClass } from "./format"
import { useWorkspace } from "./workspace-context"

/**
 * Плавающая панель буфера обмена в правом верхнем углу.
 * Показывает, что и каким способом переносим, и позволяет
 * убрать из списка лишнее, не собирая выделение заново.
 */
export function ClipboardPanel() {
  const {
    t,
    clipboard,
    removeFromClipboard,
    clearClipboard,
    pasteClipboard,
    currentTarget,
  } = useWorkspace()

  if (!clipboard) return null

  const isCut = clipboard.op === "cut"
  const OpIcon = isCut ? Scissors : Copy

  return (
    <aside
      className={cn(
        "fixed right-3 z-40 w-[268px] overflow-hidden rounded-xl border bg-ws-raised shadow-ws-menu",
        // ниже верхней панели: на мобильном их две, на десктопе одна
        "top-[124px] lg:top-[68px]",
        isCut ? "border-warning/40" : "border-ws-select/40",
      )}
    >
      <header className="flex items-center gap-2 border-b border-foreground/[0.07] px-3 py-2.5">
        <OpIcon
          className={cn(
            "h-4 w-4 shrink-0",
            isCut ? "text-warning" : "text-ws-select",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ws-1">
          {isCut ? t.clipboardCut : t.clipboardCopy}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-ws-4">
          {clipboard.items.length}
        </span>
        <button
          type="button"
          onClick={clearClipboard}
          title={t.clipboardClear}
          aria-label={t.clipboardClear}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ws-4 hover:bg-foreground/10 hover:text-ws-1"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <ul className="scrollbar-elegant max-h-[260px] overflow-y-auto p-1.5">
        {clipboard.items.map((file) => {
          const Icon = fileIcon(file)
          return (
            <li
              key={file.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.05]"
            >
              <Icon
                className={cn("h-4 w-4 shrink-0", fileIconClass(file))}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ws-2">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFromClipboard(file.id)}
                title={t.clipboardRemove}
                aria-label={`${t.clipboardRemove}: ${file.name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ws-5 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-ws-1 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          )
        })}
      </ul>

      <footer className="border-t border-foreground/[0.07] p-2">
        {/* Вставляем в открытую папку: папку уже выбрали, открыв её. */}
        <button
          type="button"
          onClick={() => pasteClipboard(currentTarget.folderPath)}
          className="h-8 w-full rounded-lg bg-ws-action text-[13px] font-medium text-white hover:bg-ws-action-hover"
        >
          {t.clipboardPaste}
        </button>
      </footer>
    </aside>
  )
}
