"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  Loader2,
  Play,
  Sliders,
  Square,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { useI18n, type Lang } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import type { PipelineState } from "@/lib/pipeline/state"
import type { TaskCounts } from "@/lib/pipeline/tasks"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { SettingsDialog } from "./settings-dialog"

function fmtTime(iso: string | null, lang: Lang): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Пульт установки: состояние слежения и одна кнопка.
 *
 * Выбирать пользователя или проект для запуска не нужно. Слежение идёт сразу по
 * всем включённым пользователям и всем их проектам, которые не на паузе и не в
 * архиве — то есть кнопка управляет одним состоянием на всю установку.
 *
 * Запуск — начать следить за папками IN и собирать объекты для обработки.
 * Стоп — прекратить и слежение, и сборку. Уже созданные задачи остаются в очереди.
 *
 * Кнопки «Очередь» здесь больше нет: очередь лежит на той же странице ниже.
 */
export function RunPanel({
  /** Общий такт опроса страницы — см. TasksPanel. */
  tick,
  /**
   * Состояние наверх целиком, а не одним флагом «идёт слежение».
   *
   * Запрос за ним делает только этот пульт, а нужно оно двоим: странице — чтобы
   * выбрать такт опроса, и шапке очереди — чтобы показать, сколько осталось до
   * следующего обхода. Второй запрос за тем же самым означал бы два ответа,
   * приезжающих вразнобой, и две разные правды на одном экране.
   */
  onState,
}: {
  tick: number
  onState: (state: PipelineState | null) => void
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()
  const [state, setState] = useState<PipelineState | null>(null)
  const [counts, setCounts] = useState<TaskCounts | null>(null)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { can } = useAdminData()
  /**
   * Ошибка опроса состояния. Показывается в строке статуса, а не тостом: опрос
   * идёт по таймеру, и тост на каждом круге был бы невыносим. Но и молчать
   * нельзя — иначе недоступный эндпоинт выглядит как беспричинно мёртвая полоса.
   */
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pipeline/state")
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setLoadError(
          data?.message ?? tf(t.pipelineStateUnavailable, { status: res.status }),
        )
        return
      }
      const data = await res.json()
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      setLoadError(null)
    } catch {
      setLoadError(t.pipelineServerUnavailable)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, tick])

  const running = state?.isRunning === true

  // Сообщаем наверх, а не заводим второй таймер: иначе счётчик в пульте и
  // таблица под ним обновлялись бы вразнобой.
  useEffect(() => {
    onState(state)
  }, [state, onState])

  const toggle = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/pipeline/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: !running }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? t.pipelineToggleError)
        return
      }
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      toast.success(
        data.state?.isRunning
          ? t.pipelineWatchStarted
          : t.pipelineWatchStopped,
      )
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setBusy(false)
    }
  }

  const inFlight = counts ? counts.claimed + counts.running : 0

  return (
    <>
      <section className="rounded-xl border border-foreground/10 bg-ws-well px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ws-4">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-[7px] w-[7px] rounded-full",
                running ? "bg-ws-out" : "bg-ws-5",
              )}
            />
            {running ? t.pipelineWatching : t.pipelineNotWatching}
          </span>
          {running && state?.startedByEmail ? (
            <span>{tf(t.pipelineStartedBy, { email: state.startedByEmail })}</span>
          ) : null}
          {state?.scannedAt ? (
            <span>
              {tf(t.pipelineLastScan, { time: fmtTime(state.scannedAt, lang) })}
            </span>
          ) : null}
          {counts ? (
            <span>
              {tf(t.pipelineCounts, {
                queued: counts.queued,
                inFlight,
                done: counts.done,
              })}
              {counts.failed > 0
                ? tf(t.pipelineCountsFailed, { failed: counts.failed })
                : ""}
            </span>
          ) : null}
          {state?.lastError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {state.lastError}
            </span>
          ) : null}
          {loadError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {loadError}
            </span>
          ) : null}
        </div>

        <div className="flex items-stretch gap-3">
          <button
            type="button"
            onClick={() => void toggle()}
            // Гасим только на время самого запроса. Раньше кнопка блокировалась
            // и при state === null, то есть при недоступном эндпоинте состояния —
            // запустить конвейер становилось нечем, и почему, было не видно.
            disabled={busy}
            className={cn(
              "flex h-[52px] flex-1 items-center justify-center gap-3 rounded-[11px] text-[16px] font-semibold text-white",
              "disabled:opacity-60",
              running
                ? "bg-destructive hover:brightness-110"
                : "bg-ws-action hover:bg-ws-action-hover",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : running ? (
              <Square className="h-[18px] w-[18px]" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            {running ? t.pipelineStop : t.pipelineStart}
          </button>

          {/* Словари общие на всю установку, а не на проект или пользователя,
              поэтому кнопка стоит здесь — рядом с очередью, которая тоже
              относится ко всей установке. */}
          {/* Правка словарей — отдельный тег: они разъезжаются на весь парк
              машин, и работать с конвейером можно, не имея права их менять. */}
          {can("settings.write") ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-[52px] shrink-0 items-center gap-2.5 rounded-[11px] border border-foreground/[0.14] px-5 text-[14px] text-ws-2 hover:bg-foreground/5"
            >
              <Sliders className="h-[18px] w-[18px]" />
              {t.pipelineSettings}
            </button>
          ) : null}
        </div>
      </section>

      {settingsOpen ? (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  )
}
