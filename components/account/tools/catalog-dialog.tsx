"use client"

import { useMemo, useState } from "react"
import { ArrowLeft, Check, Plus, Search, Trash2 } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { TOOLS, TOOL_KINDS, type ToolDefinition, type ToolKind } from "@/lib/tools/registry"
import { KIND_LABEL, toolIcon, toolText } from "./registry-ui"
import { useTools } from "./tools-context"

/** Тег-фильтр по типу материала. */
function KindChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-[6px] text-[13px] transition-colors",
        active
          ? "border-ws-select/60 bg-ws-select/[0.16] text-ws-1"
          : "border-white/10 text-ws-3 hover:border-white/20 hover:text-ws-1",
      )}
    >
      {label}
    </button>
  )
}

/** Карточка в списке каталога. */
function CatalogCard({
  tool,
  added,
  onClick,
}: {
  tool: ToolDefinition
  added: boolean
  onClick: () => void
}) {
  const { t } = useWorkspace()
  const Icon = toolIcon(tool.icon)
  const text = toolText(tool.key)
  const soon = tool.status !== "ready"

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-4 rounded-[14px] border border-white/10 bg-ws-panel p-[18px] text-left transition-colors hover:border-white/[0.18] hover:bg-ws-hover",
        soon && "opacity-70",
      )}
    >
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-ws-accent/30 bg-ws-accent/[0.08]">
        <Icon className="h-[21px] w-[21px] text-ws-accent" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-semibold text-ws-1">{t[text.name]}</span>
          {added ? (
            <span className="flex items-center gap-1 rounded-full border border-ws-out/40 bg-ws-out/10 px-2 py-[2px] text-[11.5px] text-ws-out">
              <Check className="h-3 w-3" />
              {t.toolAdded}
            </span>
          ) : null}
          {soon ? (
            <span className="rounded-full border border-white/[0.12] px-2 py-[2px] text-[11.5px] text-ws-4">
              {t.toolSoon}
            </span>
          ) : null}
        </span>
        <span className="mt-1.5 block text-[13px] leading-relaxed text-ws-3">
          {t[text.short]}
        </span>
        <span className="mt-2.5 flex flex-wrap gap-1.5">
          {tool.kinds.map((k) => (
            <span
              key={k}
              className="rounded-md border border-white/[0.10] px-2 py-[2px] text-[11.5px] text-ws-4"
            >
              {t[KIND_LABEL[k]]}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}

/**
 * Каталог инструментов.
 *
 * Два состояния в одном окне: список с тегами и раскрытый инструмент. Клик по
 * карточке скрывает остальные и показывает описание с кнопками — так человек не
 * теряет контекст и может вернуться назад, не закрывая окно.
 */
export function CatalogDialog() {
  const { t } = useWorkspace()
  const {
    catalog,
    catalogOpen,
    closeCatalog,
    addTool,
    addingKey,
    instanceOf,
    openTool,
    removeTool,
  } = useTools()

  const [kinds, setKinds] = useState<ToolKind[]>([])
  const [query, setQuery] = useState("")
  const [openKey, setOpenKey] = useState<string | null>(null)

  /**
   * Каталог этой установки. Пока список не пришёл, не показываем ничего: мигнуть
   * инструментом, которого здесь нет, и тут же его убрать — хуже, чем показать
   * каталог на полсекунды позже.
   */
  const available = useMemo(
    () => (catalog === null ? [] : TOOLS.filter((tool) => catalog.includes(tool.key))),
    [catalog],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return available.filter((tool) => {
      if (kinds.length && !kinds.some((k) => tool.kinds.includes(k))) return false
      if (!q) return true
      const text = toolText(tool.key)
      return `${t[text.name]} ${t[text.short]}`.toLowerCase().includes(q)
    })
  }, [available, kinds, query, t])

  const opened = openKey ? available.find((x) => x.key === openKey) : null
  const openedInstance = opened ? instanceOf(opened.key) : null

  function close(next: boolean) {
    if (next) return
    closeCatalog()
    // Сбрасываем раскрытый инструмент, чтобы окно открывалось со списка.
    setOpenKey(null)
  }

  return (
    <Dialog open={catalogOpen} onOpenChange={close}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[86vh] gap-0 overflow-hidden border-border/60 bg-ws-raised p-0 sm:max-w-[720px]"
      >
        <DialogHeader className="border-b border-white/[0.07] px-6 pb-4 pt-6">
          <DialogTitle className="pr-8 text-[18px] font-semibold tracking-tight text-ws-1">
            {opened ? t[toolText(opened.key).name] : t.catalogTitle}
          </DialogTitle>
          <p className="mt-1 text-[13px] text-ws-3">
            {opened ? t[toolText(opened.key).short] : t.catalogSub}
          </p>
        </DialogHeader>

        {opened ? (
          <div className="flex min-h-0 flex-col">
            <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap gap-1.5">
                {opened.kinds.map((k) => (
                  <span
                    key={k}
                    className="rounded-md border border-white/[0.10] px-2 py-[2px] text-[11.5px] text-ws-4"
                  >
                    {t[KIND_LABEL[k]]}
                  </span>
                ))}
              </div>
              <p className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-ws-2">
                {t[toolText(opened.key).long]}
              </p>
              {opened.status !== "ready" ? (
                <p className="mt-4 rounded-[10px] border border-white/[0.10] bg-white/[0.03] px-4 py-3 text-[13px] text-ws-3">
                  {t.toolSoonNote}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-4">
              <button
                type="button"
                onClick={() => setOpenKey(null)}
                className="flex items-center gap-2 text-[13.5px] text-ws-3 hover:text-ws-1"
              >
                <ArrowLeft className="h-[17px] w-[17px]" />
                {t.toolBack}
              </button>
              <div className="flex items-center gap-2.5">
                {openedInstance ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void removeTool(openedInstance.id)}
                      className="flex h-[42px] items-center gap-2 rounded-[10px] border border-white/10 px-4 text-[14px] text-ws-2 hover:border-destructive/50 hover:text-ws-1"
                    >
                      <Trash2 className="h-[17px] w-[17px]" />
                      {t.toolRemove}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeCatalog()
                        setOpenKey(null)
                        openTool(openedInstance.id)
                      }}
                      className="flex h-[42px] items-center rounded-[10px] bg-ws-action px-[18px] text-[14px] font-medium text-white hover:bg-ws-action-hover"
                    >
                      {t.toolOpen}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={opened.status !== "ready" || addingKey === opened.key}
                    onClick={() => void addTool(opened.key)}
                    className="flex h-[42px] items-center gap-2 rounded-[10px] bg-ws-action px-[18px] text-[14px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-50"
                  >
                    <Plus className="h-[17px] w-[17px]" />
                    {addingKey === opened.key ? t.toolAdding : t.toolAdd}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col">
            <div className="flex flex-none flex-wrap items-center gap-2.5 px-6 py-4">
              <div className="relative min-w-[200px] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-ws-4"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.catalogSearch}
                  className="h-[42px] w-full rounded-[10px] border border-white/10 bg-ws-control pl-10 pr-3 text-[14px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
                />
              </div>
            </div>

            <div className="flex flex-none flex-wrap gap-2 px-6 pb-4">
              <KindChip
                active={kinds.length === 0}
                label={t.catalogAll}
                onClick={() => setKinds([])}
              />
              {TOOL_KINDS.map((k) => (
                <KindChip
                  key={k}
                  active={kinds.includes(k)}
                  label={t[KIND_LABEL[k]]}
                  onClick={() =>
                    setKinds((prev) =>
                      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
                    )
                  }
                />
              ))}
            </div>

            <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {visible.length === 0 ? (
                <p className="py-14 text-center text-[13.5px] text-ws-4">{t.catalogEmpty}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {visible.map((tool) => (
                    <CatalogCard
                      key={tool.key}
                      tool={tool}
                      added={!!instanceOf(tool.key)}
                      onClick={() => setOpenKey(tool.key)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
