"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, Play, RefreshCw, Square } from "lucide-react"
import { toast } from "sonner"

import { useI18n, type Lang } from "@/components/account/i18n"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { Input } from "@/components/ui/input"
import type { PostJobStatus } from "@/lib/posting/jobs"
import type { PostScanState } from "@/lib/posting/repository"
import type { RouteReport } from "@/lib/posting/scan"
import { cn } from "@/lib/utils"

/**
 * Пульт автопостинга: одно состояние на всю установку.
 *
 * Устроен как пульт конвейера и намеренно им же и выглядит — это тот же вопрос
 * «идёт ли работа», и человек, знающий одну страницу, читает вторую без
 * обучения. Разница в кнопке обхода: у конвейера обход папок IN страховочный,
 * здесь он — основной механизм, потому что темп задают сами маршруты.
 *
 * Пуск и остановка касаются только ПОСТАНОВКИ задач. Уже стоящие в очереди
 * остаются: «остановить обход» и «отменить запланированные публикации» —
 * разные решения, и второе принимается по каждой задаче отдельно.
 */

function fmtTime(iso: string | null, lang: Lang): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function PostingRunPanel({
  tick,
  onState,
  onRoutes,
}: {
  tick: number
  onState: (state: PostScanState | null) => void
  /** Отчёт по маршрутам приходит только от обхода — его показывает панель ниже. */
  onRoutes: (routes: RouteReport[]) => void
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()
  const [state, setState] = useState<PostScanState | null>(null)
  const [counts, setCounts] = useState<Record<PostJobStatus, number> | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [intervalDraft, setIntervalDraft] = useState<string>("")
  /**
   * Ошибка опроса — в строке статуса, а не тостом: опрос идёт по таймеру, и
   * тост на каждом круге был бы невыносим. Но и молчать нельзя — недоступный
   * эндпоинт иначе выглядит как беспричинно мёртвая полоса.
   */
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/posting/state")
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setLoadError(
          data?.message ?? tf(t.postingStateUnavailable, { status: res.status }),
        )
        return
      }
      const data = await res.json()
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      setLoadError(null)
    } catch {
      setLoadError(t.postingServerUnavailable)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, tick])

  useEffect(() => {
    onState(state)
    // Поле периода ведём от сервера, пока в него не начали печатать: иначе
    // опрос по таймеру затирал бы наполовину введённое число.
    if (state && intervalDraft === "") {
      setIntervalDraft(String(state.scanIntervalMin))
    }
  }, [state, onState, intervalDraft])

  const running = state?.isRunning === true

  const patch = async (body: Record<string, unknown>, okMessage: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/posting/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? t.postingToggleError)
        return
      }
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      toast.success(okMessage)
    } catch {
      toast.error(t.postingServerUnavailable)
    } finally {
      setBusy(false)
    }
  }

  const scanNow = async () => {
    setScanning(true)
    try {
      const res = await fetch("/api/admin/posting/scan", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? t.postingScanError)
        return
      }
      onRoutes(data.routes ?? [])
      toast.success(tf(t.postingScanDone, { created: data.created ?? 0 }))
      await load()
    } catch {
      toast.error(t.postingServerUnavailable)
    } finally {
      setScanning(false)
    }
  }

  const saveInterval = async () => {
    const minutes = Number.parseInt(intervalDraft, 10)
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return
    if (state && minutes === state.scanIntervalMin) return
    await patch({ scanIntervalMin: minutes }, t.postingIntervalSaved)
  }

  const inFlight = counts ? counts.running : 0

  return (
    <section className="rounded-xl border border-white/10 bg-ws-well px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ws-4">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              running ? "bg-ws-out" : "bg-ws-5",
            )}
          />
          {running ? t.postingRunning : t.postingStopped}
        </span>
        {state?.scannedAt ? (
          <span>
            {tf(t.postingLastScan, { time: fmtTime(state.scannedAt, lang) })}
          </span>
        ) : null}
        {counts ? (
          <span>
            {tf(t.postingCounts, {
              queued: counts.queued,
              inFlight,
              done: counts.done,
            })}
            {counts.failed > 0
              ? tf(t.postingCountsFailed, { failed: counts.failed })
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
          onClick={() =>
            void patch(
              { running: !running },
              running ? t.postingHalted : t.postingStarted,
            )
          }
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
          {running ? t.postingStop : t.postingStart}
        </button>

        {/* Обход по кнопке нужен ровно там, где задают вопрос «файл лежит, а
            публикации нет»: он не только ставит задачи, но и объясняет, почему
            не поставил — отчётом по маршрутам в панели ниже. */}
        <button
          type="button"
          onClick={() => void scanNow()}
          disabled={scanning || !running}
          className="flex h-[52px] shrink-0 items-center gap-2.5 rounded-[11px] border border-white/[0.14] px-5 text-[14px] text-ws-2 hover:bg-white/5 disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <RefreshCw className="h-[18px] w-[18px]" />
          )}
          {t.postingScanNow}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-ws-4">
          {t.postingInterval}
          <Input
            value={intervalDraft}
            onChange={(event) => setIntervalDraft(event.target.value)}
            onBlur={() => void saveInterval()}
            inputMode="numeric"
            className="h-7 w-20 text-right font-mono text-[13px]"
          />
        </label>
        <span className="text-[11.5px] leading-relaxed text-ws-5">
          {t.postingIntervalHint}
        </span>
      </div>
    </section>
  )
}
