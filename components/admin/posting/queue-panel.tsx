"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useI18n, type Lang } from "@/components/account/i18n"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import type { PostJobRow, PostJobStatus } from "@/lib/posting/jobs"
import type { RouteReport, SkipReason } from "@/lib/posting/scan"
import { cn } from "@/lib/utils"

/**
 * Очередь публикаций и отчёт по маршрутам.
 *
 * Две таблицы на одной странице, и это не свалка: они отвечают на два разных
 * вопроса, которые задают подряд. «Что происходит» — очередь. «Почему ничего не
 * происходит» — маршруты: там на каждой строке написано, чего не хватило.
 * Разведи их по вкладкам, и второй вопрос пришлось бы догадаться задать.
 */

type Dict = ReturnType<typeof useAdminI18n>

const STATUS_KEY: Record<PostJobStatus, keyof Dict> = {
  queued: "postingStatusQueued",
  running: "postingStatusRunning",
  done: "postingStatusDone",
  failed: "postingStatusFailed",
  skipped: "postingStatusSkipped",
}

const SKIP_KEY: Record<SkipReason, keyof Dict> = {
  "no-options": "postingSkipNoOptions",
  "invalid-options": "postingSkipInvalidOptions",
  "no-routes": "postingSkipNoRoutes",
  "local-folder": "postingSkipLocalFolder",
  "description-linked": "postingSkipDescriptionLinked",
  "no-account": "postingSkipNoAccount",
  "account-missing": "postingSkipAccountMissing",
  "target-missing": "postingSkipTargetMissing",
  cooldown: "postingSkipCooldown",
  "outside-window": "postingSkipOutsideWindow",
  interval: "postingSkipInterval",
  "in-flight": "postingSkipInFlight",
  "no-files": "postingSkipNoFiles",
  "platform-not-ready": "postingSkipPlatformNotReady",
}

function fmtWhen(iso: string | null, lang: Lang): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Обратный отсчёт в человеческом виде: «2 ч 15 мин», а не 8100 секунд. */
function fmtDuration(seconds: number, t: Dict): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours > 0) return `${hours} ${t.postingUnitHour} ${minutes} ${t.postingUnitMin}`
  if (minutes > 0) return `${minutes} ${t.postingUnitMin}`
  return t.postingUnderMinute
}

const STATUS_TONE: Record<PostJobStatus, string> = {
  queued: "text-ws-3",
  running: "text-ws-out",
  done: "text-ws-3",
  failed: "text-destructive",
  skipped: "text-ws-5",
}

export function PostingQueuePanel({
  tick,
  routes,
}: {
  tick: number
  routes: RouteReport[]
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()
  const [jobs, setJobs] = useState<PostJobRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/posting/jobs", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { jobs: PostJobRow[] }
      setJobs(data.jobs)
    } catch {
      // Молча: ошибку опроса показывает пульт, дублировать её незачем.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, tick])

  const act = async (job: PostJobRow, action: "retry" | "cancel") => {
    setBusyId(job.id)
    try {
      const res = await fetch(`/api/admin/posting/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        toast.error(t.postingActionError)
        return
      }
      toast.success(action === "retry" ? t.postingRetried : t.postingCancelled)
      await load()
    } catch {
      toast.error(t.postingServerUnavailable)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <header className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-[13px] font-semibold text-ws-1">
            {t.postingQueueTitle}
          </h2>
        </header>

        {jobs === null ? (
          <div className="flex justify-center py-8 text-ws-5">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <p className="rounded-lg border border-white/[0.08] px-4 py-5 text-[13px] text-ws-4">
            {t.postingQueueEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-ws-5">
                <tr className="border-b border-white/[0.08]">
                  <th className="px-3 py-2 font-medium">{t.postingColProject}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColFile}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColTarget}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColStatus}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColWhen}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-white/[0.05] last:border-0"
                  >
                    <td className="px-3 py-2 text-ws-2">
                      <span className="block truncate">{job.projectName}</span>
                      <span className="block truncate text-[11px] text-ws-5">
                        {job.ownerEmail}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2">
                      <span className="block truncate text-ws-2">
                        {job.fileName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ws-3">
                      <span className="block truncate">
                        {job.accountLabel ?? "—"}
                      </span>
                      <span className="block truncate text-[11px] text-ws-5">
                        {job.target?.kind === "group"
                          ? (job.target.name ?? "")
                          : t.postingProfile}
                      </span>
                    </td>
                    <td className={cn("px-3 py-2", STATUS_TONE[job.status])}>
                      {t[STATUS_KEY[job.status]] as string}
                      {/* У опубликованной задачи текст в этом поле — не
                          ошибка, а замечание: публикация состоялась, а вот
                          перенести файл не вышло. Красный цвет тут говорил бы
                          неправду. */}
                      {job.error ? (
                        <span
                          className={cn(
                            "mt-0.5 flex items-start gap-1 text-[11px] leading-snug",
                            job.status === "done"
                              ? "text-amber-200/80"
                              : "text-destructive",
                          )}
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {job.error}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ws-4">
                      {fmtWhen(job.publishedAt ?? job.createdAt, lang)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {job.externalUrl ? (
                        <a
                          href={job.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-ws-3 hover:text-ws-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t.postingOpenPost}
                        </a>
                      ) : job.status === "failed" || job.status === "skipped" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === job.id}
                          onClick={() => void act(job, "retry")}
                        >
                          {t.postingRetry}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === job.id}
                          onClick={() => void act(job, "cancel")}
                        >
                          {t.postingCancel}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <header className="space-y-1">
          <h2 className="text-[13px] font-semibold text-ws-1">
            {t.postingRoutesTitle}
          </h2>
          <p className="text-[11.5px] leading-relaxed text-ws-5">
            {t.postingRoutesHint}
          </p>
        </header>

        {routes.length === 0 ? (
          <p className="rounded-lg border border-white/[0.08] px-4 py-5 text-[13px] text-ws-4">
            {t.postingRoutesEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-ws-5">
                <tr className="border-b border-white/[0.08]">
                  <th className="px-3 py-2 font-medium">{t.postingColProject}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColTarget}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColQueued}</th>
                  <th className="px-3 py-2 font-medium">{t.postingColNext}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr
                    key={`${route.projectId}:${route.finderId}`}
                    className="border-b border-white/[0.05] last:border-0"
                  >
                    <td className="px-3 py-2 text-ws-2">
                      <span className="block truncate">{route.projectName}</span>
                      <span className="block truncate font-mono text-[11px] text-ws-5">
                        {route.folder || "/"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ws-3">
                      <span className="block truncate">
                        {route.account || "—"}
                      </span>
                      <span className="block truncate text-[11px] text-ws-5">
                        {route.target}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ws-3">
                      {route.queued}
                    </td>
                    <td className="px-3 py-2 text-ws-4">
                      {route.createdJobId ? (
                        <span className="text-ws-out">
                          {t.postingStatusQueued}
                        </span>
                      ) : route.skip ? (
                        <span>
                          {tf(t[SKIP_KEY[route.skip]] as string, {
                            account: route.account,
                            target: route.target,
                          })}
                          {route.dueIn != null
                            ? ` — ${tf(t.postingDueIn, {
                                time: fmtDuration(route.dueIn, t),
                              })}`
                            : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
