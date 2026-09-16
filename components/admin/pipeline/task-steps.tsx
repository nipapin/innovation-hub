"use client"

import { cn } from "@/lib/utils"
import type { TaskStep, TaskStepStatus } from "@/lib/pipeline/tasks"

/**
 * Шаги задачи — порт визуального языка лог-окна десктопа
 * (fs.manager.tauri/src/LOG_WIN: StepSquare, StepRow, ItemAccordion).
 *
 * Взято оттуда намеренно: цвета и форма квадратика уже знакомы по программе, и
 * человек, глядящий на конвейер, читает состояние тем же взглядом, что и локально.
 *
 * Чего здесь НЕТ и не может быть: строк логов. Лог-окно раскрывает шаг в поток
 * сообщений от плагина, а сайту логи не приезжают вовсе — см. PIPELINE.md §13.
 * Вместо них показывается `message` последнего отчёта по шагу.
 */

/** Порт STEP_COLOR из LOG_WIN/utils.ts, теми же значениями. */
const STEP_CLASS: Record<TaskStepStatus, string> = {
  queued: "bg-[#555]",
  running: "bg-[#d29922]",
  done: "bg-[#3fb950]",
  error: "bg-[#f85149]",
}

const STEP_TEXT: Record<TaskStepStatus, string> = {
  queued: "text-ws-5",
  running: "text-[#d29922]",
  done: "text-[#3fb950]",
  error: "text-[#f85149]",
}

/** Квадратик состояния: 10×10, пульсирует, пока шаг идёт. */
export function StepSquare({
  status,
  className,
}: {
  status: TaskStepStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-block h-[10px] w-[10px] shrink-0 rounded-[2px]",
        STEP_CLASS[status],
        status === "running" && "animate-pulse",
        className,
      )}
    />
  )
}

/** Доля завершённых шагов — порт progress() из LOG_WIN/utils.ts. */
export function stepProgress(steps: TaskStep[]): number {
  if (steps.length === 0) return 0
  const finished = steps.filter(
    (s) => s.status === "done" || s.status === "error",
  ).length
  return Math.round((finished / steps.length) * 100)
}

/**
 * Полоска шагов для строки задачи: вся цепочка одним взглядом.
 *
 * Ограничена по количеству: у длинного графа сорок квадратиков растянут строку и
 * перестанут читаться, поэтому хвост сворачивается в счётчик.
 */
export function StepStrip({
  steps,
  limit = 18,
}: {
  steps: TaskStep[]
  limit?: number
}) {
  if (steps.length === 0) return null
  const shown = steps.slice(0, limit)
  const hidden = steps.length - shown.length

  return (
    <span className="inline-flex items-center gap-[3px]">
      {shown.map((step) => (
        <span key={step.stepId} title={`${step.label}: ${step.status}`}>
          <StepSquare status={step.status} />
        </span>
      ))}
      {hidden > 0 ? (
        <span className="text-[11px] tabular-nums text-ws-5">+{hidden}</span>
      ) : null}
    </span>
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("ru-RU", { hour12: false })
}

/** Раскрытый список шагов: то же, что StepRow в лог-окне, но без логов. */
export function StepList({ steps }: { steps: TaskStep[] }) {
  if (steps.length === 0) return null

  return (
    <ul className="flex flex-col gap-[1px] py-1">
      {steps.map((step) => (
        <li
          key={step.stepId}
          // Левая полоска цветом состояния — как borderLeft у StepRow.
          className={cn(
            "flex items-center gap-2 border-l-2 py-[3px] pl-2.5",
            step.status === "running"
              ? "border-[#d29922]/40"
              : step.status === "done"
                ? "border-[#3fb950]/30"
                : step.status === "error"
                  ? "border-[#f85149]/40"
                  : "border-foreground/[0.08]",
          )}
        >
          <StepSquare status={step.status} />
          <span className="font-mono text-[12px] text-ws-2">{step.label}</span>
          {step.nodeType && step.nodeType !== "default" ? (
            <span className="rounded-full border border-foreground/[0.1] px-1.5 text-[10.5px] text-ws-5">
              {step.nodeType}
            </span>
          ) : null}
          {step.message ? (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ws-4">
              {step.message}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <span className={cn("text-[11px]", STEP_TEXT[step.status])}>
            {step.status}
          </span>
          <span className="w-[62px] shrink-0 text-right text-[11px] tabular-nums text-ws-5">
            {fmtTime(step.updatedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
