"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift, Loader2, Wallet as WalletIcon } from "lucide-react"
import { toast } from "sonner"
import {
  CapacityLine,
  type BalanceState,
} from "@/components/account/balance-widget"
import {
  formatBalance,
  tf,
  useI18n,
  type DictKey,
  type Lang,
} from "@/components/account/i18n"
import type { TxKind, Wallet } from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * Два кошелька и движение средств по ним.
 *
 * Кошелька именно два, и они не складываются в одну сумму: акционные деньги
 * тратятся первыми, сгорают по сроку и действуют не во всех проектах
 * (BILLING_AND_TRIAL_PLAN.md §П4). Показать «всего 6 500» значило бы обещать
 * распоряжаться тем, чем распоряжается не человек, а правило допуска.
 *
 * Резерв показан рядом с остатком, а не вычтен из него. «Остаток 900, из них
 * 400 держат запущенные задачи» — это ответ; «доступно 500» без второй половины
 * читается как пропавшие деньги, и именно с этим приходят в поддержку.
 *
 * Лента — отдельным блоком под кошельками и без периода: разбор расхода за
 * месяц уже есть выше, а сюда приходят с вопросом «что вообще происходило»,
 * у которого границ по времени нет.
 */

type LedgerEntry = {
  id: string
  at: string
  wallet: Wallet
  kind: TxKind
  amountCents: number
  ourCents: number
  vendorCents: number
  projectId: string | null
  projectName: string
  comment: string
}

type LedgerPage = { entries: LedgerEntry[]; nextCursor: string | null }

const KIND_LABEL: Record<TxKind, DictKey> = {
  topup: "txKindTopup",
  grant: "txKindGrant",
  charge: "txKindCharge",
  refund: "txKindRefund",
  writeoff: "txKindWriteoff",
  exempt: "txKindExempt",
  adjust: "txKindAdjust",
}

const FILTERS: { key: "all" | Wallet; labelKey: DictKey }[] = [
  { key: "all", labelKey: "walletFilterAll" },
  { key: "own", labelKey: "walletFilterOwn" },
  { key: "gift", labelKey: "walletFilterGift" },
]

export function WalletsSection({
  balance,
  className,
}: {
  /** `null` — ещё не загрузилось. Не то же самое, что «кошельки пусты». */
  balance: BalanceState | null
  className?: string
}) {
  const { t, lang } = useI18n()

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WalletCard
          icon={<WalletIcon className="h-4 w-4 text-primary/80" />}
          title={t.walletOwn}
          hint={t.walletOwnHint}
          balanceCents={balance?.balances.own ?? null}
          reservedCents={balance?.reserved.own ?? null}
          availableCents={balance?.availableOwnCents ?? null}
          overdraftCents={balance?.overdraftLimitCents ?? 0}
          lang={lang}
          /* Меры считаются от того кошелька, которым сейчас будут платить, —
             это подарочный, пока он не пуст. Ставить одну и ту же строку под
             оба кошелька значило бы посчитать деньги дважды. */
          capacity={
            balance && balance.availableGiftCents <= 0 ? balance.capacity : null
          }
          negativeIsDebt
        />
        <WalletCard
          icon={<Gift className="h-4 w-4 text-primary/80" />}
          title={t.walletGift}
          hint={t.walletGiftHint}
          balanceCents={balance?.balances.gift ?? null}
          reservedCents={balance?.reserved.gift ?? null}
          availableCents={balance?.availableGiftCents ?? null}
          overdraftCents={0}
          lang={lang}
          capacity={
            balance && balance.availableGiftCents > 0 ? balance.capacity : null
          }
        />
      </div>

      <LedgerFeed />
    </div>
  )
}

