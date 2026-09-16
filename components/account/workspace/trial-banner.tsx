"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Gift, X } from "lucide-react"
import { tf, useI18n } from "@/components/account/i18n"
import { formatRuntime } from "@/lib/billing/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/**
 * Полоса остатка при входе в пробный проект.
 *
 * Появляется на каждом входе и через несколько секунд уходит: человеку нужно
 * помнить, сколько осталось, но не читать это постоянно. Исключение —
 * остановленный проект: там полоса не исчезает, потому что это не напоминание,
 * а объяснение, почему ничего не происходит.
 */

const AUTO_HIDE_MS = 8000

type TrialResponse = {
  trial:
    | { status: "unavailable" | "available" }
    | { status: string; projectIds: string[] }
  availableGiftCents: number
  purchasing: { runtimeSec: number } | null
}

export function TrialBanner() {
  const { t } = useI18n()
  const { selected } = useWorkspace()
  const [data, setData] = useState<TrialResponse | null>(null)
  const [hidden, setHidden] = useState(false)

  const projectId = selected?.id ?? null
  const pausedReason = selected?.pausedReason ?? null

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/trial", { cache: "no-store" })
      if (res.ok) setData((await res.json()) as TrialResponse)
    } catch {
      // Полоса — подсказка, а не функция. Молчим.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Новый проект — новый показ: полоса про то, куда человек только что вошёл.
  useEffect(() => {
    setHidden(false)
  }, [projectId])

  const stopped = pausedReason != null
  const inTrial =
    data?.trial != null &&
    "projectIds" in data.trial &&
    projectId != null &&
    data.trial.projectIds.includes(projectId)

  useEffect(() => {
    // Остановленный проект полосу не прячет: это объяснение, а не напоминание.
    if (stopped || hidden || !inTrial) return
    const timer = setTimeout(() => setHidden(true), AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [stopped, hidden, inTrial, projectId])

  if (!projectId) return null
  if (!stopped && (!inTrial || hidden)) return null

  const runtime = data?.purchasing?.runtimeSec ?? 0
  // Причина решает не только текст, но и что человеку делать: при деньгах он
  // пополняет баланс, при ключе — идёт на «Мои ключи». Показать здесь
  // «пополните баланс» значило бы послать его не туда.
  const message = stopped
    ? pausedReason === "trial-over"
      ? t.trialBannerOver
      : pausedReason === "no-vendor-key"
        ? t.trialBannerNoVendorKey
        : pausedReason === "payer-no-funds"
          ? t.trialBannerPayerNoFunds
          : t.trialBannerNoFunds
    : tf(t.trialBannerRemaining, { runtime: formatRuntime(runtime) })

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2.5 text-[13px]",
        stopped
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/25 bg-primary/10 text-primary",
      )}
    >
      {stopped ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <Gift className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {stopped ? null : (
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label={t.trialBannerDismiss}
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
