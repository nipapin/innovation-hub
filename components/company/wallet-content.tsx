"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Button } from "@/components/ui/button"

type LedgerRow = {
  id: string
  kind: string
  wallet: string
  amountCents: number
  comment: string
  createdAt: string
  projectName: string | null
  spenderName: string | null
}

type WalletData = {
  balanceOwnCents: number
  balanceGiftCents: number
  reservedOwnCents: number
  reservedGiftCents: number
  availableOwnCents: number
  availableGiftCents: number
  ledger: LedgerRow[]
  nextCursor: string | null
  payees: { userId: string; email: string; fullName: string }[]
}

/**
 * «Кошелёк компании» — остаток, резерв, лента и список оплачиваемых.
 *
 * Пополнения отсюда нет намеренно: деньги на кошелёк компании кладёт
 * администратор сайта, и кнопка, которая ничего не может, хуже её отсутствия.
 */
export function CompanyWallet() {
  const { t, lang } = useI18n()
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/wallet", { cache: "no-store" })
      if (res.ok) setData(await res.json())
      else toast.error(t.coLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    if (!data?.nextCursor) return
    setMore(true)
    try {
      const res = await fetch(
        `/api/company/wallet?before=${encodeURIComponent(data.nextCursor)}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const next = (await res.json()) as WalletData
      setData({
        ...next,
        ledger: [...data.ledger, ...next.ledger],
      })
    } finally {
      setMore(false)
    }
  }

  if (loading && !data) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  }
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Справки у консоли пока нет: её реестр знает только теги САЙТА
          (lib/help/topics.ts, HelpAudience), а здесь аудитория — админ
          компании. Аудиторию справки под вторую ось прав расширим отдельно. */}
      <Section title={t.coWalletTitle} description={t.coWalletSub}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label={t.coWalletOwn} value={formatBalance(data.balanceOwnCents, lang)} />
          <Figure label={t.coWalletGift} value={formatBalance(data.balanceGiftCents, lang)} />
          <Figure
            label={t.coWalletReserved}
            value={formatBalance(data.reservedOwnCents + data.reservedGiftCents, lang)}
            hint={t.coWalletReservedHint}
          />
          <Figure
            label={t.coWalletAvailable}
            value={formatBalance(data.availableOwnCents + data.availableGiftCents, lang)}
            accent
          />
        </div>
        <p className="text-xs text-muted-foreground">{t.coWalletTopupHint}</p>
      </Section>

      {data.payees.length > 0 ? (
        <Section title={t.coWalletPayers}>
          <p className="text-sm text-muted-foreground">
            {data.payees.map((person) => person.email).join(", ")}
          </p>
        </Section>
      ) : null}

      <Section title={t.coWalletLedger}>
        {data.ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.coWalletLedgerEmpty}</p>
        ) : (
          <>
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {data.ledger.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row.projectName ?? "—"}
                    {row.spenderName ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.spenderName}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString(lang)}
                  </span>
                  <span
                    className={
                      row.amountCents < 0
                        ? "text-sm tabular-nums text-foreground"
                        : "text-sm tabular-nums text-success"
                    }
                  >
                    {formatBalance(row.amountCents, lang)}
                  </span>
                </li>
              ))}
            </ul>
            {data.nextCursor ? (
              <Button
                variant="outline"
                size="sm"
                disabled={more}
                onClick={() => void loadMore()}
              >
                {more ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t.coAuditMore}
              </Button>
            ) : null}
          </>
        )}
      </Section>
    </div>
  )
}

function Figure({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p
        className={
          accent
            ? "mt-1 text-xl font-semibold tabular-nums text-primary"
            : "mt-1 text-xl font-semibold tabular-nums text-foreground"
        }
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
