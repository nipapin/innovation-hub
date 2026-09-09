"use client"

import { useMemo, useState } from "react"
import { FolderOpen, Loader2, Plus, Search, Trash2, Wrench } from "lucide-react"

import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { GiftBadge, GiftCorner } from "@/components/account/workspace/gift-badge"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { fmtDate } from "@/components/account/workspace/format"
import { cn } from "@/lib/utils"
import { findTool } from "@/lib/tools/registry"
import { toolIcon, toolText } from "./registry-ui"
import { useTools, type ToolInstance } from "./tools-context"

/** Имя экземпляра: своё, если переименовали, иначе из каталога. */
export function useToolTitle() {
  const { t } = useWorkspace()
  return (tool: ToolInstance) => tool.title || t[toolText(tool.toolKey).name]
}

/** Подпись подключённого источника — она же подсказка «что вообще открыто». */
function sourceLabel(tool: ToolInstance, fallback: string): string {
  return tool.source?.label || fallback
}

/**
 * Подарок проекта, к которому подключён инструмент.
 *
 * Инструмент работает в чужой папке, и «за чей счёт» — это всегда вопрос к
 * проекту, а не к самому инструменту. Поэтому не своё поле, а взгляд на список
 * проектов: он уже загружен рядом, и второго источника правды не заводим.
 */
function useToolGift() {
  const { projects } = useWorkspace()
  return (tool: ToolInstance) => {
    const projectId = tool.source?.projectId
    if (!projectId) return null
    return projects.find((p) => p.id === projectId)?.gift ?? null
  }
}

/** Кнопка «Добавить инструмент» — на месте «Новый проект» в разделе проектов. */
export function AddToolButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { t } = useWorkspace()
  const { openCatalog } = useTools()
  return (
    <button
      type="button"
      onClick={openCatalog}
      className={cn(
        "flex items-center justify-center gap-2 rounded-[9px] bg-ws-action font-medium text-white hover:bg-ws-action-hover",
        size === "lg"
          ? "h-[52px] rounded-xl px-[22px] text-[15px]"
          : "h-10 w-full text-[14px]",
      )}
    >
      <Plus className={size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} />
      {t.addTool}
    </button>
  )
}

/** Строка инструмента в левой колонке полного режима. */
function ToolRow({ tool }: { tool: ToolInstance }) {
  const { t } = useWorkspace()
  const { selected, openTool, removeTool } = useTools()
  const title = useToolTitle()
  const toolGift = useToolGift()
  const definition = findTool(tool.toolKey)
  const Icon = definition ? toolIcon(definition.icon) : Wrench
  const active = selected?.id === tool.id
  const gift = toolGift(tool)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => openTool(tool.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          openTool(tool.id)
        }
      }}
      className={cn(
        "group mb-2 flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 transition-colors",
        active
          ? "border-ws-select/50 bg-ws-select/[0.10]"
          : "border-white/[0.08] bg-ws-panel hover:border-white/[0.16] hover:bg-ws-hover",
      )}
    >
      <span className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-ws-accent/30 bg-ws-accent/[0.08]">
        <Icon className="h-[18px] w-[18px] text-ws-accent" />
        {gift ? (
          <GiftBadge
            gift={gift}
            size="sm"
            className="absolute -bottom-1 -right-1 ring-2 ring-ws-panel"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ws-1">
          {title(tool)}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ws-4">
          <FolderOpen className="h-[13px] w-[13px] shrink-0" />
          <span className="truncate">{sourceLabel(tool, t.toolNoSource)}</span>
        </span>
      </span>
      <button
        type="button"
        title={t.toolRemove}
        onClick={(e) => {
          e.stopPropagation()
          void removeTool(tool.id)
        }}
        className="shrink-0 rounded-md p-1 text-ws-5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-[15px] w-[15px]" />
      </button>
    </div>
  )
}

/**
 * Левая колонка полного режима — устроена как колонка проектов: заголовок с
 * числом, поиск, список, кнопка добавления снизу, тянущаяся ширина.
 */
