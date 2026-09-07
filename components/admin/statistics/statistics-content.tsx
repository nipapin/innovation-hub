"use client"

import { useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { tf, useI18n } from "@/components/account/i18n"
import { StatsReadiness } from "@/components/account/stats-readiness"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { HelpDot } from "@/components/help/help-dot"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { StatisticsExplorer } from "@/components/statistics/statistics-explorer"

/**
 * Админская статистика: то же, что в кабинете, но без скоупа — все
 * пользователи, проекты и машины, с провалом в элемент
 * (docs/STATISTICS_PLAN.md §6).
 */
export function AdminStatisticsContent() {
  const { t } = useI18n()
  const { can } = useAdminData()
  const [importing, setImporting] = useState(false)

  /**
   * Ручной прогон приёмника: догнать архив, не дожидаясь часового тика.
   * Идемпотентен, поэтому кнопку можно жать сколько угодно.
   */
  const runImport = async () => {
    setImporting(true)
    try {
      const res = await fetch("/api/admin/statistics/import", { method: "POST" })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      toast.success(
        tf(t.statImportDone, {
          rows: data.rowsInserted ?? 0,
          files: data.filesRead ?? 0,
          skipped: data.filesSkipped ?? 0,
        }),
      )
    } catch {
      toast.error(t.statImportFail)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={t.adminStatsEyebrow}
        title={t.adminStatsTitle}
        description={t.adminStatsDesc}
        help="statistics.overview"
      />

      <StatisticsExplorer endpoint="/api/admin/statistics" variant="admin" />

      <section className="rounded-2xl border border-border/60 bg-ws-panel px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ws-1">
            {t.adminStatsSoonTitle}
          </h2>
          {/* Просмотр и загрузка пачкой — разные теги: импорт перезаписывает
              чужие данные, просмотр нет. */}
          {can("statistics.import") ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runImport}
                disabled={importing}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-ws-control px-3 py-1.5 text-[12.5px] text-ws-2 hover:bg-ws-hover disabled:opacity-40"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                {importing ? t.statImportRunning : t.statImportRun}
              </button>
              {/* Знак «?» при кнопке, а не при заголовке: вопрос тут не «что за
                  раздел», а «что именно сделает этот прогон и можно ли жать
                  дважды». Справка о разделе живёт в шапке страницы. */}
              <HelpDot id="statistics.import" align="end" />
            </div>
          ) : null}
        </div>
        <p className="mt-1.5 max-w-[760px] text-[13px] leading-relaxed text-ws-4">
          {t.adminStatsSoonDesc}
        </p>
        <div className="mt-4">
          <StatsReadiness
            readyTitle={t.statsAdvSoonReady}
            ready={[
              t.adminStatsReady1,
              t.adminStatsReady2,
              t.adminStatsReady3,
              t.adminStatsReady4,
            ]}
            pendingTitle={t.statsAdvSoonPending}
            pending={[
              t.adminStatsPending1,
              t.adminStatsPending2,
              t.adminStatsPending3,
            ]}
          />
        </div>
      </section>
    </div>
  )
}
