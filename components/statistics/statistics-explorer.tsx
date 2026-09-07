"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { Download, Loader2, X } from "lucide-react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { tf, useI18n, type Lang } from "@/components/account/i18n"
import { HelpDot } from "@/components/help/help-dot"
import { formatCents } from "@/lib/billing/types"
import type { HelpTopicId } from "@/lib/help/topics"
import {
  STAT_PERIODS,
  breakdownsFor,
  metricsFor,
  type StatBreakdown,
  type StatBucketUnit,
  type StatMetric,
  type StatPeriod,
  type StatVariant,
  type StatsCardRow,
  type StatsFunnelStep,
  type StatsResponse,
  type StatsRow,
} from "@/lib/statistics/types"
import { cn } from "@/lib/utils"

/**
 * Обозреватель статистики: три независимые оси (метрика · разрез · период),
 * ранжирование, динамика, таблица и выгрузка. Один компонент на две витрины —
 * различает их `variant`, а скоуп навешивает сервер (docs/STATISTICS_PLAN.md §6).
 *
 * `variant` управляет только тем, что видно: набор осей у кабинета уже, и это
 * не украшение, а часть постановки — кабинет отвечает «сколько сделал я», и
 * разрезы по людям и машинам ему не нужны. Запрет при этом живёт на сервере
 * (`getStatistics`): кнопка, которую не нарисовали, — не защита.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function locale(lang: Lang) {
  return lang === "ru" ? "ru-RU" : "en-US"
}

/**
 * Цвет закреплён за сущностью, а не за местом в рейтинге (§6.4): фильтр,
 * меняющий состав, не должен перекрашивать оставшихся. Поэтому оттенок берётся
 * от ключа строки, а не от её индекса.
 */
function colorForKey(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 9973
  }
  return `hsl(var(--chart-${(hash % 5) + 1}))`
}

/**
 * Списано с человека: КОПЕЙКИ в рублях из ленты транзакций.
 *
 * Тот же форматтер, что на «Балансе и расходе», и это принципиально: два экрана
 * про одни и те же деньги обязаны показывать и одно число, и один значок. Свой
 * форматтер с собственной валютой — ровно та ошибка, из-за которой над
 * рублёвыми суммами тут стоял «$».
 */
function formatSpend(cents: number, lang: Lang): string {
  return formatCents(cents, lang)
}

/**
 * Себестоимость из архива: ДОЛЛАРЫ, и это не забытая локализация. `total_cost`
 * пишет машина в валюте внешнего сервиса, а она по контракту доллар
 * (BILLING_AND_TRIAL_PLAN.md §В3). Приводить её к рублю здесь нечем — курс
 * применяется в момент списания и уезжает в транзакцию, а не в показ. Поэтому
 * метрика админская: пользователю она отвечала бы на вопрос, которого он не
 * задавал, зато в чужой валюте.
 */
function formatCost(value: number, lang: Lang): string {
  return `${value.toLocaleString(locale(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`
}

/** Длительность в секундах. Часы появляются только когда они есть. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return `${m}m ${String(rest).padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m`
}

type MetricSource = Pick<
  StatsRow,
  "files" | "bytes" | "tasks" | "errors" | "procs" | "spend" | "cost" | "render"
>

function metricValue(row: MetricSource, metric: StatMetric) {
  switch (metric) {
    case "files":
      return row.files
    case "bytes":
      return row.bytes
    case "tasks":
      return row.tasks
    case "errors":
      return row.errors
    case "procs":
      return row.procs
    case "spend":
      return row.spend
    case "cost":
      return row.cost
    case "render":
      return row.render
  }
}

function bucketLabel(iso: string, unit: StatBucketUnit, lang: Lang) {
  const d = new Date(iso)
  if (unit === "month") {
    return d.toLocaleDateString(locale(lang), { month: "short", year: "2-digit" })
  }
  return d.toLocaleDateString(locale(lang), { day: "2-digit", month: "2-digit" })
}

const RANK_LIMIT = 12

/**
 * Справка у осей — своя на каждую витрину.
 *
 * Не «одна статья с оговоркой для кабинета»: под словом «спенд» у витрин разные
 * источники, набор осей тоже разный, и объяснение админского разреза по машинам
 * пользователю не нужно вовсе. Пары связаны через `seeAlso` в реестре тем.
 */
