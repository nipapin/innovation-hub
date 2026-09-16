"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Folder,
  Loader2,
  TriangleAlert,
} from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import type { AccountTask } from "@/lib/pipeline/account-tasks"

/**
 * «Обработка» в правой части верхней панели кабинета.
 *
 * Отвечает на один вопрос — «что с моим файлом» — и намеренно не отвечает ни на
 * какой другой. Ни логов, ни шагов по именам плагинов, ни текста ошибки, ни
 * машины: всё это внутренняя кухня, живёт на странице конвейера и человеку
 * говорит только «у нас что-то сложное». Здесь четыре состояния, доля пройденных
 * шагов и время с начала работы.
 *
 * Место выбрано так, чтобы ничего не перекрывать. Первая версия висела плавающим
 * окном в углу поверх страницы и закрывала собой правый край панели — то есть
 * ради сообщения о работе прятала управление ею. Теперь это обычный элемент
 * строки: состояние видно всегда по самой кнопке (крутится — идёт, галочка —
 * всё стоит), а список раскрывается по клику и закрывается кликом мимо.
 *
 * Сам по себе список не разворачивается никогда, даже когда работа только
 * началась: непрошено открывшаяся панель поверх содержимого — та же помеха, от
 * которой уходили, только реже.
 */

/** Пока что-то идёт, спрашиваем часто; когда всё стоит — редко. */
const POLL_LIVE_MS = 4_000
const POLL_IDLE_MS = 30_000

function isLive(task: AccountTask): boolean {
  return task.status === "queued" || task.status === "running"
}

/** `4:07`, `1:12:40`. Секунды нужны: коротким задачам минуты нечего показать. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`
}

function percentOf(task: AccountTask): number {
  if (task.status === "done") return 100
  if (task.stepsTotal <= 0) return 0
  return Math.min(100, Math.round((task.stepsDone / task.stepsTotal) * 100))
}

export function ProcessingIndicator({ className }: { className?: string }) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<AccountTask[]>([])
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const root = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/tasks")
      if (!res.ok) return
      const data = (await res.json()) as { tasks?: AccountTask[] }
      setTasks(Array.isArray(data.tasks) ? data.tasks : [])
    } catch {
      // Сеть моргнула — оставляем прошлый снимок и ждём следующего опроса.
    }
  }, [])

  /**
   * Опрос с двумя скоростями и паузой на скрытой вкладке. Постоянные 4 секунды
   * в фоне — это запрос к базе на каждого открытого пользователя круглые сутки
   * ради экрана, на который никто не смотрит.
   */
  const live = tasks.filter(isLive).length
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(
        () => void load(),
        live > 0 ? POLL_LIVE_MS : POLL_IDLE_MS,
      )
    }
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearInterval(timer)
        timer = null
      } else {
        void load()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [load, live])

  /** Таймер тикает, только пока есть что считать и на что смотреть. */
  useEffect(() => {
    if (live === 0 || !open) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live, open])

  /** Клик мимо и Esc закрывают список — как у любого меню в строке. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Ничего не обрабатывалось — в строке пусто. Пустой элемент «обработка: 0»
  // занимал бы место и ни о чём не сообщал.
  if (tasks.length === 0) return null

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={t.processingTitle}
        className={cn(
          "flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[13px] transition-colors",
          open
            ? "border-foreground/15 bg-foreground/[0.07] text-ws-1"
            : "border-transparent text-ws-2 hover:bg-foreground/5 hover:text-ws-1",
        )}
      >
        {live > 0 ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/90" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        )}
        <span className="hidden sm:inline">{t.processingTitle}</span>
        {live > 0 ? (
          <span className="tabular-nums text-muted-foreground/90">{live}</span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/70 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+7px)] z-30 max-h-[min(60vh,520px)] w-[min(340px,calc(100vw-2rem))] overflow-y-auto rounded-[13px] border border-foreground/[0.09] bg-surface-1 py-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
          {tasks.map((task) => (
            <Row
              key={task.id}
              task={task}
              now={now}
              onOpen={() => setOpen(false)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Куда ведёт строка: в проект и сразу в ту папку, где файл лежит СЕЙЧАС.
 *
 * Именно сейчас, а не откуда его взяли: успешная обработка могла унести файл по
 * правилам графа, упавшая уносит его в папку ошибок. Ссылка «в IN» после этого
 * привела бы в пустое место. Каталог места не знает — ведём просто в проект.
 */
function hrefFor(task: AccountTask): string {
  const base = `/account/projects?id=${encodeURIComponent(task.projectId)}`
  if (task.folderPath === null) return base
  const params = new URLSearchParams({ path: task.folderPath })
  if (task.fileName) params.set("file", task.fileName)
  return `${base}&${params.toString()}`
}

function Row({
  task,
  now,
  onOpen,
}: {
  task: AccountTask
  now: number
  onOpen: () => void
}) {
  const { t } = useI18n()
  const percent = percentOf(task)
  const started = task.startedAt ? Date.parse(task.startedAt) : null
  const elapsed =
    task.status === "running" && started != null
      ? formatElapsed(now - started)
      : null

  const label =
    task.status === "queued"
      ? t.processingQueued
      : task.status === "running"
        ? t.processingRunning
        : task.status === "done"
          ? t.processingDone
          : t.processingFailed

  return (
    <Link
      href={hrefFor(task)}
      onClick={onOpen}
      className="block border-b border-foreground/[0.05] px-3 py-2 last:border-b-0 hover:bg-foreground/[0.04]">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
          {task.isFolder ? (
            <Folder className="mr-1 inline h-3 w-3 -translate-y-px text-muted-foreground/90" />
          ) : null}
          {task.name}
        </span>
        {elapsed ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/90">
            {elapsed}
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex items-center gap-2 pl-[22px]">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
          {task.projectName}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            task.status === "failed"
              ? "text-destructive"
              : task.status === "done"
                ? "text-success"
                : "text-muted-foreground/90",
          )}
        >
          {label}
        </span>
      </div>

      {task.status === "running" ? (
        <div className="ml-[22px] mt-1.5 flex items-center gap-1.5">
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
            <span
              className="block h-full rounded-full bg-primary/90 transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
            {percent}%
          </span>
        </div>
      ) : null}

      {task.status === "failed" ? (
        <p className="ml-[22px] mt-1 text-[11px] leading-snug text-muted-foreground/90">
          {t.processingFailedHint}
        </p>
      ) : null}
    </Link>
  )
}

function StatusIcon({ status }: { status: AccountTask["status"] }) {
  const className = "h-3.5 w-3.5 shrink-0"
  if (status === "queued") return <Clock className={cn(className, "text-muted-foreground/90")} />
  if (status === "running")
    return <Loader2 className={cn(className, "animate-spin text-primary/90")} />
  if (status === "done")
    return <CheckCircle2 className={cn(className, "text-success")} />
  return <TriangleAlert className={cn(className, "text-destructive")} />
}
