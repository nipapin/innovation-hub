"use client"

import { useCallback, useEffect, useState } from "react"

import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import type { PostScanState } from "@/lib/posting/repository"
import type { RouteReport } from "@/lib/posting/scan"
import { PostingQueuePanel } from "./queue-panel"
import { PostingRunPanel } from "./run-panel"

/**
 * Раздел «Автопостинг».
 *
 * Такт опроса один на всю страницу — как в конвейере, и по той же причине:
 * пульт и очередь смотрят на одно состояние, и разъезжаться им нельзя.
 * Опрашиваем только видимую вкладку: страницу держат открытой весь день, и
 * стучаться в сервер, когда на неё никто не смотрит, незачем.
 */

const POLL_RUNNING_MS = 15_000
const POLL_IDLE_MS = 60_000

export function PostingContent() {
  const { t } = useI18n()
  const admin = useAdminI18n()
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<PostScanState | null>(null)
  /**
   * Отчёт по маршрутам живёт в памяти страницы, а не в базе.
   *
   * Он — снимок ответа на вопрос «почему не публикуется», снятый обходом. База
   * тут была бы лишней: снимок устаревает в момент следующего обхода, и хранить
   * его значило бы показывать вчерашние причины как сегодняшние.
   */
  const [routes, setRoutes] = useState<RouteReport[]>([])
  const running = state?.isRunning === true

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(
        () => setTick((value) => value + 1),
        running ? POLL_RUNNING_MS : POLL_IDLE_MS,
      )
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setTick((value) => value + 1)
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

  const onState = useCallback((value: PostScanState | null) => {
    setState(value)
  }, [])

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={admin.postingEyebrow}
        title={t.adminPosting}
        description={t.adminPostingDesc}
      />
      <PostingRunPanel tick={tick} onState={onState} onRoutes={setRoutes} />
      <PostingQueuePanel tick={tick} routes={routes} />
    </div>
  )
}