const HELP_TOPICS_BY_VARIANT: Record<
  StatVariant,
  { metric: HelpTopicId; breakdown: HelpTopicId }
> = {
  account: {
    metric: "statistics.personal.metrics",
    breakdown: "statistics.personal.scope",
  },
  admin: {
    metric: "statistics.metrics",
    breakdown: "statistics.breakdowns",
  },
}

type Props = {
  /** `/api/admin/statistics` или `/api/account/statistics`. */
  endpoint: string
  /** Какие оси показывать. Совпадает с тем, что посчитает сервер по скоупу. */
  variant: StatVariant
}

export function StatisticsExplorer({ endpoint, variant }: Props) {
  const { t, lang } = useI18n()
  const metrics = metricsFor(variant)
  const breakdowns = breakdownsFor(variant)
  const help = HELP_TOPICS_BY_VARIANT[variant]

  const [metric, setMetric] = useState<StatMetric>("files")
  const [breakdown, setBreakdown] = useState<StatBreakdown>("project")
  const [period, setPeriod] = useState<StatPeriod>("30d")
  const [userId, setUserId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(false)
      const params = new URLSearchParams({ breakdown, period })
      if (userId) params.set("userId", userId)
      if (projectId) params.set("projectId", projectId)
      try {
        const res = await fetch(`${endpoint}?${params}`)
        if (!res.ok) throw new Error(String(res.status))
        const json: StatsResponse = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [endpoint, breakdown, period, userId, projectId])

  /**
   * Сервер молча сбрасывает фильтр, до которого у пользователя нет доступа.
   * Приводим локальное состояние к ответу, иначе фильтр остался бы «залипшим»:
   * чипса нет, а запрос продолжает уходить с ним.
   */
  useEffect(() => {
    if (!data) return
    if (userId && !data.scope.userId) setUserId(null)
    if (projectId && !data.scope.projectId) setProjectId(null)
  }, [data, userId, projectId])

  const metricNames: Record<StatMetric, string> = {
    files: t.statMetricFiles,
    bytes: t.statMetricBytes,
    tasks: t.statMetricTasks,
    errors: t.statMetricErrors,
    procs: t.statMetricProcs,
    spend: t.statMetricSpend,
    cost: t.statMetricCost,
    render: t.statMetricRender,
  }
  const breakdownNames: Record<StatBreakdown, string> = {
    user: t.statBreakUser,
    project: t.statBreakProject,
    fileType: t.statBreakType,
    machine: t.statBreakMachine,
  }
  const periodNames: Record<StatPeriod, string> = {
    "7d": t.statPeriod7d,
    "30d": t.statPeriod30d,
    "90d": t.statPeriod90d,
    "12m": t.statPeriod12m,
    all: t.statPeriodAll,
  }

  /**
   * Пустой ключ значит разное в разных разрезах — подпись берём по разрезу.
   * Разрез читаем из ответа: сервер вправе подменить его (в кабинете «по
   * пользователю» превращается в «по проектам»), и подписи должны следовать за
   * тем, что действительно посчитано.
   */
  const effectiveBreakdown = data?.breakdown ?? breakdown
  const rowLabel = useCallback(
    (row: StatsRow) => {
      if (row.label) return row.label
      if (effectiveBreakdown === "fileType") return t.statNoExt
      if (effectiveBreakdown === "machine") return t.statNoMachine
      return t.statNoName
    },
    [effectiveBreakdown, t],
  )

  const format = useCallback(
    (value: number, m: StatMetric = metric) => {
      if (m === "bytes") return formatBytes(value)
      if (m === "spend") return formatSpend(value, lang)
      if (m === "cost") return formatCost(value, lang)
      if (m === "render") return formatDuration(value)
      return value.toLocaleString(locale(lang))
    },
    [lang, metric],
  )

  const rows = useMemo(() => {
    if (!data) return []
    return [...data.rows].sort(
      (a, b) => metricValue(b, metric) - metricValue(a, metric),
    )
  }, [data, metric])

  const rankData = useMemo(
    () =>
      rows.slice(0, RANK_LIMIT).map((r) => ({
        key: r.key,
        label: rowLabel(r),
        value: metricValue(r, metric),
        drill: r.drill,
      })),
    [rows, metric, rowLabel],
  )

  const trendData = useMemo(
    () =>
      (data?.timeline ?? []).map((b) => ({
        label: bucketLabel(b.bucket, data?.bucketUnit ?? "day", lang),
        value: metricValue(b, metric),
      })),
    [data, metric, lang],
  )

  const volumeData = useMemo(
    () =>
      (data?.volume ?? []).map((v) => ({
        label: bucketLabel(v.bucket, data?.bucketUnit ?? "day", lang),
        value: v.bytes,
      })),
    [data, lang],
  )

  /** Состав целого: топ-6 и «Прочее» одним сегментом (§6.3). */
  const composition = useMemo(() => {
    const positive = rows.filter((r) => metricValue(r, metric) > 0)
    const total = positive.reduce((sum, r) => sum + metricValue(r, metric), 0)
    if (total <= 0) return { total: 0, parts: [] }
    const top = positive.slice(0, 6)
    const restValue = positive
      .slice(6)
      .reduce((sum, r) => sum + metricValue(r, metric), 0)
    const parts = top.map((r) => ({
      key: r.key,
      label: rowLabel(r),
      value: metricValue(r, metric),
      color: colorForKey(r.key || r.label),
      drill: r.drill,
    }))
    if (restValue > 0) {
      parts.push({
        key: "",
        label: t.statCompOther,
        value: restValue,
        color: "hsl(var(--ws-text-5))",
        drill: null,
      })
    }
    return { total, parts }
  }, [rows, metric, rowLabel, t])

  const histogramData = useMemo(
    () =>
      (data?.histogram ?? []).map((bin) => ({
        label:
          bin.to === null
            ? tf(t.statHistBinOpen, { from: bin.from })
            : tf(t.statHistBin, { from: bin.from, to: bin.to }),
        value: bin.count,
      })),
    [data, t],
  )

  const funnelSteps = data?.funnel ?? []
  const funnelMax = Math.max(0, ...funnelSteps.map((step) => step.count))
  const funnelNames: Record<StatsFunnelStep["status"], string> = {
    queued: t.statFunnelQueued,
    claimed: t.statFunnelClaimed,
    running: t.statFunnelRunning,
    done: t.statFunnelDone,
    failed: t.statFunnelFailed,
  }

  const drillInto = useCallback((row: { key: string; drill: StatsRow["drill"] }) => {
    if (!row.key) return
    if (row.drill === "user") setUserId(row.key)
    if (row.drill === "project") setProjectId(row.key)
  }, [])

  const exportCsv = useCallback(() => {
    // Суммы выгружаются числами без значка: копейки в рублях у спенда, доллары
    // у себестоимости. Подписать их в шапке честнее, чем подставить символ,
    // который таблица потом примет за текст.
    const showCost = metrics.includes("cost")
    const header = [
      t.statColLabel,
      t.statColFiles,
      t.statColBytes,
      t.statColTasks,
      t.statColErrors,
      t.statColProcs,
      t.statCsvSpend,
      ...(showCost ? [t.statCsvCost] : []),
      t.statColRender,
    ]
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      header.map(escape).join(","),
      ...rows.map((r) =>
        [
          escape(rowLabel(r)),
          r.files,
          r.bytes,
          r.tasks,
          r.errors,
          r.procs,
          r.spend,
          ...(showCost ? [r.cost] : []),
          r.render,
        ].join(","),
      ),
    ]
    const blob = new Blob([`﻿${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `statistics-${breakdown}-${period}.csv`
    // Ссылка должна быть в документе, а адрес — жить дольше клика: Firefox
    // отменяет скачивание, если объект отозвать в том же тике.
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      a.remove()
      URL.revokeObjectURL(url)
    }, 0)
  }, [rows, rowLabel, breakdown, metrics, period, t])

  const chartConfig: ChartConfig = {
    value: { label: metricNames[metric], color: "hsl(var(--chart-1))" },
  }
  const volumeConfig: ChartConfig = {
    value: { label: t.statMetricBytes, color: "hsl(var(--chart-3))" },
  }
  const histogramConfig: ChartConfig = {
    value: { label: t.statHistCount, color: "hsl(var(--chart-2))" },
  }

  const totals = data?.totals
  // Плитка «пользователей» — признак админской витрины: в кабинете сервер
  // присылает null, потому что чужих там не видно.
  const usersTileValue =
    totals?.users != null ? format(totals.users, "files") : null

  return (
    <div className="flex flex-col gap-4">
      {/* Состояние на сейчас: период на эти числа не влияет */}
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2",
          usersTileValue ? "xl:grid-cols-5" : "xl:grid-cols-4",
        )}
      >
        <Tile
          label={t.statTileFiles}
          value={totals ? format(totals.files, "files") : "—"}
          sub={t.statTileFilesSub}
        />
        <Tile
          label={t.statTileBytes}
          value={totals ? formatBytes(totals.bytes) : "—"}
          sub={t.statTileBytesSub}
        />
        <Tile
          label={t.statTileProjects}
          value={totals ? format(totals.projects, "files") : "—"}
          sub={t.statTileProjectsSub}
        />
        <Tile
          label={t.statTileTasks}
          value={totals ? format(totals.tasksTotal, "tasks") : "—"}
          sub={
            totals
              ? tf(t.statTileTasksSub, {
                  done: totals.tasksDone,
                  failed: totals.tasksFailed,
                })
              : ""
          }
        />
        {usersTileValue && (
          <Tile
            label={t.statTileUsers}
            value={usersTileValue}
            sub={t.statTileUsersSub}
          />
        )}
      </div>

      {/* Работа: события. Обработки и хронометраж приходят из архива — нули в
          них значат «архив ещё не импортирован», а не «работы не было». Спенд
          живёт отдельно: он из ленты списаний, и его ноль означает ровно то,
          что написано, — за этот скоуп ещё ничего не списали. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2",
          variant === "admin" ? "xl:grid-cols-4" : "xl:grid-cols-3",
        )}
      >
        <Tile
          label={t.statTileProcs}
          value={totals ? format(totals.procsTotal, "procs") : "—"}
          sub={
            totals
              ? tf(t.statTileProcsSub, {
                  done: totals.procsDone,
                  failed: totals.procsError,
                })
              : ""
          }
        />
        <Tile
          label={t.statTileSpend}
          value={totals ? formatSpend(totals.spend, lang) : "—"}
          sub={t.statTileSpendSub}
        />
        {variant === "admin" && (
          <Tile
            label={t.statTileCost}
            value={totals ? formatCost(totals.cost, lang) : "—"}
            sub={t.statTileCostSub}
          />
        )}
        <Tile
          label={t.statTileRender}
          value={
            totals?.renderP50 != null
              ? `${formatDuration(totals.renderP50)} / ${
                  totals.renderP95 != null
                    ? formatDuration(totals.renderP95)
                    : "—"
                }`
              : "—"
          }
          sub={t.statTileRenderSub}
        />
      </div>

      {/* Три оси выбора и активные фильтры провала */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-ws-panel p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            title={t.statMetricLabel}
            help={help.metric}
            options={metrics.map((m) => ({ key: m, label: metricNames[m] }))}
            value={metric}
            onChange={setMetric}
          />
          <Segmented
            title={t.statBreakLabel}
            help={help.breakdown}
            options={breakdowns.map((b) => ({
              key: b,
              label: breakdownNames[b],
            }))}
            value={breakdown}
            onChange={setBreakdown}
          />
          <Segmented
            title={t.statPeriodLabel}
            options={STAT_PERIODS.map((p) => ({ key: p, label: periodNames[p] }))}
            value={period}
            onChange={setPeriod}
          />
        </div>

        {(data?.scope.userId || data?.scope.projectId) && (
          <div className="flex flex-wrap gap-2">
            {data.scope.userId && (
              <Chip
                label={tf(t.statFilterUser, {
                  name: data.scope.userLabel ?? data.scope.userId,
                })}
                onClear={() => setUserId(null)}
                clearTitle={t.statFilterClear}
              />
            )}
            {data.scope.projectId && (
              <Chip
                label={tf(t.statFilterProject, {
                  name: data.scope.projectLabel ?? data.scope.projectId,
                })}
                onClear={() => setProjectId(null)}
                clearTitle={t.statFilterClear}
              />
            )}
          </div>
        )}

        {breakdown === "machine" && (metric === "files" || metric === "bytes") && (
          <p className="text-[12.5px] text-ws-4">{t.statMachineNote}</p>
        )}
        {(metric === "tasks" || metric === "errors") && (
          <p className="text-[12.5px] text-ws-4">{t.statTasksNote}</p>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-[13.5px] text-ws-2">
          {t.statLoadError}
        </div>
      )}

      {/* Карточка элемента (§6.2): фиксированный набор при провале, не конструктор */}
      {data?.card && (
        <div className="rounded-2xl border border-border/60 bg-ws-panel px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold tracking-[1.2px] text-ws-accent">
                {data.card.kind === "project" ? t.statCardProject : t.statCardUser}
              </div>
              <h3 className="mt-1 truncate text-[17px] font-bold text-ws-1">
                {data.card.title || t.statNoName}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {data.card.subtitle && (
                  <span className="truncate text-[12.5px] text-ws-4">
                    {data.card.subtitle}
                  </span>
                )}
                {data.card.members > 0 && (
                  <span className="rounded-md border border-ws-accent/35 bg-ws-select/[0.16] px-2 py-0.5 text-[11.5px] text-ws-2">
                    {tf(t.statCardShared, { n: data.card.members })}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right text-[12px] text-ws-4">
              <div className="font-semibold tracking-[1.2px]">
                {t.statCardLastActivity}
              </div>
              <div className="mt-0.5 text-ws-2">
                {data.card.lastActivityAt
                  ? new Date(data.card.lastActivityAt).toLocaleString(
                      locale(lang),
                      { dateStyle: "medium", timeStyle: "short" },
                    )
                  : t.statCardNever}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <CardList
              title={
                data.card.kind === "project"
                  ? t.statCardContribProject
                  : t.statCardContribUser
              }
              rows={data.card.contributors}
              emptyLabel={t.statEmpty}
              lang={lang}
              fallbackLabel={t.statNoName}
              onPick={
                data.card.kind === "project"
                  ? (key) => setUserId(key)
                  : (key) => setProjectId(key)
              }
            />
            <CardList
              title={t.statCardTypes}
              rows={data.card.fileTypes}
              emptyLabel={t.statEmpty}
              lang={lang}
              fallbackLabel={t.statNoExt}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={t.statRankTitle}
          sub={tf(t.statRankSub, { n: RANK_LIMIT })}
          loading={loading}
          empty={!loading && rankData.every((r) => r.value === 0)}
          emptyLabel={t.statEmpty}
        >
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <BarChart
              data={rankData}
              layout="vertical"
              margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.6)" />
              <XAxis
                type="number"
                tickFormatter={(v: number) => format(v)}
                tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                tick={{ fontSize: 11.5, fill: "hsl(var(--ws-text-3))" }}
                axisLine={false}
                tickLine={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent formatter={(v) => format(Number(v))} />
                }
              />
              <Bar
                dataKey="value"
                radius={4}
                fill="var(--color-value)"
                cursor="pointer"
                onClick={(entry: { key?: string; drill?: StatsRow["drill"] }) =>
                  drillInto({ key: entry?.key ?? "", drill: entry?.drill ?? null })
                }
              />
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel
          title={t.statTrendTitle}
          sub={t.statTrendSub}
          loading={loading}
          empty={!loading && trendData.every((b) => b.value === 0)}
          emptyLabel={t.statEmpty}
        >
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <AreaChart
              data={trendData}
              margin={{ left: 8, right: 16, top: 8, bottom: 4 }}
            >
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.6)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v: number) => format(v)}
                tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
                axisLine={false}
                tickLine={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent formatter={(v) => format(Number(v))} />
                }
              />
              <Area
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                fill="var(--color-value)"
                fillOpacity={0.18}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </Panel>
      </div>

      {/* Состав целого: одна полоса на 100% плюс легенда-таблица. Круговая здесь
          не годится — углы сравниваются плохо, а цветов хватает на 5–6 (§6.3) */}
      <Panel
        title={t.statCompTitle}
        sub={t.statCompSub}
        loading={loading}
        empty={!loading && composition.parts.length === 0}
        emptyLabel={t.statEmpty}
        height="auto"
      >
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-ws-control">
          {composition.parts.map((part) => (
            <button
              key={`${part.key}-${part.label}`}
              type="button"
              title={`${part.label} · ${format(part.value)}`}
              onClick={() =>
                part.drill && part.key
                  ? drillInto({ key: part.key, drill: part.drill })
                  : undefined
              }
              className={cn(
                "h-full border-0",
                part.drill && part.key ? "cursor-pointer" : "cursor-default",
              )}
              style={{
                width: `${(part.value / composition.total) * 100}%`,
                background: part.color,
              }}
            />
          ))}
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {composition.parts.map((part) => (
            <li
              key={`legend-${part.key}-${part.label}`}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: part.color }}
              />
              <span className="min-w-0 flex-1 truncate text-ws-2">
                {part.label}
              </span>
              <span className="shrink-0 tabular-nums text-ws-3">
                {Math.round((part.value / composition.total) * 100)}%
              </span>
              <span className="shrink-0 tabular-nums text-ws-4">
                {format(part.value)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Состояние по снимкам: суммировать его по времени нельзя, поэтому ряд
          отдельный и от переключателя метрики не зависит (STATISTICS_PLAN §3) */}
      <Panel
        title={t.statVolumeTitle}
        sub={t.statVolumeSub}
        loading={loading}
        empty={!loading && volumeData.length === 0}
        emptyLabel={t.statVolumeEmpty}
      >
        <ChartContainer config={volumeConfig} className="h-[240px] w-full">
          <AreaChart
            data={volumeData}
            margin={{ left: 8, right: 16, top: 8, bottom: 4 }}
          >
            <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.6)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => formatBytes(v)}
              tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
              axisLine={false}
              tickLine={false}
              width={70}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(v) => formatBytes(Number(v))} />
              }
            />
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.16}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </Panel>

      {/* Распределение и поток — два семейства форм из §6.1, которые без архива
          построить нечем: гистограмма по render_sec и воронка по статусам задач */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={t.statHistTitle}
          sub={t.statHistSub}
          loading={loading}
          empty={!loading && histogramData.every((b) => b.value === 0)}
          emptyLabel={t.statHistEmpty}
        >
          <ChartContainer config={histogramConfig} className="h-[240px] w-full">
            <BarChart
              data={histogramData}
              margin={{ left: 8, right: 16, top: 8, bottom: 4 }}
            >
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.6)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "hsl(var(--ws-text-4))" }}
                axisLine={false}
                tickLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" radius={4} fill="var(--color-value)" />
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel
          title={t.statFunnelTitle}
          sub={t.statFunnelSub}
          loading={loading}
          empty={!loading && funnelSteps.every((step) => step.count === 0)}
          emptyLabel={t.statFunnelEmpty}
        >
          <div className="flex flex-col gap-2.5">
            {funnelSteps.map((step) => (
              <div key={step.status} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-ws-2">{funnelNames[step.status]}</span>
                  <span className="tabular-nums text-ws-3">
                    {step.count.toLocaleString(locale(lang))}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ws-control">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      step.status === "done"
                        ? "bg-success"
                        : step.status === "failed"
                          ? "bg-destructive"
                          : "bg-ws-select",
                    )}
                    style={{
                      width: `${funnelMax > 0 ? Math.max(step.count > 0 ? 2 : 0, (step.count / funnelMax) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Таблица и выгрузка: у каждого графика должен быть табличный вид (§6.4) */}
      <div className="rounded-2xl border border-border/60 bg-ws-panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
          <div>
            <h3 className="text-[15px] font-semibold text-ws-1">
              {t.statTableTitle}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-ws-4">{t.statTableSub}</p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-ws-control px-3 py-1.5 text-[12.5px] text-ws-2 hover:bg-ws-hover disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            {t.statExport}
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ws-4">
            {loading ? "" : t.statEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ws-4">
                  <th className="px-4 py-2 font-medium">{t.statColLabel}</th>
                  <Th active={metric === "files"}>{t.statColFiles}</Th>
                  <Th active={metric === "bytes"}>{t.statColBytes}</Th>
                  <Th active={metric === "tasks"}>{t.statColTasks}</Th>
                  <Th active={metric === "errors"}>{t.statColErrors}</Th>
                  <Th active={metric === "procs"}>{t.statColProcs}</Th>
                  <Th active={metric === "spend"}>{t.statColSpend}</Th>
                  {variant === "admin" && (
                    <Th active={metric === "cost"}>{t.statColCost}</Th>
                  )}
                  <Th active={metric === "render"}>{t.statColRender}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.key}-${r.label}`}
                    onClick={() => drillInto(r)}
                    className={cn(
                      "border-t border-border/40",
                      r.drill && r.key
                        ? "cursor-pointer hover:bg-ws-hover"
                        : undefined,
                    )}
                  >
                    <td className="px-4 py-2 text-ws-1">{rowLabel(r)}</td>
                    <Td active={metric === "files"}>
                      {r.files.toLocaleString(locale(lang))}
                    </Td>
                    <Td active={metric === "bytes"}>{formatBytes(r.bytes)}</Td>
                    <Td active={metric === "tasks"}>
                      {r.tasks.toLocaleString(locale(lang))}
                    </Td>
                    <Td active={metric === "errors"}>
                      {r.errors > 0 ? (
                        <span className="text-destructive">{r.errors}</span>
                      ) : (
                        r.errors
                      )}
                    </Td>
                    <Td active={metric === "procs"}>
                      {r.procs.toLocaleString(locale(lang))}
                    </Td>
                    <Td active={metric === "spend"}>
                      {formatSpend(r.spend, lang)}
                    </Td>
                    {variant === "admin" && (
                      <Td active={metric === "cost"}>
                        {formatCost(r.cost, lang)}
                      </Td>
                    )}
                    <Td active={metric === "render"}>
                      {formatDuration(r.render)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.truncated > 0 && (
          <p className="border-t border-border/40 px-4 py-2.5 text-[12px] text-ws-4">
            {tf(t.statTruncated, {
              shown: rows.length,
              rest: data.truncated,
            })}
          </p>
        )}
      </div>
    </div>
  )
}

function CardList({
  title,
  rows,
  emptyLabel,
  lang,
  fallbackLabel,
  onPick,
}: {
  title: string
  rows: StatsCardRow[]
  emptyLabel: string
  lang: Lang
  fallbackLabel: string
  onPick?: (key: string) => void
}) {
  return (
    <div className="rounded-[14px] border border-border/60 bg-ws-control p-4">
      <div className="text-[10.5px] font-semibold tracking-[1.2px] text-ws-4">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ws-4">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={`${row.key}-${row.label}`}
              onClick={() => (onPick && row.key ? onPick(row.key) : undefined)}
              className={cn(
                "flex items-center gap-3 rounded-md px-1.5 py-1 text-[13px]",
                onPick && row.key ? "cursor-pointer hover:bg-ws-hover" : undefined,
              )}
            >
              <span className="min-w-0 flex-1 truncate text-ws-2">
                {row.label || fallbackLabel}
              </span>
              <span className="shrink-0 tabular-nums text-ws-4">
                {row.files.toLocaleString(locale(lang))}
              </span>
              <span className="w-[74px] shrink-0 text-right tabular-nums text-ws-3">
                {formatBytes(row.bytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-ws-panel p-4">
      <div className="text-[10.5px] font-semibold tracking-[1.2px] text-ws-4">
        {label}
      </div>
      <div className="mt-2 text-[26px] font-bold tracking-tight text-ws-1">
        {value}
      </div>
      <div className="mt-1 text-[12px] text-ws-4">{sub}</div>
    </div>
  )
}

function Segmented<T extends string>({
  title,
  help,
  options,
  value,
  onChange,
}: {
  title: string
  /** Статья про саму ось: что значат её значения и откуда берутся числа. */
  help?: HelpTopicId
  options: { key: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[10.5px] font-semibold tracking-[1.2px] text-ws-4">
        {title}
        {help ? <HelpDot id={help} /> : null}
      </span>
      <div className="flex flex-wrap gap-0.5 rounded-[9px] border border-border/60 bg-ws-control p-[3px]">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "h-[28px] rounded-md px-2.5 text-[12.5px] transition-colors",
              value === o.key
                ? "bg-ws-select/[0.28] text-ws-1"
                : "text-ws-3 hover:text-ws-1",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Chip({
  label,
  onClear,
  clearTitle,
}: {
  label: string
  onClear: () => void
  clearTitle: string
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-ws-accent/35 bg-ws-select/[0.16] px-2.5 py-1 text-[12.5px] text-ws-1">
      {label}
      <button
        type="button"
        onClick={onClear}
        title={clearTitle}
        aria-label={clearTitle}
        className="text-ws-3 hover:text-ws-1"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}

function Panel({
  title,
  sub,
  loading,
  empty,
  emptyLabel,
  height = "chart",
  children,
}: {
  title: string
  sub: string
  loading: boolean
  empty: boolean
  emptyLabel: string
  /** `auto` — для панелей без графика: полоса состава высоту не держит. */
  height?: "chart" | "auto"
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-ws-panel px-4 py-4">
      <h3 className="text-[15px] font-semibold text-ws-1">{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-ws-4">{sub}</p>
      <div className="mt-4">
        {loading ? (
          <div
            className={cn(
              "flex items-center justify-center text-ws-4",
              height === "auto" ? "h-16" : "h-[320px]",
            )}
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : empty ? (
          <div
            className={cn(
              "flex items-center justify-center text-[13px] text-ws-4",
              height === "auto" ? "h-16" : "h-[320px]",
            )}
          >
            {emptyLabel}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function Th({
  children,
  active,
}: {
  children: React.ReactNode
  active: boolean
}) {
  return (
    <th
      className={cn(
        "px-4 py-2 text-right font-medium",
        active && "text-ws-accent",
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  active,
}: {
  children: React.ReactNode
  active: boolean
}) {
  return (
    <td
      className={cn(
        "px-4 py-2 text-right tabular-nums",
        active ? "font-semibold text-ws-1" : "text-ws-3",
      )}
    >
      {children}
    </td>
  )
}
