"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  formatBalance,
  tf,
  useI18n,
  type DictKey,
  type Dictionary,
} from "@/components/account/i18n"
import { formatRuntime } from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * Баланс и «на что ещё хватит».
 *
 * Один компонент на боковую панель и дашборд: число там и там должно совпадать
 * до копейки, а две реализации расходятся на первой же правке округления.
 *
 * Пересчёт суммы в меры — ПРИМЕРНЫЙ и альтернативный. «20 минут или 15 файлов»
 * это одна и та же сумма, измеренная разными линейками, поэтому между ними
 * стоит «или», а не запятая: перечисление через запятую читается как «и то, и
 * другое», и человек решит, что ему доступно всё сразу.
 */

export type Capacity = {
  meter: "sec" | "count" | "bytes" | "runs"
  units: number
  basis: "history" | "rate"
}

export type BalanceState = {
  balances: { own: number; gift: number }
  /** Оценки живых задач: деньги обещаны, но ещё не потрачены. */
  reserved: { own: number; gift: number }
  /** Остаток минус резерв; у своего кошелька плюс овердрафт. */
  availableOwnCents: number
  availableGiftCents: number
  overdraftLimitCents: number
  capacity: Capacity[]
}

/**
 * Мегабайты → «1.4 GB». Мера объёма тарифицируется в МБ (BYTES_PER_UNIT), и
 * сюда приходит уже она — переводить из байтов второй раз не надо.
 */
export function formatVolume(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Число меры в её собственных единицах, без подписи: «01:02:25», «15», «1.4 GB». */
export function capacityValue(item: Capacity): string {
  if (item.meter === "sec") return formatRuntime(item.units)
  if (item.meter === "bytes") return formatVolume(item.units)
  return String(item.units)
}

const CAPACITY_PHRASE: Record<Capacity["meter"], DictKey> = {
  sec: "capacitySec",
  count: "capacityCount",
  bytes: "capacityBytes",
  runs: "capacityRuns",
}

/** «01:02:25 видео», «15 файлов», «12 обработок» — мера вместе с подписью. */
export function capacityPhrase(item: Capacity, t: Dictionary): string {
  return tf(t[CAPACITY_PHRASE[item.meter]], { value: capacityValue(item) })
}

/**
 * Кошельки и меры одним запросом.
 *
 * `enabled = false` — данные уже есть у родителя и переданы пропсом: на
 * кошельке тот же ответ нужен и виджету, и разбору «на что хватит», а два
 * одинаковых запроса на одной странице умеют разойтись между собой.
 */
export function useBalance(enabled = true): BalanceState | null {
  const [state, setState] = useState<BalanceState | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch("/api/account/balance", { cache: "no-store" })
      if (res.ok) setState((await res.json()) as BalanceState)
    } catch {
      // Виджет баланса — не та вещь, ради которой показывают ошибку поверх
      // страницы: он всегда рядом и всегда перечитается.
    }
  }, [enabled])

  useEffect(() => {
    void load()
  }, [load])

  return state
}

/** Строка «≈ 01:02:25 видео · или · 15 файлов». Пусто — считать не из чего. */
export function CapacityLine({
  capacity,
  className,
  /** Сколько мер уместить. Остальные показывает разбор на кошельке. */
  limit,
}: {
  capacity: Capacity[]
  className?: string
  limit?: number
}) {
  const { t } = useI18n()
  if (capacity.length === 0) return null

  const shown = limit == null ? capacity : capacity.slice(0, limit)
  const parts = shown.map((item) => capacityPhrase(item, t))

  return (
    <span className={cn("text-[11.5px] text-muted-foreground", className)}>
      ≈{" "}
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? (
            <span className="opacity-60"> {t.capacityOr} </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  )
}

/** Полный виджет: сумма крупно, меры мелким текстом под ней. */
export function BalanceWidget({
  className,
  action,
  /** Обернуть сумму ссылкой на разбор расхода. В самой этой странице — не надо. */
  href,
  /** Готовое состояние от родителя. Передали — виджет сам не ходит в сеть. */
  state: given,
}: {
  className?: string
  action?: React.ReactNode
  href?: string
  state?: BalanceState | null
}) {
  const { t, lang } = useI18n()
  const fetched = useBalance(given === undefined)
  const state = given === undefined ? fetched : given

  const own = state?.balances.own ?? 0
  const gift = state?.balances.gift ?? 0

  return (
    <div className={cn("min-w-0", className)}>
      {(() => {
        const amount = (
          <span
            className={cn(
              "text-[22px] font-bold tracking-tight",
              own < 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatBalance(own, lang)}
          </span>
        )
        // Ссылка только на самой сумме, а не на всём блоке: рядом стоит кнопка
        // пополнения, и вложенные интерактивные элементы ломают и клавиатуру,
        // и попадание пальцем.
        return href ? (
          <Link href={href} className="inline-block hover:opacity-80">
            {amount}
          </Link>
        ) : (
          <div>{amount}</div>
        )
      })()}

      {/* Подарочный — второй строкой и мельче; пустой не показываем вовсе,
          иначе израсходованный подарок вечно объясняет себя. */}
      {gift > 0 ? (
        <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {t.trialGift}: {formatBalance(gift, lang)}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate" title={t.capacityHint}>
          {state && state.capacity.length > 0 ? (
            // Две меры, а не все: строка стоит в узкой панели и обрезалась бы
            // на полуслове. Полный разбор — на кошельке, куда ведёт сумма.
            <CapacityLine capacity={state.capacity} limit={2} />
          ) : (
            <span className="text-[11.5px] text-muted-foreground">
              {t.capacityNone}
            </span>
          )}
        </span>
        {action}
      </div>
    </div>
  )
}
