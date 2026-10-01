"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clapperboard,
  Download,
  ExternalLink,
  GitBranch,
  Eye,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Workflow,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { typesLabel } from "@/components/account/workspace/element/element-slots"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MyRun, RunOverview, SchemeNodeView, StepFile, StepView } from "@/lib/production/workspace-types"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { WorkplaceModeSwitch } from "./mode-switch"
import { NewRunButton } from "./new-run-dialog"
import { StageChat } from "./chat/stage-chat"
import { FilePreviewDialog } from "./file-preview-dialog"
import { uploadChatFile } from "./chat/upload"
import { subfolderName } from "@/lib/tools/element/names"
import { extensionFits, mimeFits } from "@/lib/tools/element/site-form"
import { canAdd, type Group, type Slot } from "@/lib/tools/element/slots"

/**
 * Рабочее место «Производство» — docs/PRODUCTION_PLAN.md §9, шаг 1.8.
 *
 * Слева — мои ролики и под каждым мои этапы; справа — выбранный этап: схема
 * всего ролика, люди и «Принято», файлы, чат. Выбранный этап — в адресе
 * (`?step=`), чтобы ссылку на него можно было прислать.
 */
export function ProductionWorkspace() {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [archived, setArchived] = useState(false)
  const [runs, setRuns] = useState<MyRun[] | null>(null)
  const [view, setView] = useState<StepView | null>(null)
  const [loadingStep, setLoadingStep] = useState(false)
  /** Приёмка идёт: копия в FINAL занимает время — кнопка показывает, что нажата. */
  const [approving, setApproving] = useState(false)
  /** Растёт на каждый живой сигнал по открытому этапу — чат перечитывает ленту. */
  const [liveTick, setLiveTick] = useState(0)
  const selected = params.get("step")
  /** Открыт обзор ролика (`?run=`) — «этап без чата»: схема и принятое. */
  const selectedRun = params.get("run")
  const [overview, setOverview] = useState<RunOverview | null>(null)

  const select = useCallback(
    (stepId: string) => router.replace(`${pathname}?step=${encodeURIComponent(stepId)}`),
    [pathname, router],
  )
  const selectRun = useCallback(
    (runId: string) => router.replace(`${pathname}?run=${encodeURIComponent(runId)}`),
    [pathname, router],
  )

  const loadOverview = useCallback(async () => {
    if (!selectedRun) {
      setOverview(null)
      return
    }
    const res = await fetch(`/api/production/runs/${encodeURIComponent(selectedRun)}/overview`, { cache: "no-store" })
    setOverview(res.ok ? ((await res.json()) as { overview: RunOverview }).overview : null)
  }, [selectedRun])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const loadRuns = useCallback(async () => {
    const res = await fetch(`/api/production/my${archived ? "?archived=1" : ""}`, { cache: "no-store" })
    if (!res.ok) {
      toast.error(t.productionLoadFailed)
      setRuns([])
      return []
    }
    const body = (await res.json()) as { runs: MyRun[] }
    setRuns(body.runs)
    return body.runs
  }, [archived, t])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  // Ничего не выбрано — открываем первый этап первого ролика.
  useEffect(() => {
    const first = runs?.find((r) => r.steps.length > 0)?.steps[0]
    if (!selected && !selectedRun && first) select(first.id)
  }, [runs, selected, selectedRun, select])

  const loadStep = useCallback(async () => {
    if (!selected) {
      setView(null)
      return
    }
    setLoadingStep(true)
    try {
      const res = await fetch(`/api/production/steps/${encodeURIComponent(selected)}`, { cache: "no-store" })
      setView(res.ok ? ((await res.json()) as { step: StepView }).step : null)
    } finally {
      setLoadingStep(false)
    }
  }, [selected])

  useEffect(() => {
    void loadStep()
  }, [loadStep])

  /**
   * Живое обновление (§7.3): один поток на раздел. Сигнал по открытому этапу —
   * перечитать чат и файлы; по любому — счётчики непрочитанного в списке.
   * Обрыв EventSource переподключает сам.
   */
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const reloadTimer = useRef<number | null>(null)
  useEffect(() => {
    const source = new EventSource("/api/production/stream")
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { stepId: string; type: string }
      if (data.stepId === selectedRef.current) {
        setLiveTick((n) => n + 1)
        if (data.type === "message") void loadStep()
      }
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        void loadRuns()
        void loadOverview()
      }, 500)
    }
    return () => source.close()
  }, [loadOverview, loadRuns, loadStep])

  /**
   * «Принято» — у инструмента последний вариант, с `fileId` — выбранный; у
   * формы и автоматики — вся рабочая папка (§4.1). Без подтверждения: принятый
   * этап можно вернуть в работу или ответвить ролик от него.
   */
  const approve = async (file?: { id: string; name: string }) => {
    if (!view || approving) return
    const target = view.kind === "tool" ? (file ?? view.files.work[0]) : null
    if (view.kind === "tool" && !target) return
    setApproving(true)
    try {
      const res = await fetch(`/api/production/steps/${view.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(file ? { fileId: file.id } : {}),
      })
      const body = (await res.json().catch(() => ({}))) as { code?: string; runDone?: boolean }
      if (!res.ok) {
        toast.error(
          body.code === "closed"
            ? t.productionApproveClosed
            : body.code === "no-variant"
              ? t.productionApproveNoVariant
              : body.code === "form-incomplete"
                ? t.productionFormIncomplete
                : t.productionApproveFailed,
        )
      } else {
        toast.success(body.runDone ? t.productionRunDone : t.productionApproved)
      }
      await Promise.all([loadStep(), loadRuns()])
    } finally {
      setApproving(false)
    }
  }

  /** Вернуть принятый этап в работу: следующие пройдут заново — спрашиваем. */
  const reopen = async () => {
    if (!view || !window.confirm(t.productionReopenConfirm)) return
    const res = await fetch(`/api/production/steps/${view.id}/reopen`, { method: "POST" })
    const body = (await res.json().catch(() => ({}))) as { redo?: number }
    if (!res.ok) toast.error(t.productionReopenFailed)
    else toast.success(body.redo ? t.productionReopenedRedo.replace("{n}", String(body.redo)) : t.productionReopened)
    await Promise.all([loadStep(), loadRuns()])
  }

  /** Ветка ролика от этого этапа — сразу открываем её этап. */
  const branch = async () => {
    if (!view || !window.confirm(t.productionBranchConfirm)) return
    const res = await fetch(`/api/production/steps/${view.id}/branch`, { method: "POST" })
    const body = (await res.json().catch(() => ({}))) as { stepId?: string }
    if (!res.ok || !body.stepId) {
      toast.error(t.productionBranchFailed)
      return
    }
    toast.success(t.productionBranched)
    await loadRuns()
    select(body.stepId)
  }

  const rerun = async () => {
    if (!view || !window.confirm(t.productionRerunConfirm)) return
    const res = await fetch(`/api/production/steps/${view.id}/rerun`, { method: "POST" })
    if (!res.ok) toast.error(t.productionRerunFailed)
    else toast.success(t.productionRerunDone)
    await loadStep()
  }

  const toggleMark = async () => {
    if (!view) return
    const res = await fetch(`/api/production/steps/${view.id}/mark`, { method: "POST" })
    if (!res.ok) {
      toast.error(t.productionMarkFailed)
      return
    }
    await Promise.all([loadStep(), loadRuns()])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <WorkplaceModeSwitch />
          <span className="rounded-md border border-foreground/10 px-2 py-0.5 text-[11px] font-medium text-ws-4">
            {t.productionInDevelopment}
          </span>
        </div>
        <div className="flex items-center gap-2">
        {/* Вход в пайплайны и в шапке: колонка роликов, где он тоже есть, на
            узком экране скрыта. */}
        <Link
          href="/account/production/pipelines"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
        >
          <Workflow className="h-4 w-4" />
          {t.productionPipelines}
        </Link>
        <NewRunButton
          onLaunched={async (runId) => {
            setArchived(false)
            const fresh = await loadRuns()
            const first = fresh.find((r) => r.id === runId)?.steps[0]
            if (first) select(first.id)
          }}
        />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <RunsColumn
          runs={runs}
          selected={selected}
          onSelect={select}
          selectedRun={selectedRun}
          onSelectRun={selectRun}
          archived={archived}
          onArchived={setArchived}
          onRunsChanged={(goneRunId) => {
            // Выбранный этап был в ушедшем ролике — снимаем выбор, откроется первый.
            const gone = runs?.find((r) => r.id === goneRunId)
            if (gone?.steps.some((s) => s.id === selected)) router.replace(pathname)
            void loadRuns()
          }}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* На телефоне колонки роликов нет — выбор этапа списком над этапом. */}
          <MobileStepPicker
            runs={runs}
            selected={selected}
            onSelect={select}
            selectedRun={selectedRun}
            onSelectRun={selectRun}
          />

          {selectedRun ? (
            overview ? (
              <RunOverviewPanel overview={overview} onOpenStep={select} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-ws-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )
          ) : view ? (
            <>
              {/* Верх закреплён: схема и шапка этапа всегда на месте,
                  прокручиваются только файлы и чат. */}
              <SchemeStrip nodes={view.scheme.nodes} edges={view.scheme.edges} currentNodeId={view.nodeId} />
              <StageHeader
                view={view}
                approving={approving}
                onToggleMark={() => void toggleMark()}
                onApprove={() => void approve()}
                onRerun={() => void rerun()}
                onReopen={() => void reopen()}
                onBranch={() => void branch()}
                onPeopleChanged={() => void Promise.all([loadStep(), loadRuns()])}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {view.machine ? (
                  <p
                    className={cn(
                      "flex shrink-0 items-center gap-2 border-b border-foreground/[0.07] px-3 py-2 text-[12.5px] md:px-6",
                      view.machine.watched ? "text-ws-4" : "text-warning",
                    )}
                  >
                    <Bot className="h-4 w-4 shrink-0" />
                    {!view.machine.watched
                      ? t.productionMachineNotWatched
                      : view.machine.results
                        ? t.productionMachineResults
                        : view.status === "ready"
                          ? t.productionMachineWaiting
                          : null}
                  </p>
                ) : null}
                <FilesPanel view={view} onApproveFile={(file) => void approve(file)} onFilesChanged={() => void loadStep()} />
                {view.form ? <FormPanel view={view} onChanged={() => void loadStep()} /> : null}
                {view.hasChat ? (
                  <StageChat
                    key={view.id}
                    stepId={view.id}
                    tick={liveTick}
                    canApprove={canApprove(view) && view.kind === "tool"}
                    onApproveFile={(file) => void approve(file)}
                  />
                ) : (
                  <p className="flex items-center justify-center gap-2 px-6 py-8 text-[12.5px] text-ws-4">
                    <Bot className="h-4 w-4" />
                    {t.productionNoChat}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-ws-4">
              {loadingStep || runs === null ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : runs.length > 0 ? (
                <p className="text-[13px]">{t.productionPickStage}</p>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// ─── Ролики ───────────────────────────────────────────────────────────────

/**
 * Ролики — как папки в проектах (§9.1, решение 2026-09-30): название, под ним
 * тусклым — пайплайн, снизу зелёная полоса прогресса. Клик раскрывает этапы,
 * как подпапки: не начатые — тусклые, начатые — обычные, готовые — с зелёной
 * галочкой. Переключатель «В работе / Готовые и поиск по ролику и пайплайну.
 */
function RunsColumn({
  runs,
  selected,
  onSelect,
  selectedRun,
  onSelectRun,
  archived,
  onArchived,
  onRunsChanged,
}: {
  runs: MyRun[] | null
  selected: string | null
  onSelect: (stepId: string) => void
  selectedRun: string | null
  onSelectRun: (runId: string) => void
  archived: boolean
  onArchived: (value: boolean) => void
  /** Ролик переименовали, завершили или удалили — список перечитать. */
  onRunsChanged: (goneRunId?: string) => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  const runAction = async (run: MyRun, init: RequestInit, success?: string): Promise<boolean> => {
    const res = await fetch(`/api/production/runs/${encodeURIComponent(run.id)}`, {
      ...init,
      headers: { "Content-Type": "application/json" },
    })
    if (!res.ok) {
      toast.error(res.status === 403 ? t.productionRunForbidden : t.productionRunActionFailed)
      return false
    }
    if (success) toast.success(success)
    return true
  }

  const rename = async (run: MyRun) => {
    const name = draft.trim()
    setRenaming(null)
    if (!name || name === run.name) return
    if (await runAction(run, { method: "PATCH", body: JSON.stringify({ name }) })) onRunsChanged()
  }

  // Завершённый и удалённый ролик пропадает из «В работе» — выбранный в нём этап
  // больше не в списке, и родитель снимает выбор.
  const cancel = async (run: MyRun) => {
    if (!window.confirm(t.productionRunCancelConfirm.replace("{name}", run.name))) return
    const body = JSON.stringify({ status: "cancelled" })
    if (await runAction(run, { method: "PATCH", body }, t.productionRunCancelDone)) onRunsChanged(run.id)
  }

  const remove = async (run: MyRun) => {
    if (!window.confirm(t.productionRunDeleteConfirm.replace("{name}", run.name))) return
    if (await runAction(run, { method: "DELETE" }, t.productionRunDeleteDone)) onRunsChanged(run.id)
  }

  // Ролик с выбранным этапом раскрыт — иначе выбранное не видно.
  useEffect(() => {
    const owner = runs?.find((r) => r.steps.some((s) => s.id === selected))
    if (owner) setOpen((prev) => (prev.has(owner.id) ? prev : new Set(prev).add(owner.id)))
  }, [runs, selected])

  const q = query.trim().toLowerCase()
  const shown = (runs ?? []).filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.pipelineName.toLowerCase().includes(q),
  )
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <aside className="hidden shrink-0 flex-col border-r border-foreground/[0.07] lg:flex lg:w-[300px]">
      <div className="space-y-2 px-3 pb-2 pt-3">
        <div className="flex gap-[3px] rounded-[9px] border border-foreground/10 bg-ws-control p-[2px]">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => onArchived(value)}
              aria-pressed={archived === value}
              className={cn(
                "h-7 flex-1 rounded-[7px] text-[12.5px] transition-colors",
                archived === value ? "bg-ws-select/35 text-ws-1" : "text-ws-3 hover:text-ws-1",
              )}
            >
              {value ? t.productionRunsDone : t.productionRunsActive}
            </button>
          ))}
        </div>
        <label className="flex h-8 items-center gap-2 rounded-[9px] border border-foreground/10 bg-ws-control px-2.5">
          <Search className="h-3.5 w-3.5 text-ws-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.productionRunsSearch}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ws-1 outline-none placeholder:text-ws-5"
          />
        </label>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {runs === null ? (
          <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-ws-4" />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Clapperboard className="h-8 w-8 text-ws-5" />
            <p className="text-[14px] font-medium text-ws-2">{q ? t.productionRunsNotFound : t.productionRunsEmpty}</p>
            {q ? null : <p className="text-[12.5px] leading-relaxed text-ws-4">{t.productionRunsEmptyHint}</p>}
          </div>
        ) : (
          shown.map((run) => {
            const expanded = open.has(run.id)
            const unread = run.steps.reduce((sum, s) => sum + s.unread, 0)
            const percent = run.progress.total ? Math.round((run.progress.done / run.progress.total) * 100) : 0
            const hasSelected = run.steps.some((s) => s.id === selected) || selectedRun === run.id
            return (
              // Ролик и его этапы — одна карточка: рамка общая, этапы висят на
              // линии слева, как ветки одной папки.
              <div
                key={run.id}
                className={cn(
                  "group/run mb-1.5 rounded-[12px] border transition-colors",
                  expanded || hasSelected
                    ? "border-foreground/10 bg-foreground/[0.025]"
                    : "border-transparent hover:bg-ws-hover",
                )}
              >
                <div className="relative">
                  {renaming === run.id ? (
                    <form
                      className="flex items-start gap-2 px-2 py-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void rename(run)
                      }}
                    >
                      <Folder className="mt-1 h-[18px] w-[18px] shrink-0 text-ws-3" />
                      <input
                        autoFocus
                        value={draft}
                        maxLength={120}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => void rename(run)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setRenaming(null)
                        }}
                        className="h-7 min-w-0 flex-1 rounded-md border border-foreground/15 bg-ws-control px-2 text-[13.5px] text-ws-1 outline-none focus:border-ws-select"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      // Первый клик — обзор ролика и раскрыть этапы; повторный по
                      // открытому обзору — свернуть.
                      onClick={() => {
                        if (selectedRun === run.id) toggle(run.id)
                        else {
                          onSelectRun(run.id)
                          setOpen((prev) => new Set(prev).add(run.id))
                        }
                      }}
                      aria-expanded={expanded}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-[12px] px-2 py-2 pr-9 text-left",
                        selectedRun === run.id && "bg-ws-select/35",
                      )}
                    >
                      {expanded ? (
                        <FolderOpen className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ws-3" />
                      ) : (
                        <Folder className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ws-3" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ws-1">{run.name}</span>
                          {run.status === "cancelled" ? (
                            <span className="shrink-0 rounded-full border border-foreground/15 px-1.5 py-[1px] text-[10.5px] text-ws-4">
                              {t.productionRunCancelled}
                            </span>
                          ) : null}
                          {unread > 0 && !expanded ? (
                            <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-primary-foreground">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11.5px] text-ws-4">{run.pipelineName}</span>
                        <span
                          className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/10"
                          title={`${run.progress.done}/${run.progress.total}`}
                        >
                          <span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
                        </span>
                      </span>
                    </button>
                  )}

                  {run.canManage && renaming !== run.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t.productionRunActions}
                          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md text-ws-4 opacity-0 transition-opacity hover:bg-ws-hover hover:text-ws-1 focus-visible:opacity-100 group-hover/run:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem
                          onSelect={() => {
                            setDraft(run.name)
                            setRenaming(run.id)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                          {t.productionRunRename}
                        </DropdownMenuItem>
                        {run.canEditPipeline ? (
                          <DropdownMenuItem asChild>
                            <Link href={`/account/production/pipelines/${encodeURIComponent(run.pipelineId)}`}>
                              <Workflow className="h-4 w-4" />
                              {t.productionEditPipeline}
                            </Link>
                          </DropdownMenuItem>
                        ) : null}
                        {run.status === "active" ? (
                          <DropdownMenuItem onSelect={() => void cancel(run)}>
                            <CircleStop className="h-4 w-4" />
                            {t.productionRunCancel}
                          </DropdownMenuItem>
                        ) : null}
                        {run.canDelete ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => void remove(run)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t.productionRunDelete}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>

                {expanded ? (
                  <div className="relative mb-1.5 ml-[17px] mr-1.5 border-l border-foreground/[0.12] pl-2">
                    {run.steps.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => onSelect(step.id)}
                        className={cn(
                          // Короткая черта от линии к пункту: этап — ветка этого ролика.
                          "relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                          "before:absolute before:-left-2 before:top-1/2 before:h-px before:w-1.5 before:bg-foreground/[0.12]",
                          step.id === selected ? "bg-ws-select/35 text-ws-1" : "hover:bg-ws-hover",
                          step.status === "waiting" && step.id !== selected ? "text-ws-5" : "text-ws-2",
                        )}
                      >
                        {step.status === "approved" || step.status === "inherited" ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                        ) : step.redo ? (
                          <RotateCcw className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t.productionRedo} />
                        ) : step.kind === "auto" || step.kind === "action" ? (
                          <Bot className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{step.name}</span>
                        {step.unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-primary-foreground">
                            {step.unread > 99 ? "99+" : step.unread}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      {/* Пайплайны — отдельным списком внизу колонки: их видят только те, кто
          настраивает (§9.2), и остальным он не мешает. */}
      <div className="shrink-0 border-t border-foreground/[0.07] p-3">
        <Link
          href="/account/production/pipelines"
          className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <Workflow className="h-[18px] w-[18px]" />
          <span className="flex-1">{t.productionPipelines}</span>
        </Link>
      </div>
    </aside>
  )
}

/**
 * На телефоне колонки роликов нет — тот же выбор списком: ролики заголовками,
 * под каждым мои этапы; не начатые тусклые, принятые с галочкой — как в колонке.
 */
function MobileStepPicker({
  runs,
  selected,
  onSelect,
  selectedRun,
  onSelectRun,
}: {
  runs: MyRun[] | null
  selected: string | null
  onSelect: (stepId: string) => void
  selectedRun: string | null
  onSelectRun: (runId: string) => void
}) {
  const { t } = useI18n()
  if (!runs || runs.length === 0) return null
  const shownRun = runs.find((r) => r.id === selectedRun)
  const owner = runs.find((r) => r.steps.some((s) => s.id === selected))
  const current = owner?.steps.find((s) => s.id === selected)
  return (
    <div className="shrink-0 border-b border-foreground/[0.07] px-3 py-2 lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-[9px] border border-foreground/10 bg-ws-control px-2.5 text-left text-[13.5px] text-ws-1"
          >
            <Clapperboard className="h-4 w-4 shrink-0 text-ws-4" />
            <span className="min-w-0 flex-1 truncate">
              {shownRun ? (
                <>
                  <span className="text-ws-4">{shownRun.name} · </span>
                  {t.productionRunOverview}
                </>
              ) : owner && current ? (
                <>
                  <span className="text-ws-4">{owner.name} · </span>
                  {current.name}
                </>
              ) : (
                <span className="text-ws-4">{t.productionPickStage}</span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ws-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
          {runs.map((run, i) => (
            <div key={run.id}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="flex items-center gap-2 text-[12px] font-medium text-ws-3">
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate">{run.name}</span>
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => onSelectRun(run.id)}
                className={cn("pl-6 text-ws-2", run.id === selectedRun && "bg-ws-select/35")}
              >
                <Workflow className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t.productionRunOverview}</span>
              </DropdownMenuItem>
              {run.steps.map((step) => (
                <DropdownMenuItem
                  key={step.id}
                  onSelect={() => onSelect(step.id)}
                  className={cn(
                    "pl-6",
                    step.id === selected && "bg-ws-select/35",
                    step.status === "waiting" && step.id !== selected ? "text-ws-5" : "text-ws-2",
                  )}
                >
                  {step.status === "approved" || step.status === "inherited" ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : step.redo ? (
                    <RotateCcw className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{step.name}</span>
                  {step.unread > 0 ? (
                    <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-primary-foreground">
                      {step.unread > 99 ? "99+" : step.unread}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── Схема ролика ─────────────────────────────────────────────────────────

/** Шаг по вертикали: выделенный кружок с обводкой не наезжает на соседний. */
const ROW = 28
const RADIUS = 6.5
const PAD = 12
/** Радиус скругления на повороте линии. */
const TURN = 6

/**
 * Линия между этапами — горизонталь, вертикаль и снова горизонталь, со
 * скруглёнными поворотами, как на эскизе. Вертикаль посередине между
 * кружками: у развилки ветки расходятся сразу за этапом, у слияния сходятся
 * перед ним, и общий вертикальный отрезок читается как скобка.
 */
function edgePath(ax: number, ay: number, bx: number, by: number): string {
  if (Math.abs(ay - by) < 0.5) return `M ${ax} ${ay} H ${bx}`
  const xv = (ax + bx) / 2
  const dir = by > ay ? 1 : -1
  const r = Math.min(TURN, Math.abs(by - ay) / 2, (bx - ax) / 4)
  return [
    `M ${ax} ${ay}`,
    `H ${xv - r}`,
    `Q ${xv} ${ay} ${xv} ${ay + dir * r}`,
    `V ${by - dir * r}`,
    `Q ${xv} ${by} ${xv + r} ${by}`,
    `H ${bx}`,
  ].join(" ")
}

/** Половина окружности кружка — для жёлтой обводки автоматики (§3.4б). */
function halfArc(x: number, y: number, r: number, side: "left" | "right"): string {
  const sweep = side === "left" ? 0 : 1
  return `M ${x} ${y - r} A ${r} ${r} 0 0 ${sweep} ${x} ${y + r}`
}

/**
 * Схема всего ролика: кружок на этап, зелёный с галочкой — принят. Без подписей:
 * название этапа — в подсказке при наведении. Жёлтая левая половина обводки —
 * исполняет машина, правая — принимается автоматически (§3.4б). Текущий этап
 * обведён голубым. Растянута на всю ширину; сворачивается.
 */
function SchemeStrip({
  nodes,
  edges,
  currentNodeId,
  onNodeClick,
}: {
  nodes: SchemeNodeView[]
  edges: [string, string][]
  currentNodeId: string | null
  /** Кружки нажимаются — обзор ролика: показать принятое этого этапа. */
  onNodeClick?: (nodeId: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const cols = Math.max(0, ...nodes.map((n) => n.x))
  const rows = Math.max(0, ...nodes.map((n) => n.y))
  const height = rows * ROW + PAD * 2
  const step = cols > 0 ? Math.max(0, width - PAD * 2) / cols : 0
  const px = (node: SchemeNodeView) => ({ x: PAD + node.x * step, y: PAD + node.y * ROW })

  return (
    <section className="flex shrink-0 items-center gap-2 border-b border-foreground/[0.07] px-3 py-1.5 md:px-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={open ? t.productionSchemeHide : t.productionSchemeShow}
        aria-label={open ? t.productionSchemeHide : t.productionSchemeShow}
        aria-expanded={open}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open ? (
        <div ref={box} className="min-w-0 flex-1">
          {width > 0 ? (
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="block overflow-visible"
              role="img"
              aria-label={t.productionScheme}
            >
              {edges.map(([from, to]) => {
                const a = byId.get(from)
                const b = byId.get(to)
                if (!a || !b) return null
                const pa = px(a)
                const pb = px(b)
                return (
                  <path
                    key={`${from}-${to}`}
                    d={edgePath(pa.x, pa.y, pb.x, pb.y)}
                    fill="none"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    className={b.status === "approved" ? "stroke-success/70" : "stroke-foreground/20"}
                  />
                )
              })}
              {nodes.map((node) => {
                const { x, y } = px(node)
                const done = node.status === "approved" || node.status === "inherited"
                return (
                  <g
                    key={node.id}
                    onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
                    className={onNodeClick ? "cursor-pointer" : undefined}
                  >
                    <title>{node.name}</title>
                    {/* Невидимая мишень побольше кружка — по нему легче попасть. */}
                    {onNodeClick ? <circle cx={x} cy={y} r={RADIUS + 6} className="fill-transparent" /> : null}
                    {/* Переделать: оранжевое пунктирное кольцо. */}
                    {node.redo ? (
                      <circle cx={x} cy={y} r={RADIUS + 3.5} strokeWidth={1.5} strokeDasharray="2 2" className="fill-none stroke-warning" />
                    ) : null}
                    {node.id === currentNodeId ? (
                      <circle cx={x} cy={y} r={RADIUS + 3.5} strokeWidth={1.5} className="fill-none stroke-info" />
                    ) : null}
                    <circle
                      cx={x}
                      cy={y}
                      r={RADIUS}
                      strokeWidth={1.5}
                      className={done ? "fill-success stroke-success" : "fill-background stroke-foreground/35"}
                    />
                    {node.machine ? (
                      <path d={halfArc(x, y, RADIUS, "left")} fill="none" strokeWidth={2} className="stroke-warning" />
                    ) : null}
                    {node.autoApprove ? (
                      <path d={halfArc(x, y, RADIUS, "right")} fill="none" strokeWidth={2} className="stroke-warning" />
                    ) : null}
                    {done ? (
                      <path
                        d={`M ${x - 3} ${y} L ${x - 0.8} ${y + 2.3} L ${x + 3.2} ${y - 2.4}`}
                        fill="none"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="stroke-background"
                      />
                    ) : null}
                  </g>
                )
              })}
            </svg>
          ) : (
            <div style={{ height }} />
          )}
        </div>
      ) : (
        <span className="text-[12px] text-ws-4">{t.productionScheme}</span>
      )}
    </section>
  )
}

// ─── Обзор ролика ─────────────────────────────────────────────────────────

/**
 * Обзор ролика — «этап без чата»: вся схема и принятое. По умолчанию — последний
 * результат (принятые этапы, после которых принятых ещё нет); кружок на схеме
 * показывает FINAL своего этапа. Свои этапы можно открыть отсюда же.
 */
function RunOverviewPanel({ overview, onOpenStep }: { overview: RunOverview; onOpenStep: (stepId: string) => void }) {
  const { t } = useI18n()
  const [picked, setPicked] = useState<string | null>(null)
  const [preview, setPreview] = useState<StepFile | null>(null)
  useEffect(() => setPicked(null), [overview.id])

  const names = new Map(overview.scheme.nodes.map((n) => [n.id, n.name]))
  const shown = picked ? [picked] : overview.latest
  const percent = overview.progress.total ? Math.round((overview.progress.done / overview.progress.total) * 100) : 0

  return (
    <>
      <SchemeStrip
        nodes={overview.scheme.nodes}
        edges={overview.scheme.edges}
        currentNodeId={picked}
        onNodeClick={(id) => setPicked(id === picked ? null : id)}
      />
      <section className="shrink-0 border-b border-foreground/[0.07] px-3 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold text-ws-1">{overview.name}</h2>
            <p className="truncate text-[11.5px] text-ws-4">
              {overview.pipelineName} · {t.productionRunOverview}
            </p>
          </div>
          <span className="flex items-center gap-2 text-[12px] tabular-nums text-ws-4">
            <span className="block h-1 w-24 overflow-hidden rounded-full bg-foreground/10">
              <span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
            </span>
            {overview.progress.done}/{overview.progress.total}
          </span>
        </div>
      </section>
      <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 md:px-6">
        <p className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">
          {picked ? t.productionOverviewStage : t.productionOverviewLatest}
        </p>
        {shown.length === 0 ? (
          <p className="text-[12.5px] text-ws-4">{t.productionOverviewNothing}</p>
        ) : (
          shown.map((nodeId) => {
            const files = overview.finals[nodeId]
            const stepId = overview.myStepIds[nodeId]
            return (
              <div key={nodeId} className="rounded-[10px] border border-foreground/15 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ws-2">{names.get(nodeId)}</span>
                  {stepId ? (
                    <button
                      type="button"
                      onClick={() => onOpenStep(stepId)}
                      className="shrink-0 rounded-[7px] border border-foreground/15 px-2.5 py-1 text-[12px] text-ws-2 hover:border-foreground/30 hover:text-ws-1"
                    >
                      {t.productionOverviewOpenStage}
                    </button>
                  ) : null}
                </div>
                {!files ? (
                  <p className="text-[12.5px] text-ws-4">{t.productionOverviewNotApproved}</p>
                ) : files.length === 0 ? (
                  <p className="text-[12.5px] text-ws-4">{t.productionFinalEmpty}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {files.map((file) => (
                      <div key={file.id} className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate border-b border-foreground/20 px-1 pb-1 text-[13.5px] text-ws-1">
                          {file.name}
                        </span>
                        <button
                          type="button"
                          title={t.elementPreview}
                          aria-label={t.elementPreview}
                          onClick={() => setPreview(file)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-foreground/40 hover:text-ws-1"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={mediaUrl(file.s3Key)}
                          download={file.name}
                          title={t.productionChatDownload}
                          aria-label={t.productionChatDownload}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-foreground/40 hover:text-ws-1"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />
    </>
  )
}

// ─── Этап: люди и «Принято» ───────────────────────────────────────────────

/**
 * Шапка этапа: название, люди и одна кнопка — §4.1. Взявшие этап исполнители
 * стоят первыми и подсвечены. «Принято» — у проверяющих; сама приёмка — шаг 1.7.
 */
function StageHeader({
  view,
  onToggleMark,
  onApprove,
  onRerun,
  onReopen,
  onBranch,
  onPeopleChanged,
  approving,
}: {
  view: StepView
  approving: boolean
  onToggleMark: () => void
  onApprove: () => void
  onRerun: () => void
  onReopen: () => void
  onBranch: () => void
  onPeopleChanged: () => void
}) {
  const { t } = useI18n()
  const approved = view.status === "approved"
  const canMark = view.me.isExecutor && view.status === "ready"
  const latest = view.files.work[0]
  const allowed = canApprove(view)
  // Что можно принять: вариант у инструмента, выполненная форма, результат автоматики.
  const ready = view.kind === "tool" ? Boolean(latest) : view.kind === "form" ? Boolean(view.form?.complete) : Boolean(latest)
  const title = approved
    ? undefined
    : !allowed
      ? t.productionApproveHint
      : !ready
        ? view.kind === "form"
          ? t.productionFormIncomplete
          : t.productionApproveNoVariant
        : view.kind === "tool"
          ? t.productionApproveLatest.replace("{name}", latest!.name)
          : t.productionApproveAll

  return (
    <section className="shrink-0 border-b border-foreground/[0.07] px-3 py-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-[17px] font-semibold text-ws-1">
            {view.name}
            {view.redo ? (
              <span
                title={t.productionRedoHint}
                className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 text-[11px] font-medium text-warning"
              >
                <RotateCcw className="h-3 w-3" />
                {t.productionRedo}
              </span>
            ) : null}
          </h2>
          <p className="truncate text-[11.5px] text-ws-4">
            {view.runName} · {view.pipelineName}
          </p>
        </div>
        {view.kind === "auto" || view.kind === "action" ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-warning/30 bg-warning/10 px-2.5 text-[12.5px] text-warning">
            <Bot className="h-3.5 w-3.5" />
            {t.productionAutomation}
          </span>
        ) : (
          <PeopleField view={view} role="executor" canMark={canMark} onToggleMark={onToggleMark} onChanged={onPeopleChanged} />
        )}
        {view.toolKey ? (
          <Link
            href={`/account/projects?tab=tools&toolKey=${encodeURIComponent(view.toolKey)}`}
            className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t.productionOpenTool}
          </Link>
        ) : null}
        {view.kind === "auto" && allowed ? (
          <button
            type="button"
            onClick={onRerun}
            className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t.productionRerun}
          </button>
        ) : null}
        {view.kind === "action" ? null : (
        <div className="flex items-center gap-2">
          <PeopleField view={view} role="reviewer" onChanged={onPeopleChanged} />
          <button
            type="button"
            disabled={!allowed || !ready || approving}
            onClick={onApprove}
            title={title}
            aria-busy={approving}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors disabled:cursor-default",
              approved
                ? "border border-success/30 bg-success/15 text-success"
                : allowed && ready
                  ? "bg-success text-background hover:bg-success/90"
                  : "border border-foreground/10 bg-ws-control text-ws-4",
            )}
          >
            {approving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : approved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {approving ? t.productionApproving : t.productionApprove}
          </button>
          {/* Принятое можно вернуть: заменить результат здесь или ответвить ролик. */}
          {approved && (view.me.isReviewer || view.me.isOwner) ? (
            <>
              <button
                type="button"
                onClick={onReopen}
                title={t.productionReopenHint}
                className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.productionReopen}
              </button>
              <button
                type="button"
                onClick={onBranch}
                title={t.productionBranchHint}
                className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
              >
                <GitBranch className="h-3.5 w-3.5" />
                {t.productionBranch}
              </button>
            </>
          ) : null}
        </div>
        )}
      </div>
    </section>
  )
}

/** Принимать может проверяющий этапа или автор пайплайна — на открытом этапе (§6.3). */
function canApprove(view: StepView): boolean {
  return view.status === "ready" && (view.me.isReviewer || view.me.isOwner)
}

/**
 * Люди этапа — фишками. Отметившиеся исполнители первыми и голубым; свою фишку
 * исполнитель нажимает, чтобы отметиться «делаю» или снять отметку (§4.1).
 * «+» добавляет человека только в этот этап этого ролика; такие фишки с
 * крестиком. Людей пайплайна правят в пайплайне.
 */
function PeopleField({
  view,
  role,
  canMark = false,
  onToggleMark,
  onChanged,
}: {
  view: StepView
  role: "executor" | "reviewer"
  canMark?: boolean
  onToggleMark?: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [candidates, setCandidates] = useState<{ id: string; name: string; email: string }[] | null>(null)
  const [query, setQuery] = useState("")
  const people =
    role === "executor"
      ? [...view.executors].sort((a, b) => Number(b.marked) - Number(a.marked))
      : view.reviewers.map((r) => ({ ...r, marked: false }))
  const label = role === "executor" ? t.productionExecutors : t.productionReviewers

  const change = async (method: "POST" | "DELETE", userId: string) => {
    const res = await fetch(`/api/production/steps/${view.id}/people`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    })
    if (!res.ok) toast.error(t.productionPeopleFailed)
    onChanged()
  }

  const loadCandidates = async () => {
    if (candidates) return
    const res = await fetch(`/api/production/steps/${view.id}/people`, { cache: "no-store" })
    setCandidates(res.ok ? ((await res.json()) as { people: { id: string; name: string; email: string }[] }).people : [])
  }

  const q = query.trim().toLowerCase()
  const taken = new Set(people.map((p) => p.id))
  const found = (candidates ?? []).filter(
    (p) => !taken.has(p.id) && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
  )

  return (
    <div className="flex flex-wrap items-center gap-1 text-[12.5px]">
      <span className="mr-0.5 text-ws-4">{label}:</span>
      {people.length === 0 ? <span className="text-ws-4">—</span> : null}
      {people.map((person) => {
        const mine = person.id === view.me.id
        const toggles = role === "executor" && mine && canMark
        return (
          <span
            key={person.id}
            className={cn(
              "flex h-7 items-center gap-1 rounded-[8px] border px-2",
              person.marked ? "border-info/30 bg-info/15 text-info" : "border-foreground/10 bg-ws-control text-ws-2",
            )}
          >
            {toggles ? (
              <button
                type="button"
                onClick={onToggleMark}
                title={person.marked ? t.productionMarkedMark : t.productionMarkSelf}
                className="hover:underline"
              >
                {person.name}
              </button>
            ) : (
              <span title={person.marked ? t.productionMarkedMark : undefined}>{person.name}</span>
            )}
            {mine ? <span className="text-ws-4">({t.productionYou})</span> : null}
            {person.added && view.me.canEditPeople ? (
              <button
                type="button"
                onClick={() => void change("DELETE", person.id)}
                title={t.productionRemoveFromRun}
                aria-label={t.productionRemoveFromRun}
                className="text-ws-4 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        )
      })}
      {view.me.canEditPeople ? (
        <Popover onOpenChange={(open) => (open ? void loadCandidates() : setQuery(""))}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t.productionAddToRun}
              aria-label={t.productionAddToRun}
              className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-foreground/10 bg-ws-control text-ws-4 hover:bg-ws-hover hover:text-ws-1"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1.5">
            <p className="px-2 pb-1.5 pt-1 text-[11.5px] text-ws-4">{t.productionAddToRunHint}</p>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.productionEdSearchPeople}
              className="mb-1 h-8 w-full rounded-md border border-foreground/10 bg-ws-control px-2 text-[12.5px] text-ws-1 outline-none placeholder:text-ws-5"
            />
            <div className="max-h-56 overflow-y-auto">
              {candidates === null ? (
                <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-ws-4" />
              ) : found.length === 0 ? (
                <p className="px-2 py-2 text-[12px] text-ws-4">{t.productionEdNoPeople}</p>
              ) : (
                found.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => void change("POST", person.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ws-1 hover:bg-ws-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{person.name}</span>
                    <span className="truncate text-[11px] text-ws-4">{person.email}</span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

// ─── Файлы ────────────────────────────────────────────────────────────────

type FolderTab = "in" | "work" | "final"

/** Ссылка на файл через медиапрокси: ключ кодируется посегментно. */
function mediaUrl(key: string): string {
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`
}

/**
 * Файлы этапа ролика (§2.3): исходники — FINAL предыдущих этапов, «Из чата» —
 * рабочая папка, FINAL — принятое. Все три — только чтение: файлы приходят из
 * чата, а исходники и FINAL наполняет сайт. Панель сворачивается и тянется.
 */
function FilesPanel({
  view,
  onApproveFile,
  onFilesChanged,
}: {
  view: StepView
  onApproveFile: (file: StepFile) => void
  onFilesChanged: () => void
}) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  // Принятый этап открывается на FINAL: варианты уже не нужны, нужен результат.
  const [tab, setTab] = useState<FolderTab>(view.status === "approved" ? "final" : "work")
  useEffect(() => {
    setTab(view.status === "approved" ? "final" : "work")
  }, [view.id, view.status])
  const [preview, setPreview] = useState<StepFile | null>(null)
  const canEditWork = view.status === "ready" && (view.me.isExecutor || view.me.isOwner)
  const height = useDragSize({
    initial: 150,
    min: 64,
    max: 520,
    axis: "y",
    storageKey: "ffworks-production-files-height",
  })

  const tabs: { id: FolderTab; label: string; locked: boolean; count: number }[] = [
    { id: "in", label: "IN", locked: true, count: view.files.in.length },
    { id: "work", label: t.productionVersions, locked: false, count: view.files.work.length },
    { id: "final", label: "FINAL", locked: true, count: view.files.final.length },
  ]
  const files = view.files[tab]
  // Папка выбранной вкладки в «Проектах»: варианты, FINAL или копия входа.
  const folderPath = view.folders ? (tab === "work" ? view.folders.work : tab === "final" ? view.folders.final : view.folders.in) : null
  const folderHref = view.folders && folderPath
    ? `/account/projects?id=${encodeURIComponent(view.folders.projectId)}&${new URLSearchParams({ path: folderPath }).toString()}`
    : null
  const empty =
    tab === "in" ? t.productionInEmpty : tab === "final" ? t.productionFinalEmpty : t.productionVersionsFromChat

  return (
    <section className="relative shrink-0 border-b border-foreground/[0.07]">
      <div className="flex h-10 items-center gap-2 px-3 md:px-6">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t.productionFilesExpand : t.productionFilesCollapse}
          aria-label={collapsed ? t.productionFilesExpand : t.productionFilesCollapse}
          aria-expanded={!collapsed}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">
          {t.productionFiles}
        </span>
        <div className="ml-2 flex gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id)
                setCollapsed(false)
              }}
              title={item.locked ? t.productionFolderLocked : undefined}
              className={cn(
                "flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors",
                tab === item.id && !collapsed
                  ? "border-foreground/15 bg-ws-select/35 text-ws-1"
                  : "border-foreground/10 text-ws-4 hover:text-ws-1",
              )}
            >
              {item.locked ? <Lock className="h-3 w-3" /> : null}
              {item.label}
              {item.count > 0 ? <span className="text-ws-4">{item.count}</span> : null}
            </button>
          ))}
        </div>
        {folderHref ? (
          <Link
            href={folderHref}
            target="_blank"
            title={t.productionOpenFolderHint}
            className="ml-auto flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-foreground/10 px-2 text-[12px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {tab === "final" ? t.productionOpenFinal : tab === "in" ? t.productionOpenIn : t.productionOpenVersions}
            </span>
          </Link>
        ) : null}
      </div>

      {collapsed ? null : (
        <>
          <div style={{ height: height.size }} className="scrollbar-elegant overflow-y-auto px-3 pb-3 md:px-6">
            {files.length === 0 ? (
              <div className="flex h-full min-h-[40px] items-center justify-center gap-2 text-[12.5px] text-ws-4">
                {tab === "work" ? <MessageSquare className="h-3.5 w-3.5 shrink-0" /> : null}
                {empty}
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    approved={file.id === view.approvedFileId}
                    withMenu={tab === "work"}
                    canApprove={canApprove(view)}
                    onApprove={() => onApproveFile(file)}
                    onOpen={() => setPreview(file)}
                  />
                ))}
              </div>
            )}
          </div>
          <FilePreviewDialog
            file={preview}
            onClose={() => setPreview(null)}
            edit={tab === "work" && canEditWork ? { stepId: view.id, onSaved: onFilesChanged } : null}
          />
          <ResizeGrip
            orientation="horizontal"
            side="bottom"
            label={t.productionFilesResize}
            dragging={height.dragging}
            onPointerDown={height.onPointerDown}
            onKeyDown={height.onKeyDown}
          />
        </>
      )}
    </section>
  )
}