export function ToolsColumn() {
  const { t } = useWorkspace()
  const { tools, loading } = useTools()
  const title = useToolTitle()
  const [query, setQuery] = useState("")

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 300,
    min: 220,
    max: 520,
    axis: "x",
    storageKey: "ffworks-ws-tools-width",
  })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter((tool) =>
      `${title(tool)} ${tool.source?.label ?? ""}`.toLowerCase().includes(q),
    )
  }, [query, title, tools])

  return (
    <section
      style={{ width: size }}
      className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well lg:flex"
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-ws-accent" />
            <span className="truncate text-[14px] font-semibold uppercase tracking-[1.6px] text-ws-accent">
              {t.toolsTab}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-ws-4">{tools.length}</span>
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ws-4"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchTools}
            className="h-[38px] w-full rounded-[9px] border border-white/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loading ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">{t.emptyTools}</p>
        ) : (
          <div className="pt-1">
            {visible.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] p-3">
        <AddToolButton />
      </div>

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.toolsTab}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}

/** Полный режим без выбранного инструмента — как «Выберите проект» в проектах. */
export function NoToolSelected() {
  const { t } = useWorkspace()
  const { openCatalog } = useTools()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <Wrench className="h-7 w-7 text-ws-3" />
      </span>
      <div className="space-y-1.5">
        <p className="text-[20px] font-semibold text-ws-1">{t.pickTool}</p>
        <p className="max-w-[420px] text-[14px] text-ws-3">{t.pickToolSub}</p>
      </div>
      <button
        type="button"
        onClick={openCatalog}
        className="flex h-10 items-center gap-2 rounded-[10px] bg-ws-action px-5 text-[14px] font-medium text-white hover:bg-ws-action-hover"
      >
        <Plus className="h-[18px] w-[18px]" />
        {t.addTool}
      </button>
    </div>
  )
}

/** Упрощённый режим без выбранного инструмента: крупные карточки. */
export function ToolsGrid() {
  const { t, lang } = useWorkspace()
  const { tools, loading, openTool, removeTool } = useTools()
  const title = useToolTitle()
  const toolGift = useToolGift()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-none border-b border-white/[0.07] px-6 pb-6 pt-8 md:px-12 md:pt-11">
        <div className="mx-auto max-w-[1120px]">
          <div className="flex items-center gap-3">
            <span className="h-0.5 w-[34px] rounded bg-ws-accent" />
            <span className="text-[13px] font-semibold uppercase tracking-[2.4px] text-ws-accent">
              {t.toolsTab}
            </span>
          </div>
          <h1 className="mt-5 text-[32px] font-bold tracking-tight text-ws-1 md:text-[46px]">
            {t.yourTools}
          </h1>
          <p className="mt-3.5 max-w-[680px] text-[15px] text-ws-3 md:text-[16px]">
            {t.yourToolsSub}
          </p>
          <div className="mt-7">
            <AddToolButton size="lg" />
          </div>
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 py-7 md:px-12">
        <div className="mx-auto max-w-[1120px]">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-ws-4" />
            </div>
          ) : tools.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[15px] text-ws-3">{t.emptyTools}</p>
              <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-relaxed text-ws-4">
                {t.emptyToolsSub}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
              {tools.map((tool) => {
                const definition = findTool(tool.toolKey)
                const Icon = definition ? toolIcon(definition.icon) : Wrench
                const gift = toolGift(tool)
                return (
                  <div
                    key={tool.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTool(tool.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        openTool(tool.id)
                      }
                    }}
                    className="flex cursor-pointer flex-col gap-4 rounded-2xl border border-white/10 bg-ws-panel p-[22px] text-left hover:border-white/[0.18] hover:bg-ws-hover"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="relative flex h-[46px] w-[46px] items-center justify-center rounded-full border border-ws-accent/30 bg-ws-accent/[0.08]">
                        <Icon className="h-[22px] w-[22px] text-ws-accent" />
                        {gift ? <GiftCorner gift={gift} /> : null}
                      </span>
                      <button
                        type="button"
                        title={t.toolRemove}
                        onClick={(e) => {
                          e.stopPropagation()
                          void removeTool(tool.id)
                        }}
                        className="rounded-md p-1.5 text-ws-5 hover:text-destructive"
                      >
                        <Trash2 className="h-[17px] w-[17px]" />
                      </button>
                    </div>
                    <div>
                      <p className="text-[20px] font-semibold tracking-tight text-ws-1">
                        {title(tool)}
                      </p>
                      <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-ws-4">
                        <FolderOpen className="h-[15px] w-[15px] shrink-0" />
                        <span className="truncate">
                          {sourceLabel(tool, t.toolNoSource)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                      <span className="text-[12.5px] text-ws-5">
                        {tool.lastOpenedAt
                          ? fmtDate(tool.lastOpenedAt, lang)
                          : t.toolNeverOpened}
                      </span>
                      <span className="text-[13px] text-ws-2">{t.toolOpen}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
