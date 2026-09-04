"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Gift, Loader2, Wallet } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, tf, useI18n } from "@/components/account/i18n"
import { formatRuntime } from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * Баланс и тестовый период одной карточкой.
 *
 * Главное число — СВОЙ баланс, подарочный второй строкой и мельче, и он
 * исчезает, когда обнуляется. Обратный порядок вреден ровно один раз, но
 * непоправимо: в момент, когда подарок кончится, человек увидит крупный ноль и
 * решит, что пропали его собственные деньги.
 */

type TrialState =
  | { status: "unavailable"; reason: string }
  | { status: "available"; amountCents: number; lifetimeDays: number | null }
  | {
      status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
      grant: { amountCents: number }
      projectIds: string[]
    }

type TrialResponse = {
  trial: TrialState
  balances: { own: number; gift: number }
  availableOwnCents: number
  availableGiftCents: number
  purchasing: { runtimeSec: number; basis: "history" | "rate" } | null
}

export function TrialCard({
  className,
  autoOpen,
}: {
  className?: string
  /** Пришли по кнопке «Попробовать бесплатно» — сразу показываем условия. */
  autoOpen?: boolean
}) {
  const { t, lang } = useI18n()
  const [data, setData] = useState<TrialResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activating, setActivating] = useState(false)
  /** Копирование идёт заметно дольше обычного — предлагаем дожать вручную. */
  const [stalled, setStalled] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/trial", { cache: "no-store" })
      if (!res.ok) return
      setData((await res.json()) as TrialResponse)
    } catch {
      // Молча: карточка баланса не та вещь, ради которой стоит показывать
      // ошибку поверх всего дашборда.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (autoOpen && data?.trial.status === "available") setDialogOpen(true)
  }, [autoOpen, data])

  /**
   * Пока копии едут — переспрашиваем. Одного отложенного запроса не хватает:
   * набор шаблонов копируется дольше пары секунд, а карточка, застрявшая на
   * «копируются» до перезагрузки страницы, читается как поломка.
   *
   * Через ~20 секунд рядом появляется «Повторить»: выдача может встать
   * (упавшая работа, перезапуск сервера), и тогда единственный выход отсюда —
   * повторный запрос, который дожмёт незаконченную выдачу. Показывать кнопку
   * сразу нельзя — она бы предлагала чинить то, что идёт нормально.
   */
  useEffect(() => {
    if (data?.trial.status !== "provisioning") {
      setStalled(false)
      return
    }
    let ticks = 0
    const timer = setInterval(() => {
      ticks++
      if (ticks === 7) setStalled(true)
      // Три минуты — и хватит: дальше человек либо нажмёт «Повторить», либо
      // вернётся позже, и опрос начнётся заново.
      if (ticks > 60) {
        clearInterval(timer)
        return
      }
      void load()
    }, 3000)
    return () => clearInterval(timer)
  }, [data?.trial.status, load])

  const activate = async () => {
    setActivating(true)
    try {
      const res = await fetch("/api/account/trial", { method: "POST" })
      if (res.status === 409) {
        const body = (await res.json()) as { code?: string }
        toast.error(
          body.code === "already-used" ? t.trialAlreadyUsed : t.trialUnavailable,
        )
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      // Дожали незаконченную выдачу — это не активация, и поздравлять с ней
      // человека, у которого период уже есть, значит сбивать с толку.
      const body = (await res.json()) as { resumed?: boolean }
      toast.success(body.resumed ? t.trialResumeStarted : t.trialActivated)
      setDialogOpen(false)
      // Копии ещё едут: перечитываем сразу, чтобы показать «готовим проекты»,
      // и ещё раз позже — к тому моменту работа обычно завершилась.
      await load()
      setTimeout(() => void load(), 4000)
    } catch {
      toast.error(t.trialActivateError)
    } finally {
      setActivating(false)
    }
  }

  const trial = data?.trial
  const gift = data?.balances.gift ?? 0
  const own = data?.balances.own ?? 0
  const runtime = data?.purchasing?.runtimeSec ?? null

  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 to-primary/5 p-[22px]",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[1.4px] text-primary/90">
          {t.cardBalance}
        </span>
        <Wallet className="h-5 w-5 text-primary/70" />
      </div>

      <Link
        href="/account/billing"
        className={cn(
          "mt-4 block text-[34px] font-bold tracking-tight hover:opacity-80",
          own < 0 && "text-destructive",
        )}
      >
        {formatBalance(own, lang)}
      </Link>

      {/* Подарочный — второй строкой и мельче. Пустой не показываем вовсе:
          израсходованный подарок не должен занимать место и объяснять себя. */}
      {gift > 0 ? (
        <div className="mt-1 text-[13px] text-muted-foreground">
          {t.trialGift}: {formatBalance(gift, lang)}
        </div>
      ) : null}

      {own < 0 ? (
        <div className="mt-2 text-[13px] text-destructive">
          {tf(t.balanceOwed, { amount: formatBalance(-own, lang) })}
        </div>
      ) : runtime != null && runtime > 0 ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          {tf(t.trialApprox, { runtime: formatRuntime(runtime) })}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {trial?.status === "available" ? (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Gift className="h-[15px] w-[15px]" />
            {t.trialActivate}
          </button>
        ) : null}

        {trial?.status === "provisioning" ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-[15px] w-[15px] animate-spin" />
            {t.trialProvisioning}
            {stalled ? (
              <button
                type="button"
                onClick={activate}
                disabled={activating}
                className="rounded-lg bg-foreground/10 px-2 py-1 text-[12px] hover:bg-foreground/[0.18] disabled:opacity-60"
              >
                {t.trialResume}
              </button>
            ) : null}
          </span>
        ) : null}

        {trial?.status === "exhausted" || trial?.status === "expired" ? (
          <span className="text-[12.5px] text-muted-foreground">{t.trialOver}</span>
        ) : null}

        {/* Отзыв отделён от «период закончился» намеренно (П9.1). Это разные
            события: одно человек ожидал, второе с ним сделали. Молчать тут
            нельзя — баланс упал и проекты встали, и пустое место на этом
            месте читается как поломка сайта. */}
        {trial?.status === "revoked" ? (
          <span className="text-[12.5px] text-amber-500/90">{t.trialRevoked}</span>
        ) : null}

        <button
          type="button"
          className="rounded-lg bg-foreground/10 px-3 py-1.5 text-[12.5px] hover:bg-foreground/[0.18]"
        >
          {t.topup}
        </button>
      </div>

      {dialogOpen && trial?.status === "available" ? (
        <TrialDialog
          amount={formatBalance(trial.amountCents, lang)}
          lifetimeDays={trial.lifetimeDays}
          busy={activating}
          onConfirm={activate}
          onCancel={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * Условия периода перед активацией.
 *
 * Диалог говорит ровно три вещи: сколько начислим, сколько проектов приедет и
 * что период даётся один раз. Кнопку нажимает человек — период не включается
 * сам ни при регистрации, ни при переходе по ссылке.
 */
function TrialDialog({
  amount,
  lifetimeDays,
  busy,
  onConfirm,
  onCancel,
}: {
  amount: string
  lifetimeDays: number | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2 text-primary">
          <Gift className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-foreground">
            {t.trialDialogTitle}
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {tf(t.trialDialogBody, { amount, count: 3 })}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
          {t.trialDialogTerms}
        </p>
        {lifetimeDays != null ? (
          <p className="mt-2 text-xs text-muted-foreground/80">
            {tf(t.trialDialogLifetime, { days: lifetimeDays })}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t.trialDialogCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? t.trialActivating : t.trialDialogConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
