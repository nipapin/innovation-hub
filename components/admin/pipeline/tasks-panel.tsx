"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  FolderSearch,
  Loader2,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useAdminI18n, type AdminDict } from "@/components/admin/admin-dict"
import { useI18n, type Lang } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import type { PipelineTask, TaskCounts, TaskStatus } from "@/lib/pipeline/tasks"
import type { SkippedProject } from "@/lib/pipeline/scan"
import { SKIP_LABEL } from "./skip-labels"
import { StepList, StepStrip, stepProgress } from "./task-steps"

/**
 * Остаток до обхода часами: `MM:SS`, а после часа — `HH:MM`.
 *
 * Обе формы влезают в один слот и не растут: период обхода сверху ограничен
 * сутками, то есть больше `24:00` не покажет. Секунды до часа важнее минут после
 * него — рядом с концом отсчёта на них и смотрят.
 */
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, "0")
  if (total >= 3600) return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}`
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

const STATUS_KEY: Record<TaskStatus, keyof AdminDict> = {
  queued: "taskQueued",
  claimed: "taskClaimed",
  running: "taskRunning",
  done: "taskDone",
  failed: "taskFailed",
}

const STATUS_CLASS: Record<TaskStatus, string> = {
  queued: "border-foreground/[0.14] text-ws-3",
  claimed: "border-ws-select/50 bg-ws-select/[0.12] text-primary",
  running: "border-ws-out/40 bg-ws-out/10 text-ws-out",
  done: "border-foreground/[0.12] text-ws-4",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
}

function fmtTime(iso: string | null, lang: Lang): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Очередь: что нашлось, какая машина взяла задачу и её текущее состояние.
 *
 * Раньше это было модальное окно рядом с полосой запуска. Оно и стало причиной
 * переделки: страницу конвейера открывают именно ради вопроса «что сейчас идёт
 * и не встало ли», а ответ на него был спрятан за кнопкой — на самой странице от
 * него оставалась полоска счётчиков. Место под очередь освободилось, когда
 * колонки с чужими папками уехали в «Папки пользователей»
 * (docs/ADMIN_WORKSPACE_PLAN.md §1).
 *
 * Внутри две зоны, а не одна таблица со всем подряд. «В работе» — то, ради чего
 * страницу открывают; «Завершено» — история, которая иначе за неделю работы
 * вытеснит живую задачу с экрана. Зоны, а не вкладки: пустая зона «в работе» —
 * сама по себе ответ («ничего не идёт»), а на вкладке этого не видно, пока не
 * переключишься.
 */
export function TasksPanel({
  /**
   * Такт опроса снаружи: страница спрашивает состояние и очередь одним
   * ритмом. Два независимых таймера на одной странице означали бы, что счётчик
   * в шапке и таблица под ним расходятся на несколько секунд — и именно в тот
   * момент, когда на них смотрят вместе.
   */
  tick,
  /** Идёт ли слежение: обход ему подчинён и при «Стопе» отвечает отказом. */
  running,
  /** Когда обход проходил последний раз и с каким периодом ходит. */
  sweptAt,
  sweepIntervalMin,
}: {
  tick: number
  running: boolean
  sweptAt: string | null
  sweepIntervalMin: number
}) {
  const t = useAdminI18n()
  const [live, setLive] = useState<PipelineTask[]>([])
  const [finished, setFinished] = useState<PipelineTask[]>([])
  const [counts, setCounts] = useState<TaskCounts | null>(null)
  const [loading, setLoading] = useState(true)
  /** История свёрнута по умолчанию: открывают окно ради живых задач. */
  const [historyOpen, setHistoryOpen] = useState(false)
  /** Раскрытые задачи. Свёрнутая не держит список шагов в DOM — тот же приём,
   *  что unmountOnExit у аккордеона лог-окна. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** Задача, по которой сейчас идёт запрос: гасим её кнопки, а не всю таблицу. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)
  /**
   * Секунда для часов обратного отсчёта — свой такт, а не общий такт страницы.
   * Тот ходит раз в десять секунд и запрашивает сервер; часам сервер не нужен,
   * им нужно только текущее время.
   */
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    // Расписание снято — считать нечего, часы показывают прочерки.
    if (sweepIntervalMin <= 0) return
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (!id) id = setInterval(() => setNowMs(Date.now()), 1000)
    }
    const stop = () => {
      if (id) clearInterval(id)
      id = null
    }
    // Секундный таймер в скрытой вкладке — ровно та трата, которую страница уже
    // однажды убрала у своего опроса. Возвращаясь, сразу показываем верное
    // время, а не досчитываем с того места, где остановились.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now())
        start()
      } else stop()
    }
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [sweepIntervalMin])

  /**
   * Сколько осталось до обхода по расписанию.
   *
   * Цифрами и в слоте постоянной ширины: подпись меняется каждую секунду, и
   * «через 12 мин» → «через 9 мин» дёргало бы кнопку, а с ней и всё, что правее.
   * Поэтому на кнопке только часы, а словами — что это значит — в подсказке.
   */
  const left = (() => {
    if (sweepIntervalMin <= 0) return null
    const dueAt = sweptAt
      ? Date.parse(sweptAt) + sweepIntervalMin * 60_000
      : nowMs
    return Math.max(0, dueAt - nowMs)
  })()

  const countdown = left === null ? "--:--" : formatLeft(left)
  const nextSweep =
    left === null
      ? t.pipelineSweepNoSchedule
      : left <= 0
        ? t.pipelineSweepSoon
        : tf(t.pipelineSweepIn, { min: Math.ceil(left / 60_000) })

  /**
   * Обход по кнопке — тот же самый, что в настройках и по расписанию.
   *
   * Здесь он потому, что вопрос «почему файл лежит, а задачи нет» возникает
   * глядя на очередь, а не на закладку настроек. Причины пропуска показываем
   * подписью к отчёту: сервер их не хранит, и другого случая их увидеть не
   * будет.
   */
  const sweepNow = async () => {
    setSweeping(true)
    try {
      const res = await fetch("/api/admin/pipeline/sweep", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (res.status === 409) {
        toast.error(t.settingsSweepStopped)
        return
      }
      if (!res.ok) {
        toast.error(data?.message ?? t.settingsSweepError)
        return
      }
      const skipped: SkippedProject[] = Array.isArray(data?.skipped)
        ? data.skipped
        : []
      toast.success(
        tf(t.settingsSweepDone, {
          created: data.created,
          scanned: data.scanned,
          known: data.known,
        }) + (data.truncated ? t.settingsSweepTruncated : ""),
        skipped.length > 0
          ? {
              description: (
                <span className="flex flex-col gap-0.5">
                  {skipped.slice(0, 5).map((item) => (
                    <span key={`${item.projectId}:${item.reason}`}>
                      {item.projectName} — {t[SKIP_LABEL[item.reason]]}
                    </span>
                  ))}
                </span>
              ),
            }
          : undefined,
      )
      await load()
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setSweeping(false)
    }
  }

  const apply = (data: unknown) => {
    const snapshot = data as {
      live?: PipelineTask[]
      finished?: PipelineTask[]
      counts?: TaskCounts
    } | null
    setLive(snapshot?.live ?? [])
    setFinished(snapshot?.finished ?? [])
    setCounts(snapshot?.counts ?? null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/pipeline/tasks")
      if (!res.ok) return
      apply(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, tick])

  /**
   * Снятие и удаление. Оба ответа приносят свежий список — перезапрашивать
   * отдельно не нужно, и таблица не мигает загрузкой.
   */
  const mutate = async (
    taskId: string,
    mode: "cancel" | "delete" | "requeue",
  ) => {
    if (mode === "delete" && !window.confirm(t.pipelineTaskDeleteConfirm)) return
    setBusyId(taskId)
    try {
      const res =
        mode === "cancel" || mode === "requeue"
          ? await fetch("/api/admin/pipeline/tasks", {
              method: mode === "cancel" ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId }),
            })
          : await fetch(
              `/api/admin/pipeline/tasks?taskId=${encodeURIComponent(taskId)}`,
              { method: "DELETE" },
            )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? t.pipelineTaskActionError)
        return
      }
      apply(data)
      // Снятая задача переезжает в «Завершено» — показываем зону, иначе кажется,
      // что строка просто исчезла.
      if (mode === "cancel") setHistoryOpen(true)
      toast.success(
        mode === "cancel"
          ? t.pipelineTaskCancelled
          : mode === "requeue"
            ? t.pipelineTaskRequeued
            : t.pipelineTaskDeleted,
      )
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setBusyId(null)
    }
  }

  const toggleTask = (taskId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })

  // Счётчики зон берём из counts, а не из длины списков: «Завершено» отдаётся
  // урезанной выборкой, и её длина сказала бы неправду о числе задач.
  const liveCount = counts
    ? counts.queued + counts.claimed + counts.running
    : live.length
  const finishedCount = counts ? counts.done + counts.failed : finished.length
  const nothingAtAll = live.length === 0 && finished.length === 0

  return (
    <section
      aria-label={t.pipelineQueueTitle}
      className="overflow-hidden rounded-xl border border-foreground/10 bg-ws-panel"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-foreground/[0.07] px-5 py-3.5">
        <h2 className="text-[16px] font-semibold text-ws-1">
          {t.pipelineQueueTitle}
        </h2>
        {counts ? (
          <span className="text-[12.5px] text-ws-4">
            {tf(t.pipelineQueueCounts, {
              queued: counts.queued,
              inFlight: counts.claimed + counts.running,
              done: counts.done,
              failed: counts.failed,
            })}
          </span>
        ) : null}
        {/*
          Две кнопки рядом, и они делают разное — отсюда подписи и подсказки.
          Одна круглая стрелка на этом месте читалась как «проверить папки», а
          перечитывала только список: файл лежал в IN, кнопку жали, ничего не
          происходило, и понять, почему, было нельзя.
        */}
        <button
          type="button"
          onClick={() => void sweepNow()}
          disabled={sweeping || !running}
          title={
            running
              ? tf(t.pipelineSweepNowTitle, { when: nextSweep })
              : t.pipelineSweepNeedRunning
          }
          className="ml-auto flex h-8 items-center gap-2 rounded-[9px] border border-foreground/[0.12] px-2.5 text-[12.5px] text-ws-2 hover:bg-foreground/5 hover:text-ws-1 disabled:opacity-40"
        >
          {sweeping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderSearch className="h-3.5 w-3.5" />
          )}
          {t.pipelineSweepNow}
          <span className="w-[46px] text-right font-mono text-[12px] tabular-nums text-ws-5">
            {countdown}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void load()}
          title={t.pipelineQueueReloadTitle}
          aria-label={t.pipelineQueueReload}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ws-3 hover:bg-foreground/5 hover:text-ws-1"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* Таблица шире экрана не растягивает страницу: скролл живёт здесь.
          Высота не ограничена — очередь и есть содержимое страницы, и прятать
          её во внутренний скролл значило бы вернуть окно, только без рамки. */}
      <div className="overflow-x-auto">
        {loading && nothingAtAll ? (
          <div className="flex justify-center py-12 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : nothingAtAll ? (
          <p className="px-5 py-12 text-center text-[13.5px] text-ws-4">
            {t.pipelineQueueEmpty}
          </p>
        ) : (
          <>
            <ZoneHeader title={t.pipelineZoneLive} count={liveCount} />
            {live.length === 0 ? (
              <p className="px-5 py-6 text-center text-[13px] text-ws-4">
                {t.pipelineZoneLiveEmpty}
              </p>
            ) : (
              <TaskTable
                tasks={live}
                expanded={expanded}
                onToggle={toggleTask}
                busyId={busyId}
                onMutate={mutate}
              />
            )}

            <ZoneHeader
              title={t.pipelineZoneFinished}
              count={finishedCount}
              note={
                finished.length < finishedCount
                  ? tf(t.pipelineZoneShownLast, { shown: finished.length })
                  : null
              }
              open={historyOpen}
              onToggle={() => setHistoryOpen((v) => !v)}
            />
            {historyOpen ? (
              finished.length === 0 ? (
                <p className="px-5 py-6 text-center text-[13px] text-ws-4">
                  {t.pipelineZoneFinishedEmpty}
                </p>
              ) : (
                <TaskTable
                  tasks={finished}
                  expanded={expanded}
                  onToggle={toggleTask}
                  busyId={busyId}
                  onMutate={mutate}
                />
              )
            ) : null}
          </>
        )}
      </div>

      {/* Что логов не будет — стоит сказать сразу: раскрыв шаг, админ по опыту
          лог-окна ждёт поток сообщений от плагина, а сюда они не приезжают. */}
      <p className="border-t border-foreground/[0.07] px-5 py-2.5 text-[11.5px] text-ws-5">
        {t.pipelineQueueFootnote}
      </p>
    </section>
  )
}

/**
 * Заголовок зоны со счётчиком. С `onToggle` — ещё и складывается: у истории это
 * нужно, у живых задач нет.
 */
function ZoneHeader({
  title,
  count,
  note,
  open,
  onToggle,
}: {
  title: string
  count: number
  note?: string | null
  open?: boolean
  onToggle?: () => void
}) {
  const body = (
    <>
      {onToggle ? (
        open ? (
          <ChevronDown className="h-3.5 w-3.5 text-ws-4" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-ws-4" />
        )
      ) : null}
      <span className="text-[11.5px] font-semibold uppercase tracking-[1px] text-ws-3">
        {title}
      </span>
      <span className="rounded-full bg-foreground/[0.08] px-2 py-[1px] text-[11.5px] tabular-nums text-ws-2">
        {count}
      </span>
      {note ? <span className="text-[11.5px] text-ws-5">{note}</span> : null}
    </>
  )

  return onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-y border-foreground/[0.06] bg-ws-well px-5 py-2 text-left hover:bg-foreground/[0.03]"
    >
      {body}
    </button>
  ) : (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-foreground/[0.06] bg-ws-well px-5 py-2">
      {body}
    </div>
  )
}

/** Таблица задач одной зоны. Разметка строки общая: зоны различаются составом. */
function TaskTable({
  tasks,
  expanded,
  onToggle,
  busyId,
  onMutate,
}: {
  tasks: PipelineTask[]
  expanded: Set<string>
  onToggle: (taskId: string) => void
  busyId: string | null
  onMutate: (taskId: string, mode: "cancel" | "delete" | "requeue") => void
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] uppercase tracking-[1px] text-ws-4">
          <th className="px-5 py-2.5 font-medium">{t.pipelineColFile}</th>
          <th className="px-3 py-2.5 font-medium">{t.pipelineColProject}</th>
          <th className="px-3 py-2.5 font-medium">{t.pipelineColSteps}</th>
          <th className="px-3 py-2.5 font-medium">{t.pipelineColMachine}</th>
          <th className="px-3 py-2.5 font-medium">{t.pipelineColState}</th>
          <th className="px-5 py-2.5 font-medium">{t.pipelineColCreated}</th>
          <th className="px-3 py-2.5 font-medium">{t.actions}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const isOpen = expanded.has(task.id)
          const hasSteps = task.steps.length > 0
          const pct = stepProgress(task.steps)
          return (
            <Fragment key={task.id}>
              <tr
                className={cn(
                  "border-t border-foreground/[0.06] align-top",
                  hasSteps && "cursor-pointer hover:bg-foreground/[0.02]",
                )}
                onClick={() => {
                  if (!hasSteps) return
                  onToggle(task.id)
                }}
              >
                <td className="max-w-[260px] px-5 py-2.5 text-ws-1">
                  <span className="flex items-center gap-1.5">
                    {hasSteps ? (
                      isOpen ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-ws-4" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-ws-4" />
                      )
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    {task.isFolder ? (
                      <span
                        title={t.pipelineFolderSource}
                        className="flex shrink-0 items-center"
                      >
                        <Folder className="h-3.5 w-3.5 text-ws-4" />
                      </span>
                    ) : null}
                    <span className="truncate">{task.sourceName}</span>
                  </span>
                  {task.error ? (
                    <span className="mt-0.5 block text-[11.5px] text-destructive">
                      {task.error}
                    </span>
                  ) : null}
                  {task.quarantinedAt ? (
                    <span
                      title={t.pipelineQuarantinedTitle}
                      className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ws-4"
                    >
                      <FolderInput className="h-3 w-3 shrink-0" />
                      {t.pipelineQuarantined}
                    </span>
                  ) : null}
                </td>
                <td className="max-w-[200px] px-3 py-2.5 text-ws-2">
                  <span className="block truncate">{task.projectName}</span>
                  <span className="block truncate text-[11.5px] text-ws-4">
                    {task.ownerEmail}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-ws-3">
                  {hasSteps ? (
                    <span className="flex flex-col gap-1">
                      <StepStrip steps={task.steps} />
                      <span className="flex items-center gap-1.5">
                        <span className="h-[3px] w-16 overflow-hidden rounded-full bg-foreground/[0.08]">
                          <span
                            className="block h-full rounded-full bg-ws-out"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="text-[11px] tabular-nums text-ws-5">
                          {pct}%
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="tabular-nums">{task.stepCount}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ws-3">
                  {task.machineName ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-[3px] text-[11.5px]",
                      STATUS_CLASS[task.status],
                    )}
                  >
                    {t[STATUS_KEY[task.status]]}
                  </span>
                  {task.attempts > 0 ? (
                    <span className="ml-1.5 text-[11.5px] text-ws-4">
                      {tf(t.pipelineAttempts, { count: task.attempts })}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-ws-4">
                  {fmtTime(task.createdAt, lang)}
                </td>
                {/* stopPropagation: клик по строке раскрывает шаги, и кнопки
                    не должны заодно её разворачивать. */}
                <td
                  className="whitespace-nowrap px-3 py-2.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="flex items-center gap-0.5">
                    {task.status === "queued" ||
                    task.status === "claimed" ||
                    task.status === "running" ? (
                      <button
                        type="button"
                        onClick={() => void onMutate(task.id, "cancel")}
                        disabled={busyId === task.id}
                        title={t.pipelineTaskCancelTitle}
                        aria-label={t.pipelineTaskCancel}
                        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-foreground/5 hover:text-ws-1 disabled:opacity-40"
                      >
                        {busyId === task.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                    {task.quarantinedAt ? (
                      <button
                        type="button"
                        onClick={() => void onMutate(task.id, "requeue")}
                        disabled={busyId === task.id}
                        title={t.pipelineTaskRequeueTitle}
                        aria-label={t.pipelineTaskRequeue}
                        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-foreground/5 hover:text-ws-1 disabled:opacity-40"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void onMutate(task.id, "delete")}
                      disabled={busyId === task.id}
                      title={t.pipelineTaskDeleteTitle}
                      aria-label={t.delete}
                      className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </td>
              </tr>
              {isOpen && hasSteps ? (
                <tr className="border-t border-foreground/[0.04] bg-black/20">
                  <td colSpan={7} className="px-5 py-1">
                    <StepList steps={task.steps} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
