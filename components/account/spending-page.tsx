"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useBalance } from "@/components/account/balance-widget"
import { CapacityPanel } from "@/components/account/capacity-panel"
import { WalletsSection } from "@/components/account/wallets-section"
import { formatBalance, useI18n, type DictKey } from "@/components/account/i18n"
import { PromosSection } from "@/components/account/promos-section"
import { cn } from "@/lib/utils"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

/**
 * «Баланс и расход» — куда ушли деньги.
 *
 * Только деньги: файлы, задачи и машины живут в «Статистике». Смешав их, мы
 * получили бы экран, на котором не найти ни того, ни другого.
 *
 * Начинаем с месяца — это масштаб, на котором вопрос «куда ушли деньги» вообще
 * задают; день и неделя нужны, когда уже заметили всплеск и провалились внутрь.
 *
 * Порядок блоков отвечает порядку вопросов: сколько есть и что с этим
 * происходило → на что этого хватит → что мне подарили → куда ушло уже
 * потраченное. Разбор расхода последним намеренно: он про прошлое, а первые
 * три — про то, что можно сделать сейчас.
 *
 * Кошельков два, и они показаны рядом, а не сложены: подарочные деньги тратятся
 * первыми и живут по своим правилам (§П4). Лента движения средств стоит там же,
 * при кошельках: она отвечает на «что происходило», а не на «сколько за месяц»,
 * и разбор по проектам ниже её не заменяет.
 */

type Period = "day" | "week" | "month" | "year"

const PERIODS: { key: Period; labelKey: DictKey }[] = [
  { key: "day", labelKey: "spendPeriodDay" },
  { key: "week", labelKey: "spendPeriodWeek" },
  { key: "month", labelKey: "spendPeriodMonth" },
  { key: "year", labelKey: "spendPeriodYear" },
]

type Report = {
  totals: {
    spentCents: number
    ourCents: number
    vendorCents: number
    giftCents: number
    ownCents: number
    runs: number
  }
  timeline: { at: string; spentCents: number }[]
  projects: {
    projectId: string | null
    name: string
    spentCents: number
    vendorCents: number
    runs: number
  }[]
  workers:
    | { userId: string | null; name: string; email: string | null; spentCents: number; runs: number }[]
    | null
}

