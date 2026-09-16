"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Gift, Loader2, Wallet } from "lucide-react"
import { formatBalance, tf, useI18n } from "@/components/account/i18n"
import {
  TrialDialogs,
  useTrialFlow,
  type TrialState,
} from "@/components/account/trial-flow"
import { formatRuntime } from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * Баланс и тестовый период одной карточкой.
 *
 * Главное число — СВОЙ баланс, подарочный второй строкой и мельче, и он
 * исчезает, когда обнуляется. Обратный порядок вреден ровно один раз, но
 * непоправимо: в момент, когда подарок кончится, человек увидит крупный ноль и
 * решит, что пропали его собственные деньги.
 *
 * Сама выдача — условия, ход копирования, опрос — живёт в
 * [trial-flow.tsx](./trial-flow.tsx): предложить период можно и отсюда, и из
 * раздела проектов, а машинерия у этого одна.
 */

type TrialResponse = {
  trial: TrialState
  balances: { own: number; gift: number }
  availableOwnCents: number
  availableGiftCents: number
  purchasing: { runtimeSec: number; basis: "history" | "rate" } | null
  /** За этого человека платит другой — вместо сумм показываем, кто. */
  paidBy?: { name: string } | null
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

  const flow = useTrialFlow({ status: data?.trial.status, onChanged: load })
  const { setOpen } = flow

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (autoOpen && data?.trial.status === "available") setOpen(true)
  }, [autoOpen, data, setOpen])

  // Деньги не его: ни суммы, ни периода, ни пополнения — только кто платит.
  if (data?.paidBy) {
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
        <div className="mt-4 text-[15px] font-medium text-foreground">
          {tf(t.paidByLine, { name: data.paidBy.name })}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{t.paidByHint}</p>
      </div>
    )
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
            onClick={() => flow.setOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Gift className="h-[15px] w-[15px]" />
            {t.trialActivate}
          </button>
        ) : null}

        {/* Копирование идёт, а окно закрыли: строка в карточке — единственное,
            что об этом говорит. Нажатие возвращает окно с ходом работы. */}
        {trial?.status === "provisioning" ? (
          <button
            type="button"
            onClick={() => flow.setOpen(true)}
            className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            <Loader2 className="h-[15px] w-[15px] animate-spin" />
            {t.trialProvisioning}
          </button>
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

      <TrialDialogs flow={flow} trial={trial} />
    </div>
  )
}
