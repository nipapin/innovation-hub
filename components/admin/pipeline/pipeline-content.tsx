"use client"

import { useCallback, useEffect, useState } from "react"

import { useI18n } from "@/components/account/i18n"
import type { PipelineState } from "@/lib/pipeline/state"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { RunPanel } from "./run-panel"
import { TasksPanel } from "./tasks-panel"

/**
 * Пока слежение идёт, спрашиваем чаще — видно, что цикл живой. Такт один на всю
 * страницу: пульт и очередь смотрят на одно и то же состояние, и разъезжаться
 * им нельзя.
 */
const POLL_RUNNING_MS = 10_000
const POLL_IDLE_MS = 30_000

export function PipelineContent() {
  const { t } = useI18n()
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<PipelineState | null>(null)
  const running = state?.isRunning === true

  /**
   * Опрашиваем только видимую вкладку.
   *
   * Страницу конвейера держат открытой весь день, и раньше она стучалась в
   * сервер каждые десять секунд, даже когда на неё никто не смотрел. Возвращаясь
   * на вкладку, спрашиваем сразу: подождать полный такт, глядя на устаревшие
   * цифры, — худшее из возможных мест для экономии.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(
        () => setTick((v) => v + 1),
        running ? POLL_RUNNING_MS : POLL_IDLE_MS,
      )
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setTick((v) => v + 1)
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [running])

  const onState = useCallback((value: PipelineState | null) => {
    setState(value)
  }, [])

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={t.adminPipelineEyebrow}
        title={t.adminPipeline}
        description={t.adminPipelineDesc}
        help="pipeline.overview"
      />
      <RunPanel tick={tick} onState={onState} />
      <TasksPanel
        tick={tick}
        running={running}
        sweptAt={state?.sweptAt ?? null}
        sweepIntervalMin={state?.sweepIntervalMin ?? 0}
      />
    </div>
  )
}