function FileRow({
  file,
  approved,
  withMenu,
  canApprove: allowed,
  onApprove,
  onOpen,
}: {
  file: StepFile
  approved: boolean
  withMenu: boolean
  canApprove: boolean
  onApprove: () => void
  /** Встроенный просмотр (и правка, где можно). */
  onOpen: () => void
}) {
  const { t } = useI18n()
  const time = new Date(file.createdAt).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]",
        approved ? "border-success/30 bg-success/10" : "border-foreground/10",
      )}
    >
      {approved ? <Check className="h-4 w-4 shrink-0 text-success" /> : null}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left font-medium text-ws-1 hover:underline"
      >
        {file.name}
      </button>
      {file.author ? <span className="shrink-0 text-ws-4">{file.author}</span> : null}
      <span className="shrink-0 tabular-nums text-ws-4">{time}</span>
      {withMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t.productionFileMenu}
              aria-label={t.productionFileMenu}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem disabled={!allowed} onSelect={onApprove}>
              <Check className="mr-2 h-4 w-4" />
              {t.productionApproveThis}
            </DropdownMenuItem>
            {!allowed ? <p className="px-2 pb-1.5 text-[11px] text-ws-4">{t.productionApproveHint}</p> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

// ─── Форма ────────────────────────────────────────────────────────────────

/**
 * Форма этапа (§3.0) — как сбор элемента в проекте: карточка на строку, в ней
 * подчёркнутое поле на каждый слот (пусто — тип, потом имя файла), глаз,
 * корзина и «Выбрать»; у строки с `≥` снизу «+». Файл можно бросить прямо на
 * поле — на подлёте зона красится по MIME, при броске проверяется расширение по
 * словарю типов конвейера. Занятые места перетаскиваются: номера в именах
 * переписывает сервер. Имя файла даёт сервер: `01 Титры - clip.srt`.
 * Править форму может исполнитель этапа, пока этап открыт.
 */
function FormPanel({ view, onChanged }: { view: StepView; onChanged: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  /** Сколько пустых мест сверх найденных добавили «+» — по строке и папке. */
  const [extra, setExtra] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<StepFile | null>(null)
  const form = view.form!
  const canEdit = view.status === "ready" && (view.me.isExecutor || view.me.isOwner)
  const sensors = useSensors(
    // Порог: без него щелчок по кнопке строки считался бы перетаскиванием.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  // Файл слота — среди файлов рабочей папки, по папке и имени.
  const fileOf = (dir: string, name: string | undefined): StepFile | null => {
    if (!name) return null
    const folder = [form.work, dir].filter(Boolean).join("/")
    return view.files.work.find((f) => f.folderPath === folder && f.name === name) ?? null
  }

  const run = async (action: () => Promise<boolean>, failed: string) => {
    setBusy(true)
    try {
      if (!(await action())) toast.error(failed)
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const remove = (file: StepFile) =>
    run(
      async () =>
        (await fetch(`/api/production/steps/${view.id}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" })).ok,
      t.productionFormRemoveFailed,
    )

  const reorder = (files: StepFile[]) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = files.findIndex((f) => f.id === active.id)
    const to = files.findIndex((f) => f.id === over.id)
    if (from < 0 || to < 0) return
    const ordered = [...files]
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved!)
    void run(
      async () =>
        (
          await fetch(`/api/production/steps/${view.id}/form/reorder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileIds: ordered.map((f) => f.id) }),
          })
        ).ok,
      t.productionFormReorderFailed,
    )
  }

  const shrink = (key: string) => setExtra((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) - 1) }))

  const renderGroups = (groups: Group[], dir: string): React.ReactNode => (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const folder = group.row.types.includes("folder")
        const key = `${dir}::${group.row.id}`
        const added = folder ? 0 : (extra[key] ?? 0)
        const slots: Slot[] = [
          ...group.slots,
          ...Array.from({ length: added }, (_, i) => ({
            rowId: group.row.id,
            label: group.row.label,
            index: group.slots.length + i + 1,
            file: null,
            folderName: null,
            groups: [],
          })),
        ]
        const files = folder ? [] : slots.map((slot) => fileOf(dir, slot.file?.name)).filter((f): f is StepFile => f !== null)
        return (
          <div key={group.row.id} className="rounded-[10px] border border-foreground/15 p-3">
            <p className="mb-2 text-[13px] text-ws-2">{group.row.label}</p>
            {folder ? (
              <div className="flex flex-col gap-2">
                {slots.map((slot) => {
                  const name = slot.folderName ?? subfolderName(slot.index, slot.label)
                  return (
                    <div key={slot.index} className="min-w-0">
                      <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-ws-4">
                        <Folder className="h-3.5 w-3.5" />
                        {name}
                      </p>
                      <div className="border-l border-foreground/10 pl-3">
                        {renderGroups(slot.groups, [dir, name].filter(Boolean).join("/"))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder(files)}>
                <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {slots.map((slot) => {
                      const file = fileOf(dir, slot.file?.name)
                      // Пустое место сверх найденных убирается без запроса; занятое — вместе с файлом.
                      const isExtra = !slot.file && slot.index > group.slots.length
                      return (
                        <SortableSlot
                          key={file?.id ?? `empty-${slot.index}`}
                          id={file?.id ?? `empty-${group.row.id}-${slot.index}`}
                          draggable={canEdit && Boolean(file) && files.length > 1 && !busy}
                        >
                          <FormSlotRow
                            stepId={view.id}
                            slot={{ rowId: group.row.id, index: slot.index, dir }}
                            types={group.row.types}
                            fileTypes={form.fileTypes}
                            name={slot.file?.name ?? null}
                            file={file}
                            canEdit={canEdit}
                            busy={busy}
                            onBusy={setBusy}
                            onPreview={setPreview}
                            onChanged={() => {
                              if (isExtra) shrink(key)
                              onChanged()
                            }}
                            onRemove={file ? () => void remove(file) : isExtra ? () => shrink(key) : null}
                          />
                        </SortableSlot>
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {canEdit && !folder && canAdd(group.row) ? (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  title={tf(t.elementAddMore, { label: group.row.label })}
                  aria-label={tf(t.elementAddMore, { label: group.row.label })}
                  disabled={busy}
                  onClick={() => setExtra((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))}
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-3 hover:border-foreground/40 hover:text-ws-1"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )

  return (
    <section className="shrink-0 border-b border-foreground/[0.07] px-3 py-3 md:px-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">{t.productionForm}</span>
        {form.complete ? (
          <span className="flex items-center gap-1 text-[12px] text-success">
            <Check className="h-3.5 w-3.5" />
            {t.productionFormComplete}
          </span>
        ) : form.missing.length > 0 ? (
          <span className="truncate text-[12px] text-ws-4">
            {t.productionFormMissing.replace("{list}", form.missing.join(", "))}
          </span>
        ) : null}
      </div>
      {renderGroups(form.state.groups, "")}
      <FilePreviewDialog
        file={preview}
        onClose={() => setPreview(null)}
        edit={canEdit ? { stepId: view.id, onSaved: onChanged } : null}
      />
    </section>
  )
}

/** Перетаскиваемое место: тянется сама строка, кнопки нажимаются (порог 4 px). */
function SortableSlot({ id, draggable, children }: { id: string; draggable: boolean; children: React.ReactNode }) {
  const sortable = useSortable({ id, disabled: !draggable })
  return (
    <div
      ref={sortable.setNodeRef}
      {...(draggable ? sortable.attributes : {})}
      {...(draggable ? sortable.listeners : {})}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(draggable && "cursor-grab", sortable.isDragging && "opacity-60")}
    >
      {children}
    </div>
  )
}

/** Одно место формы: поле-приёмник, «Посмотреть», «Убрать», «Выбрать». */
function FormSlotRow({
  stepId,
  slot,
  types,
  fileTypes,
  name,
  file,
  canEdit,
  busy,
  onBusy,
  onPreview,
  onChanged,
  onRemove,
}: {
  stepId: string
  slot: { rowId: string; index: number; dir: string }
  types: string[]
  fileTypes: Record<string, string[]>
  /** Имя файла в слоте; null — пусто. */
  name: string | null
  file: StepFile | null
  canEdit: boolean
  busy: boolean
  onBusy: (value: boolean) => void
  onPreview: (file: StepFile) => void
  onChanged: () => void
  /** null — убирать нечего: пустое место, которое требует форма. */
  onRemove: (() => void) | null
}) {
  const { t } = useI18n()
  const [over, setOver] = useState<null | "ok" | "bad">(null)
  const [percent, setPercent] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reject = (fileName: string) => {
    setOver("bad")
    toast.error(`${t.elementSlotBadType}: ${fileName}`)
    window.setTimeout(() => setOver(null), 2000)
  }

  const accept = async (picked: File) => {
    // Окончательная проверка — по расширению; отказ обязан быть заметным.
    if (!extensionFits({ fileTypes }, types, picked.name)) {
      reject(picked.name)
      return
    }
    onBusy(true)
    setPercent(0)
    try {
      const fresh = await uploadChatFile(stepId, picked, setPercent, undefined, slot)
      // Новый файл лёг под другим именем — старый уходит, иначе в папке их два.
      if (file && fresh.name !== file.name) {
        await fetch(`/api/production/steps/${stepId}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" })
      }
    } catch (error) {
      if (error instanceof Error && error.message === "bad-type") reject(picked.name)
      else toast.error(t.productionUploadFailed)
    } finally {
      setPercent(null)
      onBusy(false)
      onChanged()
    }
  }

  const drop = canEdit
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          // Во время перетаскивания имя файла скрыто — судим по MIME.
          setOver(mimeFits(types, e.dataTransfer.items[0]?.type ?? "") ? "ok" : "bad")
        },
        onDragLeave: () => setOver(null),
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setOver(null)
          const dropped = e.dataTransfer.files[0]
          if (dropped && !busy) void accept(dropped)
        },
      }
    : {}

  return (
    <div {...drop} className="flex min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <span
          className={cn(
            "block truncate border-b px-1 pb-1 text-[13.5px] transition-colors",
            percent !== null && "pr-10",
            over === "ok"
              ? "border-ws-select text-ws-1"
              : over === "bad"
                ? "border-destructive text-destructive"
                : name
                  ? "border-foreground/20 text-ws-1"
                  : "border-foreground/15 text-ws-5",
          )}
        >
          {over === "bad" ? t.elementSlotBadType : (name ?? typesLabel(types, t))}
        </span>
        {percent !== null ? (
          <>
            <span
              className="absolute inset-x-0 bottom-0 h-[2px] bg-ws-out transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-ws-3 opacity-60">
              {percent}%
            </span>
          </>
        ) : null}
      </div>

      <button
        type="button"
        title={t.elementPreview}
        aria-label={t.elementPreview}
        disabled={!file}
        onClick={() => file && onPreview(file)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-foreground/40 hover:text-ws-1 disabled:opacity-30"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>

      {canEdit ? (
        <>
          {onRemove ? (
            <button
              type="button"
              title={t.elementRemoveSlot}
              aria-label={t.elementRemoveSlot}
              disabled={busy}
              onClick={onRemove}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-destructive hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span aria-hidden className="h-6 w-6 shrink-0" />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="shrink-0 rounded-[7px] border border-foreground/15 px-2.5 py-1 text-[12.5px] text-ws-2 hover:border-foreground/30 hover:text-ws-1 disabled:opacity-50"
          >
            {t.elementChoose}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0]
              if (picked) void accept(picked)
              e.target.value = ""
            }}
          />
        </>
      ) : null}
    </div>
  )
}