export function SpendingPage() {
  const { t, lang } = useI18n()
  const [period, setPeriod] = useState<Period>("month")
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState("")
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  // Кошельки и меры читает страница, а не виджет: виджет тут же под рукой, и
  // два одинаковых запроса на одном экране умеют показать разные числа.
  const balance = useBalance()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (projectId) params.set("projectId", projectId)
      const res = await fetch(`/api/account/spending?${params}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error(String(res.status))
      setReport((await res.json()) as Report)
    } catch {
      toast.error(t.spendLoadError)
    } finally {
      setLoading(false)
    }
  }, [period, projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  const money = (cents: number) => formatBalance(cents, lang)
  const maxBar = Math.max(1, ...(report?.timeline.map((b) => b.spentCents) ?? [1]))

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4 md:px-6">
        <div className="text-[13px] text-muted-foreground">
          {t.accountCrumb}
          <span className="opacity-50"> / </span>
          <span className="text-foreground">{t.spendCrumb}</span>
        </div>
        <ProcessingIndicator />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-5">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-bold tracking-tight">
                {t.spendTitle}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t.spendSub}
              </p>
            </div>
            <div className="flex gap-0.5 rounded-[9px] border border-border/60 bg-card p-[3px]">
              {PERIODS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPeriod(item.key)}
                  className={cn(
                    "h-[30px] rounded-md px-3 text-[12.5px]",
                    period === item.key
                      ? "bg-primary/25 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t[item.labelKey]}
                </button>
              ))}
            </div>
          </header>

          {/* Кошельки — двумя карточками, а не одной суммой: акционные деньги
              тратятся первыми, сгорают по сроку и действуют не во всех
              проектах, поэтому «всего столько-то» было бы обещанием, которого
              правило допуска не даёт (BILLING_AND_TRIAL_PLAN.md §П4). */}
          <WalletsSection balance={balance} />

          {/* «На что хватит» и «Акции» живут вне ожидания отчёта: у них свои
              запросы, и держать их за спиннером расхода значило бы прятать
              готовое ради незагруженного. */}
          <CapacityPanel capacity={balance?.capacity ?? null} />

          <PromosSection />

          {loading || !report ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Tile label={t.spendTotal} value={money(report.totals.spentCents)} />
                <Tile label={t.spendRuns} value={String(report.totals.runs)} />
                <Tile label={t.spendOur} value={money(report.totals.ourCents)} />
                {/* Себестоимость показывается ПО СЕБЕСТОИМОСТИ, без наценки:
                    цифру можно сверить с публичным прайсом сервиса, и она
                    обязана сойтись. Наценка живёт в строке нашей работы. */}
                <Tile
                  label={t.spendVendor}
                  value={money(report.totals.vendorCents)}
                  hint={t.spendVendorHint}
                />
              </div>

              {report.totals.giftCents > 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  {t.spendFromGift}: {money(report.totals.giftCents)} ·{" "}
                  {t.spendFromOwn}: {money(report.totals.ownCents)}
                </p>
              ) : null}

              {report.timeline.length > 0 ? (
                <div className="rounded-2xl border border-border/60 bg-card px-5 py-5">
                  <div className="flex h-[160px] items-end gap-1.5">
                    {report.timeline.map((bucket) => (
                      <div
                        key={bucket.at}
                        title={`${bucket.at} · ${money(bucket.spentCents)}`}
                        className="min-w-0 flex-1 rounded-t bg-primary/70"
                        style={{
                          height: `${Math.max(2, (bucket.spentCents / maxBar) * 100)}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <section className="rounded-2xl border border-border/60 bg-card px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {projectId ? projectName : t.spendProjects}
                  </h2>
                  {projectId ? (
                    <button
                      type="button"
                      onClick={() => setProjectId(null)}
                      className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t.spendBack}
                    </button>
                  ) : null}
                </div>

                {report.projects.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground/80">
                    {t.spendProjectsEmpty}
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-border/50">
                    {report.projects.map((row) => (
                      <li key={row.projectId ?? "none"}>
                        <button
                          type="button"
                          disabled={!row.projectId || Boolean(projectId)}
                          onClick={() => {
                            setProjectId(row.projectId)
                            setProjectName(row.name)
                          }}
                          className="flex w-full items-center gap-4 py-2.5 text-left disabled:cursor-default"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {row.name || "—"}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {row.runs}
                          </span>
                          <span className="shrink-0 text-sm">
                            {money(row.spentCents)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {report.workers ? (
                <section className="rounded-2xl border border-border/60 bg-card px-5 py-5">
                  <h2 className="text-base font-semibold">{t.spendWorkers}</h2>
                  <p className="mt-1 max-w-3xl text-xs text-muted-foreground/80">
                    {t.spendWorkersHint}
                  </p>
                  <ul className="mt-4 divide-y divide-border/50">
                    {report.workers.map((row) => (
                      <li
                        key={row.userId ?? "unknown"}
                        className="flex items-center gap-4 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {row.name || row.email || t.spendUnknownWorker}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {row.runs}
                        </span>
                        <span className="shrink-0 text-sm">
                          {money(row.spentCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-[18px]">
      <div className="text-[11px] font-semibold tracking-[1.2px] text-muted-foreground">
        {label}
      </div>
      <div className="mt-3 text-[26px] font-bold tracking-tight">{value}</div>
      {hint ? (
        <div className="mt-1 text-[11.5px] text-muted-foreground/80">{hint}</div>
      ) : null}
    </div>
  )
}
