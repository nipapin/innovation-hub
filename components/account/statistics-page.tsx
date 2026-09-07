"use client"

import Link from "next/link"
import { ArrowLeft, BarChart3 } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { StatsReadiness } from "@/components/account/stats-readiness"
import { HelpPageButton } from "@/components/help/help-page-button"
import { StatisticsExplorer } from "@/components/statistics/statistics-explorer"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

/**
 * Расширенная статистика кабинета. Скоуп «только своё» навешивает роут
 * `/api/account/statistics`, клиент его не выбирает. Вход — с дашборда,
 * отдельного пункта в меню нет.
 */
export function StatisticsPageClient() {
  const { t } = useI18n()

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4 md:px-6">
        <div className="text-[13px] text-ws-3">
          {t.accountCrumb}
          <span className="text-ws-5"> / </span>
          <span className="text-ws-1">{t.statsAdvTitle}</span>
        </div>
        <div className="flex items-center gap-3">
          <ProcessingIndicator />
          <Link
            href="/account"
            className="flex items-center gap-1.5 text-[13px] text-ws-2 hover:text-ws-1"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.dashboard}
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-7">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-5">
          <header>
            <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[1.6px] text-ws-accent">
              <BarChart3 className="h-4 w-4" />
              {t.statsAdvEyebrow}
            </div>
            {/* Иконка сразу после названия — тот же вход, что в админке:
                стиль справки один на весь продукт (UI_GUIDE §0.13). */}
            <div className="mt-2.5 flex items-center gap-3">
              <h1 className="text-[26px] font-bold tracking-tight text-ws-1 md:text-[32px]">
                {t.statsAdvTitle}
              </h1>
              <HelpPageButton id="statistics.personal" />
            </div>
            <p className="mt-2 max-w-[680px] text-[14px] text-ws-3">
              {t.statsAdvDesc}
            </p>
          </header>

          <StatisticsExplorer endpoint="/api/account/statistics" variant="account" />

          <section className="rounded-2xl border border-border/60 bg-ws-panel px-4 py-4">
            <h2 className="text-[15px] font-semibold text-ws-1">
              {t.statsAdvSoonTitle}
            </h2>
            <p className="mt-1.5 max-w-[760px] text-[13px] leading-relaxed text-ws-4">
              {t.statsAdvSoonDesc}
            </p>
            <div className="mt-4">
              <StatsReadiness
                readyTitle={t.statsAdvSoonReady}
                ready={[
                  t.statsAdvSoonReady1,
                  t.statsAdvSoonReady2,
                  t.statsAdvSoonReady3,
                  t.statsAdvSoonReady4,
                ]}
                pendingTitle={t.statsAdvSoonPending}
                pending={[
                  t.statsAdvSoonPending1,
                  t.statsAdvSoonPending2,
                  t.statsAdvSoonPending3,
                ]}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