function WalletCard({
  icon,
  title,
  hint,
  balanceCents,
  reservedCents,
  availableCents,
  overdraftCents,
  capacity,
  lang,
  negativeIsDebt,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  balanceCents: number | null
  reservedCents: number | null
  availableCents: number | null
  overdraftCents: number
  capacity: BalanceState["capacity"] | null
  lang: Lang
  /** Свой кошелёк уходит в минус — это долг (П3), а не ошибка отображения. */
  negativeIsDebt?: boolean
}) {
  const { t } = useI18n()
  const money = (cents: number) => formatBalance(cents, lang)

  return (
    <section className="rounded-2xl border border-border/60 bg-card px-5 py-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>

      {balanceCents == null ? (
        <div className="mt-4 h-[74px] animate-pulse rounded-xl bg-muted/40" />
      ) : (
        <>
          <div
            className={cn(
              "mt-4 text-[26px] font-bold tracking-tight",
              negativeIsDebt && balanceCents < 0
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            {money(balanceCents)}
          </div>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
            {/* Резерв показывается только когда он есть: нулевая строка
                объясняла бы механику, о которой человек не спрашивал. */}
            {reservedCents != null && reservedCents > 0 ? (
              <Row label={t.walletReserved} value={money(reservedCents)} />
            ) : null}
            {availableCents != null ? (
              <Row label={t.walletAvailable} value={money(availableCents)} />
            ) : null}
            {overdraftCents > 0 ? (
              <Row label={t.walletOverdraft} value={money(overdraftCents)} />
            ) : null}
          </dl>

          {capacity && capacity.length > 0 ? (
            <div className="mt-3" title={t.capacityHint}>
              <CapacityLine capacity={capacity} limit={2} />
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * Лента: страницами по курсору, а не «загрузить всё».
 *
 * Смена кошелька сбрасывает уже показанное и начинает с первой страницы —
 * дописать отфильтрованное к нефильтрованному нельзя, порядок в ленте общий.
 */
function LedgerFeed() {
  const { t, lang } = useI18n()
  const [wallet, setWallet] = useState<"all" | Wallet>("all")
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (nextCursor: string | null, reset: boolean) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ wallet })
        if (nextCursor) params.set("cursor", nextCursor)
        const res = await fetch(`/api/account/transactions?${params}`, {
          cache: "no-store",
        })
        if (!res.ok) throw new Error(String(res.status))
        const page = (await res.json()) as LedgerPage
        setEntries((prev) =>
          reset || !prev ? page.entries : [...prev, ...page.entries],
        )
        setCursor(page.nextCursor)
      } catch {
        toast.error(t.txLoadError)
      } finally {
        setLoading(false)
      }
    },
    [wallet, t],
  )

  useEffect(() => {
    void load(null, true)
  }, [load])

  const money = (cents: number) => formatBalance(cents, lang)
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    })

  return (
    <section className="rounded-2xl border border-border/60 bg-card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t.txTitle}</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground/80">
            {t.txSub}
          </p>
        </div>
        <div className="flex gap-0.5 rounded-[9px] border border-border/60 bg-background/40 p-[3px]">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setWallet(item.key)}
              className={cn(
                "h-[30px] rounded-md px-3 text-[12.5px]",
                wallet === item.key
                  ? "bg-primary/25 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t[item.labelKey]}
            </button>
          ))}
        </div>
      </div>

      {entries == null ? (
        <div className="mt-4 h-[92px] animate-pulse rounded-xl bg-muted/40" />
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground/80">{t.txEmpty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/50">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">
                    {t[KIND_LABEL[entry.kind]]}
                  </span>
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {entry.wallet === "gift" ? t.walletGift : t.walletOwn}
                  </span>
                  {entry.projectName ? (
                    <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                      {entry.projectName}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                  {stamp(entry.at)}
                  {entry.comment ? ` · ${entry.comment}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {/* Нулевая сумма — не «ничего не было»: exempt и writeoff это
                    состоявшаяся работа, за которую человек не заплатил.
                    Прочерк вместо «0,00 ₽» говорит это, не притворяясь
                    движением. */}
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    entry.amountCents > 0 && "text-primary",
                    entry.amountCents < 0 && "text-foreground",
                    entry.amountCents === 0 && "text-muted-foreground",
                  )}
                >
                  {entry.amountCents === 0
                    ? "—"
                    : `${entry.amountCents > 0 ? "+" : "−"}${money(
                        Math.abs(entry.amountCents),
                      )}`}
                </div>
                {/* Раскладка — только у списаний: «из них внешним сервисам»
                    отвечает на вопрос, откуда взялась сумма. */}
                {entry.vendorCents > 0 ? (
                  <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                    {tf(t.txVendorPart, { amount: money(entry.vendorCents) })}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          onClick={() => void load(cursor, false)}
          disabled={loading}
          className="mt-4 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t.txMore}
        </button>
      ) : null}
    </section>
  )
}
