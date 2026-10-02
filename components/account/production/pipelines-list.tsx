"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Copy,
  ArrowLeft,
  CirclePause,
  CirclePlay,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type PipelineCard = {
  id: string
  name: string
  status: "draft" | "active" | "archived"
  currentVersion: number | null
  /** Счётчик блокировки: PATCH без него не примут (§3.5). */
  revision: number
  pausedAt: string | null
  activeRuns: number
  updatedAt: string
}

/**
 * Свои пайплайны — docs/PRODUCTION_PLAN.md §9.2. На карточке — статус, версия
 * и сколько роликов по нему сейчас в производстве. «Новый пайплайн» — только
 * тем, кому можно (§6.4); право приходит с сервера.
 */
export function PipelinesList() {
  const { t } = useI18n()
  const router = useRouter()
  const [items, setItems] = useState<PipelineCard[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  /** Поиск по названию; название нового пайплайна задаётся в редакторе. */
  const [query, setQuery] = useState("")
  /** Архив — отдельным разделом: это только настройки, папки остаются (§3.5). */
  const [archive, setArchive] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/production/pipelines", { cache: "no-store" })
    if (!res.ok) {
      toast.error(t.productionEdLoadFailed)
      setItems([])
      return
    }
    const body = (await res.json()) as { pipelines: PipelineCard[]; canCreate: boolean }
    setItems(body.pipelines)
    setCanCreate(body.canCreate)
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  /**
   * Управление с карточки — тем же PATCH, что сохраняет редактор. Конфликт
   * ревизии значит, что пайплайн правят прямо сейчас: перечитываем и просим
   * повторить, а не перетираем чужое.
   */
  const patch = async (item: PipelineCard, body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`/api/production/pipelines/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: item.revision, ...body }),
    })
    if (!res.ok) {
      toast.error(res.status === 409 ? t.productionEdChangedElsewhere : t.productionEdActionFailed)
    }
    await load()
    return res.ok
  }

  const rename = async (item: PipelineCard) => {
    const name = draft.trim()
    setRenaming(null)
    if (!name || name === item.name) return
    await patch(item, { name })
  }

  const confirmThen = (question: string, name: string) => window.confirm(question.replace("{name}", name))

  const togglePause = async (item: PipelineCard) => {
    await patch(item, { paused: !item.pausedAt })
  }

  const toggleArchive = async (item: PipelineCard) => {
    const archiving = item.status !== "archived"
    if (archiving && !confirmThen(t.productionEdArchiveConfirm, item.name)) return
    await patch(item, { archived: archiving })
  }

  const remove = async (item: PipelineCard) => {
    if (!confirmThen(t.productionEdDeleteConfirm, item.name)) return
    const res = await fetch(`/api/production/pipelines/${encodeURIComponent(item.id)}`, { method: "DELETE" })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      toast.error(body.code === "active-runs" ? t.productionEdDeleteBlocked : t.productionEdActionFailed)
    }
    await load()
  }

  const duplicate = async (item: PipelineCard) => {
    const res = await fetch(`/api/production/pipelines/${encodeURIComponent(item.id)}/duplicate`, { method: "POST" })
    if (!res.ok) toast.error(t.productionEdCreateFailed)
    await load()
  }

  const create = async () => {
    // Название задаётся в редакторе: здесь — только по умолчанию.
    const trimmed = t.productionEdDefaultPipelineName
    setCreating(true)
    try {
      const res = await fetch("/api/production/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          startName: t.productionEdKindStart,
        }),
      })
      if (!res.ok) {
        toast.error(t.productionEdCreateFailed)
        return
      }
      const body = (await res.json()) as { pipeline: { id: string } }
      router.push(`/account/production/pipelines/${body.pipeline.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
        <Link
          href="/account/production"
          aria-label={t.productionEdBack}
          title={t.productionEdBack}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        <h1 className="text-[17px] font-semibold text-ws-1">{t.productionPipelines}</h1>
        <div className="ml-auto flex gap-[3px] rounded-[9px] border border-foreground/10 bg-ws-control p-[2px]">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setArchive(value)}
              aria-pressed={archive === value}
              className={cn(
                "h-7 rounded-[7px] px-3 text-[12.5px] transition-colors",
                archive === value ? "bg-ws-select/35 text-ws-1" : "text-ws-3 hover:text-ws-1",
              )}
            >
              {value ? t.archiveTab : t.productionEdActiveTab}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-6">
        <div className="mb-5 flex max-w-xl gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-[9px] border border-foreground/10 bg-ws-control px-3">
            <Search className="h-4 w-4 text-ws-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.productionEdSearchPipelines}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ws-1 outline-none placeholder:text-ws-5"
            />
          </label>
          {canCreate && !archive ? (
            <button
              type="button"
              disabled={creating}
              onClick={() => void create()}
              className="flex h-9 items-center gap-1.5 rounded-[9px] bg-ws-action px-3 text-[13px] font-medium text-primary-foreground hover:bg-ws-action-hover disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t.productionEdNewPipeline}
            </button>
          ) : null}
        </div>

        {items === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-ws-4" />
        ) : shown(items, archive, query).length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Workflow className="h-8 w-8 text-ws-5" />
            <p className="text-[14px] font-medium text-ws-2">{archive ? t.archiveTab : t.productionEdNoPipelines}</p>
            <p className="max-w-md text-[12.5px] text-ws-4">
              {archive ? t.productionEdArchiveEmpty : canCreate ? t.productionEdNoPipelinesHint : t.productionEdCannotCreate}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown(items, archive, query).map((item) => (
              // Меню — рядом со ссылкой, а не внутри: кнопка в ссылке открывала бы редактор.
              <div
                key={item.id}
                className={cn(
                  "group/card relative rounded-xl border border-foreground/10 bg-ws-panel transition-colors hover:border-foreground/20",
                  item.status === "archived" && "opacity-60",
                )}
              >
                {renaming === item.id ? (
                  <form
                    className="flex items-center gap-2 p-4 pb-0"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void rename(item)
                    }}
                  >
                    <Workflow className="h-4 w-4 shrink-0 text-ws-4" />
                    <input
                      autoFocus
                      value={draft}
                      maxLength={120}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => void rename(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenaming(null)
                      }}
                      className="h-7 min-w-0 flex-1 rounded-md border border-foreground/15 bg-ws-control px-2 text-[14px] font-semibold text-ws-1 outline-none focus:border-ws-select"
                    />
                  </form>
                ) : null}
                <Link
                  href={`/account/production/pipelines/${item.id}`}
                  className={cn("block p-4 pr-11", renaming === item.id && "pt-2")}
                >
                  {renaming === item.id ? null : (
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-ws-4" />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ws-1">{item.name}</span>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ws-4">
                    <span>
                      {item.status === "draft"
                        ? t.productionEdStatusDraft
                        : item.status === "active"
                          ? t.productionEdStatusActive.replace("{v}", String(item.currentVersion ?? 1))
                          : t.productionEdStatusArchived}
                    </span>
                    {item.status === "active" && item.pausedAt ? (
                      <span className="text-warning">{t.productionEdStatusPaused}</span>
                    ) : null}
                    {item.activeRuns > 0 ? (
                      <span>{t.productionEdRunsInWork.replace("{n}", String(item.activeRuns))}</span>
                    ) : null}
                  </div>
                </Link>

                {renaming === item.id ? null : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t.productionEdPipelineActions}
                        className="absolute right-2.5 top-3 flex h-7 w-7 items-center justify-center rounded-md text-ws-4 opacity-0 transition-opacity hover:bg-ws-hover hover:text-ws-1 focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[210px]">
                      <DropdownMenuItem
                        onSelect={() => {
                          setDraft(item.name)
                          setRenaming(item.id)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        {t.productionEdRename}
                      </DropdownMenuItem>
                      {canCreate ? (
                        <DropdownMenuItem onSelect={() => void duplicate(item)}>
                          <Copy className="h-4 w-4" />
                          {t.productionEdDuplicate}
                        </DropdownMenuItem>
                      ) : null}
                      {/* Пауза — только у активного: черновик и так не запускается,
                          архивный — тем более. */}
                      {item.status === "active" ? (
                        <DropdownMenuItem onSelect={() => void togglePause(item)}>
                          {item.pausedAt ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
                          {item.pausedAt ? t.productionEdResume : t.productionEdPause}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => void toggleArchive(item)}>
                        {item.status === "archived" ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                        {item.status === "archived" ? t.productionEdRestore : t.productionEdArchive}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => void remove(item)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t.productionEdDelete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function shown(items: PipelineCard[], archive: boolean, query: string): PipelineCard[] {
  const q = query.trim().toLowerCase()
  return items.filter((item) => (item.status === "archived") === archive && (!q || item.name.toLowerCase().includes(q)))
}
