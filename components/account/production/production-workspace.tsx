"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Search,
  Upload,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MyRun, SchemeNodeView, StepFile, StepView } from "@/lib/production/workspace-types"
import { cn } from "@/lib/utils"
import { WorkplaceModeSwitch } from "./mode-switch"
import { NewRunButton } from "./new-run-dialog"
import { StageChat } from "./chat/stage-chat"
import { uploadChatFile } from "./chat/upload"
import { subfolderName } from "@/lib/tools/element/names"

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
  /** Растёт на каждый живой сигнал по открытому этапу — чат перечитывает ленту. */
  const [liveTick, setLiveTick] = useState(0)
  const selected = params.get("step")

  const select = useCallback(
    (stepId: string) => router.replace(`${pathname}?step=${encodeURIComponent(stepId)}`),
    [pathname, router],
  )

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
    if (!selected && runs && runs[0]?.steps[0]) select(runs[0].steps[0].id)
  }, [runs, selected, select])

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
      reloadTimer.current = window.setTimeout(() => void loadRuns(), 500)
    }
    return () => source.close()
  }, [loadRuns, loadStep])

  /**
   * «Принято» — у инструмента последний вариант, с `fileId` — выбранный; у
   * формы и автоматики — вся рабочая папка (§4.1). Спрашиваем подтверждение:
   * приёмку не отменить, файлы уходят в FINAL и дальше по схеме.
   */
  const approve = async (file?: { id: string; name: string }) => {
    if (!view) return
    const target = view.kind === "tool" ? (file ?? view.files.work[0]) : null
    if (view.kind === "tool" && !target) return
    const question = target
      ? t.productionApproveConfirm.replace("{name}", target.name)
      : t.productionApproveAllConfirm.replace("{n}", String(view.files.work.length))
    if (!window.confirm(question)) return
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
          archived={archived}
          onArchived={setArchived}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* На телефоне колонки роликов нет — выбор этапа списком над этапом. */}
          <MobileStepPicker runs={runs} selected={selected} onSelect={select} />

          {view ? (
            <>
              {/* Верх закреплён: схема и шапка этапа всегда на месте,
                  прокручиваются только файлы и чат. */}
              <SchemeStrip nodes={view.scheme.nodes} edges={view.scheme.edges} current={view} />
              <StageHeader
                view={view}
                onToggleMark={() => void toggleMark()}
                onApprove={() => void approve()}
                onRerun={() => void rerun()}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {view.form ? <FormPanel view={view} onChanged={() => void loadStep()} /> : null}
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
                <FilesPanel view={view} onApproveFile={(file) => void approve(file)} />
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
  archived,
  onArchived,
}: {
  runs: MyRun[] | null
  selected: string | null
  onSelect: (stepId: string) => void
  archived: boolean
  onArchived: (value: boolean) => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())

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
            return (
              <div key={run.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggle(run.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-ws-hover"
                >
                  {expanded ? (
                    <FolderOpen className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ws-3" />
                  ) : (
                    <Folder className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ws-3" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ws-1">{run.name}</span>
                      {unread > 0 && !expanded ? (
                        <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-white">
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
                {expanded
                  ? run.steps.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => onSelect(step.id)}
                        className={cn(
                          "ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                          step.id === selected ? "bg-ws-select/35 text-ws-1" : "hover:bg-ws-hover",
                          step.status === "waiting" && step.id !== selected ? "text-ws-5" : "text-ws-2",
                        )}
                      >
                        {step.status === "approved" || step.status === "inherited" ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                        ) : step.kind === "auto" || step.kind === "action" ? (
                          <Bot className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{step.name}</span>
                        {step.unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-white">
                            {step.unread > 99 ? "99+" : step.unread}
                          </span>
                        ) : null}
                      </button>
                    ))
                  : null}
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

function MobileStepPicker({
  runs,
  selected,
  onSelect,
}: {
  runs: MyRun[] | null
  selected: string | null
  onSelect: (stepId: string) => void
}) {
  if (!runs || runs.length === 0) return null
  return (
    <div className="shrink-0 border-b border-foreground/[0.07] px-3 py-2 lg:hidden">
      <select
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className="h-9 w-full rounded-[9px] border border-foreground/10 bg-ws-control px-2 text-[13.5px] text-ws-1 outline-none"
      >
        {runs.flatMap((run) =>
          run.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {run.name} · {step.name}
            </option>
          )),
        )}
      </select>
    </div>
  )
}

// ─── Схема ролика ─────────────────────────────────────────────────────────

const ROW = 16
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
  current,
}: {
  nodes: SchemeNodeView[]
  edges: [string, string][]
  current: StepView
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
                  <g key={node.id}>
                    <title>{node.name}</title>
                    {node.id === current.nodeId ? (
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
}: {
  view: StepView
  onToggleMark: () => void
  onApprove: () => void
  onRerun: () => void
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
          <h2 className="truncate text-[17px] font-semibold text-ws-1">{view.name}</h2>
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
          <ExecutorsSelect view={view} canMark={canMark} onToggleMark={onToggleMark} />
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
          <PeopleList label={t.productionReviewers} names={view.reviewers.map((r) => r.name)} />
          <button
            type="button"
            disabled={!allowed || !ready}
            onClick={onApprove}
            title={title}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors disabled:cursor-default",
              approved
                ? "border border-success/30 bg-success/15 text-success"
                : allowed && ready
                  ? "bg-success text-background hover:bg-success/90"
                  : "border border-foreground/10 bg-ws-control text-ws-4",
            )}
          >
            {approved ? <Check className="h-3.5 w-3.5" /> : null}
            {t.productionApprove}
          </button>
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
 * Исполнители. Отметившиеся — первыми и с голубым фоном; первый стоит на
 * кнопке списка. Отметить можно только себя — своей строкой (§4.1).
 */
function ExecutorsSelect({
  view,
  canMark,
  onToggleMark,
}: {
  view: StepView
  canMark: boolean
  onToggleMark: () => void
}) {
  const { t } = useI18n()
  const ordered = [...view.executors].sort((a, b) => Number(b.marked) - Number(a.marked))
  const head = ordered[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
        >
          <span className="text-ws-4">{t.productionExecutors}:</span>
          <span className={cn("rounded px-1", head?.marked && "bg-info/15 text-info")}>
            {head ? head.name : "—"}
          </span>
          {ordered.length > 1 ? <span className="text-ws-4">+{ordered.length - 1}</span> : null}
          <ChevronDown className="h-3.5 w-3.5 text-ws-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {ordered.map((person) => {
          const mine = person.id === view.me.id
          return (
            <DropdownMenuItem
              key={person.id}
              disabled={!(mine && canMark)}
              onSelect={() => mine && canMark && onToggleMark()}
              className={cn("data-[disabled]:opacity-100", person.marked && "bg-info/15 text-info focus:bg-info/20")}
            >
              <span className="flex-1">
                {person.name}
                {mine ? <span className="ml-1 text-ws-4">({t.productionYou})</span> : null}
              </span>
              {person.marked ? (
                <span className="text-[11px]">{t.productionMarkedMark}</span>
              ) : mine && canMark ? (
                <span className="text-[11px] text-ws-4">{t.productionMarkSelf}</span>
              ) : null}
            </DropdownMenuItem>
          )
        })}
        {ordered.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-ws-4">{t.productionNoExecutors}</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PeopleList({ label, names }: { label: string; names: string[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
        >
          <span className="text-ws-4">{label}:</span>
          <span>{names[0] ?? "—"}</span>
          {names.length > 1 ? <span className="text-ws-4">+{names.length - 1}</span> : null}
          <ChevronDown className="h-3.5 w-3.5 text-ws-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {names.map((name) => (
          <DropdownMenuItem key={name} disabled className="data-[disabled]:opacity-100">
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
}: {
  view: StepView
  onApproveFile: (file: StepFile) => void
}) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<FolderTab>("work")
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
                  />
                ))}
              </div>
            )}
          </div>
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
}: {
  file: StepFile
  approved: boolean
  withMenu: boolean
  canApprove: boolean
  onApprove: () => void
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
      <a
        href={mediaUrl(file.s3Key)}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-medium text-ws-1 hover:underline"
      >
        {file.name}
      </a>
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
 * Форма этапа (§3.0) — слоты, как при сборе материалов в проекте: у каждой
 * строки столько мест, сколько нужно, файл в месте называется `01 Титры - clip.srt`,
 * подпапка — `01 Сцена`. У строки с `≥` можно добавить ещё место. Загружает
 * исполнитель этапа, пока этап открыт.
 */
function FormPanel({ view, onChanged }: { view: StepView; onChanged: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const form = view.form!
  const canUpload = view.status === "ready" && (view.me.isExecutor || view.me.isOwner)

  const upload = async (slot: { rowId: string; index: number; dir: string }, files: FileList | null) => {
    if (!files || files.length === 0) return
    const key = `${slot.dir}|${slot.rowId}|${slot.index}`
    setBusy(key)
    try {
      await uploadChatFile(view.id, files[0], () => {}, undefined, slot)
    } catch {
      toast.error(t.productionUploadFailed)
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  const UploadButton = ({ slot, label }: { slot: { rowId: string; index: number; dir: string }; label: string }) => {
    const key = `${slot.dir}|${slot.rowId}|${slot.index}`
    return (
      <label
        className={cn(
          "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {label}
        <input
          type="file"
          className="hidden"
          onChange={(event) => {
            void upload(slot, event.target.files)
            event.target.value = ""
          }}
        />
      </label>
    )
  }

  const renderGroups = (groups: typeof form.state.groups, dir: string, depth: number): React.ReactNode => (
    <div className={cn("space-y-1.5", depth > 0 && "ml-5 border-l border-foreground/10 pl-3")}>
      {groups.map((group) => {
        const folder = group.row.type === "folder"
        const extra = group.row.op === ">=" ? group.slots.length + 1 : null
        return (
          <div key={group.row.id} className="space-y-1.5">
            {group.slots.map((slot) => {
              const slotDir = folder ? [dir, slot.folderName ?? subfolderName(slot.index, slot.label)].filter(Boolean).join("/") : dir
              return (
                <div key={`${group.row.id}-${slot.index}`} className="space-y-1.5">
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]",
                      slot.file ? "border-success/30 bg-success/5" : "border-foreground/10",
                    )}
                  >
                    {folder ? <Folder className="h-4 w-4 shrink-0 text-ws-4" /> : <FileIcon className="h-4 w-4 shrink-0 text-ws-4" />}
                    <span className="shrink-0 tabular-nums text-ws-4">{String(slot.index).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate text-ws-1">
                      {slot.label}
                      {slot.file ? <span className="ml-2 text-ws-4">{slot.file.originalName ?? slot.file.name}</span> : null}
                    </span>
                    {folder ? null : <span className="shrink-0 text-[12px] text-ws-4">{group.row.type}</span>}
                    {slot.file && !folder ? <Check className="h-4 w-4 shrink-0 text-success" /> : null}
                    {canUpload && !folder ? (
                      <UploadButton
                        slot={{ rowId: group.row.id, index: slot.index, dir }}
                        label={slot.file ? t.productionFormReplace : t.productionFormUpload}
                      />
                    ) : null}
                  </div>
                  {folder ? renderGroups(slot.groups, slotDir, depth + 1) : null}
                </div>
              )
            })}
            {canUpload && extra && !folder ? (
              <div className="flex justify-end">
                <UploadButton slot={{ rowId: group.row.id, index: extra, dir }} label={t.productionFormMore.replace("{label}", group.row.label)} />
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
      {renderGroups(form.state.groups, "", 0)}
    </section>
  )
}
