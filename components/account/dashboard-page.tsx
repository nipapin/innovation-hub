"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Folder,
  Loader2,
  Film,
  Plus,
  Sparkles,
  User,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  greetingForHour,
  useI18n,
} from "@/components/account/i18n"
import { TrialCard } from "@/components/account/trial-card"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

type Stats = {
  balanceCents: number
  projectCount: number
  fileCount: number
  totalRuntime: string
  chartBars: { label: string; value: number }[]
  periodClips: number
  periodProcTime: string
  periodRuntime: string
  periodAvg: string
}

type Props = {
  fullName: string
  createdAt: string
}

export function DashboardPageClient({ fullName, createdAt }: Props) {
  const { t, lang } = useI18n()
  const router = useRouter()
  /**
   * `?trial=1` — намерение, принесённое кнопкой из шапки или из регистрации.
   * Оно только открывает условия; период включает человек кнопкой в диалоге.
   */
  const trialIntent = useSearchParams().get("trial") === "1"
  const [stats, setStats] = useState<Stats | null>(null)
  const [range, setRange] = useState<"day" | "week" | "month">("week")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/account/stats?range=${range}`)
      if (res.ok) {
        setStats(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const greeting = `${greetingForHour(new Date().getHours(), t)}, ${fullName.split(/\s+/)[0] || "there"}`
  const memberSince = (() => {
    try {
      return new Date(createdAt).toLocaleDateString(
        lang === "ru" ? "ru-RU" : "en-US",
        { year: "numeric", month: "short", day: "numeric" },
      )
    } catch {
      return createdAt
    }
  })()

  const maxBar = Math.max(1, ...(stats?.chartBars.map((b) => b.value) ?? [1]))

  const createProject = async () => {
    const name =
      lang === "ru"
        ? `Проект ${new Date().toLocaleDateString("ru-RU")}`
        : `Project ${new Date().toLocaleDateString("en-US")}`
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const data = await res.json()
      router.push(`/account/projects?id=${data.project.id}`)
    }
  }

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-foreground/[0.07] px-4 md:px-6">
        <div className="text-[13px] text-muted-foreground/90">
          {t.accountCrumb}
          <span className="text-muted-foreground/50"> / </span>
          <span className="text-foreground">{t.dashboardCrumb}</span>
        </div>
        <ProcessingIndicator />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-7">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-5">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-[18px] border border-foreground/10 bg-gradient-to-br from-primary/20 to-surface-overlay/20 px-6 py-7 md:px-8 md:py-8">
            <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[1.6px] text-primary">
              <Sparkles className="h-4 w-4" />
              {t.yourWorkspace}
            </div>
            <h1 className="mt-3.5 text-[28px] font-bold tracking-tight md:text-[42px]">
              {greeting}
            </h1>
            <p className="mt-2.5 max-w-[560px] text-[15px] text-muted-foreground">
              {t.heroSub}
            </p>
            <div className="mt-3.5 text-[13px] text-muted-foreground/80">
              {t.memberSince} {memberSince}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/account/projects"
                  className="flex items-center gap-2 rounded-[11px] border border-foreground/10 bg-surface-1 px-4 py-2.5 text-[14px] text-foreground hover:bg-surface-3"
                >
                  {t.allProjects}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={createProject}
                  className="flex items-center gap-2 rounded-[11px] bg-primary px-4 py-2.5 text-[14px] font-medium text-white hover:bg-primary"
                >
                  <Plus className="h-[18px] w-[18px]" />
                  {t.newProject}
                </button>
              </div>

              {/*
                Единственный вход на публичный сайт из кабинета. Раньше он был в
                четырёх верхних панелях сразу и занимал в каждой правый край —
                самое видное место строки — ради действия, которым пользуются
                хорошо если раз в сессию. Здесь он один, на дашборде, куда и так
                попадают на входе, и в новой вкладке: кабинет — рабочее место,
                терять его ради разглядывания сайта незачем.
              */}
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              >
                {t.viewSite}
                <ArrowUpRight className="h-[15px] w-[15px]" />
              </a>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TrialCard autoOpen={trialIntent} />
            <StatCard
              label={t.cardProjects}
              value={String(stats?.projectCount ?? "—")}
              sub={t.cardProjectsSub}
              icon={<Folder className="h-5 w-5 text-muted-foreground/65" />}
            />
            <StatCard
              label={t.cardClips}
              value={String(stats?.fileCount ?? "—")}
              sub={t.cardClipsSub}
              icon={<Film className="h-5 w-5 text-muted-foreground/65" />}
            />
            <StatCard
              label={t.cardRuntime}
              value={stats?.totalRuntime ?? "—"}
              sub={t.cardRuntimeSub}
              icon={<Clock className="h-5 w-5 text-muted-foreground/65" />}
            />
          </div>

          {/* Chart */}
          <div className="rounded-[18px] border border-foreground/10 bg-surface-1 px-5 py-5 md:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[19px] font-bold">{t.statsTitle}</h3>
                <p className="mt-1 text-[13px] text-muted-foreground/80">{t.statsSub}</p>
                <Link
                  href="/account/statistics"
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-primary hover:text-primary/90"
                >
                  {t.statsAdvOpen}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="flex gap-0.5 rounded-[9px] border border-foreground/10 bg-surface-1 p-[3px]">
                {(
                  [
                    ["day", t.rangeDays],
                    ["week", t.rangeWeeks],
                    ["month", t.rangeMonths],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setRange(key)}
                    className={cn(
                      "h-[30px] rounded-md px-3 text-[12.5px]",
                      range === key
                        ? "bg-primary/30 text-foreground"
                        : "text-muted-foreground/90 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex h-[220px] items-center justify-center text-muted-foreground/65">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="mt-6 flex h-[200px] items-end gap-2.5 border-b border-foreground/[0.07] pb-1.5 md:h-[220px]">
                  {(stats?.chartBars ?? []).map((b) => (
                    <div
                      key={b.label}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    >
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {b.value}
                      </span>
                      <div
                        className="w-full max-w-[46px] rounded-t-[7px] rounded-b-[3px] bg-gradient-to-b from-chart-1 to-primary"
                        style={{
                          height: `${Math.max(4, (b.value / maxBar) * 100)}%`,
                          minHeight: 4,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2.5">
                  {(stats?.chartBars ?? []).map((b) => (
                    <span
                      key={`l-${b.label}`}
                      className="flex-1 text-center text-[11.5px] text-muted-foreground/65"
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MiniStat label={t.statProcessed} value={String(stats?.periodClips ?? 0)} />
                  <MiniStat label={t.statProcTime} value={stats?.periodProcTime ?? "—"} />
                  <MiniStat label={t.statRuntime} value={stats?.periodRuntime ?? "—"} />
                  <MiniStat label={t.statAvg} value={String(stats?.periodAvg ?? "0")} />
                </div>
              </>
            )}
          </div>

          {/* Shortcuts */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Link
              href="/account/statistics"
              className="flex items-center gap-4 rounded-[14px] border border-foreground/10 bg-surface-1 p-5 text-left hover:border-foreground/[0.18]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-foreground/5">
                <BarChart3 className="h-[22px] w-[22px] text-primary/90" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-foreground">
                  {t.statsAdvanced}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground/80">
                  {t.shortcutStatsSub}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground/65" />
            </Link>
            <Link
              href="/account/projects"
              className="flex items-center gap-4 rounded-[14px] border border-foreground/10 bg-surface-1 p-5 text-left hover:border-foreground/[0.18]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-foreground/5">
                <Folder className="h-[22px] w-[22px] text-primary/90" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-foreground">
                  {t.shortcutProjectsTitle}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground/80">
                  {t.shortcutProjectsSub}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground/65" />
            </Link>
            <Link
              href="/account/profile"
              className="flex items-center gap-4 rounded-[14px] border border-foreground/10 bg-surface-1 p-5 text-left hover:border-foreground/[0.18]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-foreground/5">
                <User className="h-[22px] w-[22px] text-primary/90" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-foreground">
                  {t.shortcutProfileTitle}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground/80">
                  {t.shortcutProfileSub}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground/65" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
  action,
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  accent?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-[22px]",
        accent
          ? "border-primary/30 bg-gradient-to-br from-primary/20 to-primary/5"
          : "border-foreground/10 bg-surface-1",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-[11px] font-semibold tracking-[1.4px]",
            accent ? "text-primary/90" : "text-muted-foreground/80",
          )}
        >
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-4 text-[34px] font-bold tracking-tight">{value}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{sub}</span>
        {action}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted-foreground/80">{label}</div>
      <div className="mt-1 text-[22px] font-bold">{value}</div>
    </div>
  )
}
