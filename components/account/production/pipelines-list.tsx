"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, Plus, Search, Workflow } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

type PipelineCard = {
  id: string
  name: string
  status: "draft" | "active" | "archived"
  currentVersion: number | null
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
              className="flex h-9 items-center gap-1.5 rounded-[9px] bg-ws-action px-3 text-[13px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-50"
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
              <Link
                key={item.id}
                href={`/account/production/pipelines/${item.id}`}
                className={cn(
                  "rounded-xl border border-foreground/10 bg-ws-panel p-4 transition-colors hover:border-foreground/20",
                  item.status === "archived" && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-ws-4" />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ws-1">{item.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ws-4">
                  <span>
                    {item.status === "draft"
                      ? t.productionEdStatusDraft
                      : item.status === "active"
                        ? t.productionEdStatusActive.replace("{v}", String(item.currentVersion ?? 1))
                        : t.productionEdStatusArchived}
                  </span>
                  {item.activeRuns > 0 ? (
                    <span>{t.productionEdRunsInWork.replace("{n}", String(item.activeRuns))}</span>
                  ) : null}
                </div>
              </Link>
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
