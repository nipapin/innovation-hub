"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Building2, Globe, Loader2, Monitor } from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type Area = {
  companyId: string | null
  title: string | null
  automationEnabled: boolean | null
  peopleWatched: number
  peopleTotal: number
  queued: number
  running: number
  failedDay: number
  machines: number
  machinesOnline: number
}

/**
 * Пульт: все конвейеры одной таблицей — docs/COMPANY_PIPELINE_PLAN.md §6.
 *
 * Смысл в том, чтобы НЕ ходить по компаниям: таблица отвечает на вопрос «где что
 * стоит» одним взглядом, а не после обхода десяти консолей. Поэтому здесь нет ни
 * поиска, ни разворачивающихся строк — всё, ради чего её открыли, видно сразу.
 *
 * Живёт НА странице конвейера, а не отдельным разделом. Своим разделом она
 * стала бы вторым инструментом области, у которой уже есть хаб, — и нажатие на
 * «Конвейер» в меню перестало бы открывать конвейер (это ловит admin:check).
 * Но дело не только в проверке: пульт отвечает на первый вопрос, с которым сюда
 * приходят, и прятать его за лишний переход значило бы отвечать на него вторым.
 *
 * Установка без компаний не видит ничего нового: одна строка «Общий раздел» —
 * это не таблица, а лишний заголовок над цифрами, которые и так на экране.
 *
 * Тумблер — управление установкой, и он у нас, а не в консоли компании. Флаг
 * «только свои машины» рядом наоборот: он их (§4).
 */
export function PipelineAreas({ tick }: { tick: number }) {
  const { t } = useI18n()
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pipeline/areas", { cache: "no-store" })
    if (!res.ok) {
      toast.error(t.areasLoadFailed)
      setLoading(false)
      return
    }
    const body = (await res.json()) as { areas: Area[] }
    setAreas(body.areas)
    setLoading(false)
  }, [t])

  // Такт общий со всей страницей: пульт установки, очередь и эта таблица
  // смотрят на одно и то же, и разъезжаться им нельзя — две разные правды на
  // одном экране хуже, чем одна устаревшая.
  useEffect(() => {
    void load()
  }, [load, tick])

  const toggle = async (area: Area, next: boolean) => {
    if (!area.companyId) return
    setBusy(area.companyId)
    // Рисуем сразу, откатываем при отказе: ответ идёт через запись в базу, и
    // тумблер, думающий полсекунды, читается как «не сработало».
    setAreas((rows) =>
      rows.map((row) =>
        row.companyId === area.companyId
          ? { ...row, automationEnabled: next }
          : row,
      ),
    )
    try {
      const res = await fetch(`/api/admin/companies/${area.companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationEnabled: next }),
      })
      if (!res.ok) {
        setAreas((rows) =>
          rows.map((row) =>
            row.companyId === area.companyId
              ? { ...row, automationEnabled: !next }
              : row,
          ),
        )
        toast.error(t.areasToggleFailed)
        return
      }
      toast.success(next ? t.areasResumed : t.areasPaused)
    } finally {
      setBusy(null)
    }
  }

  // Пока грузится — ничего: таблица появляется только при компаниях, и мигать
  // заглушкой там, где через секунду может не оказаться ничего, незачем.
  if (loading || areas.length < 2) return null

  return (
    <Section
      title={t.areasTitle}
      description={t.areasSub}
      collapsible
      storageKey="ui-pipeline-areas-open"
    >
      {(
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t.areasArea}</th>
                <th className="px-4 py-3 text-left font-medium">{t.areasWatching}</th>
                <th className="px-4 py-3 text-right font-medium">{t.areasQueued}</th>
                <th className="px-4 py-3 text-right font-medium">{t.areasRunning}</th>
                <th className="px-4 py-3 text-right font-medium">{t.areasFailed}</th>
                <th className="px-4 py-3 text-left font-medium">{t.areasMachines}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {areas.map((area) => {
                const general = area.companyId === null
                return (
                  <tr key={area.companyId ?? "__general__"}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        {general ? (
                          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-medium text-foreground">
                          {general ? t.areasGeneral : area.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {tf(t.areasPeople, {
                          watched: area.peopleWatched,
                          total: area.peopleTotal,
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* У общего раздела выключателя нет: гейт там стоит на
                          каждом человеке отдельно, и одного ответа «да/нет» на
                          всю область не существует. Тумблер, показывающий
                          несуществующее состояние, врал бы при первом взгляде,
                          поэтому здесь ссылка на то место, где это решается. */}
                      {general ? (
                        <span className="text-xs text-muted-foreground">
                          {t.areasByPerson}
                        </span>
                      ) : (
                        <Switch
                          checked={area.automationEnabled === true}
                          disabled={busy === area.companyId}
                          onCheckedChange={(checked) => void toggle(area, checked)}
                          aria-label={t.areasWatching}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {area.queued}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {area.running}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        area.failedDay > 0 ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {area.failedDay > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {area.failedDay}
                        </span>
                      ) : (
                        area.failedDay
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Monitor
                          className={cn(
                            "h-4 w-4 shrink-0",
                            area.machinesOnline > 0
                              ? "text-success"
                              : "text-muted-foreground",
                          )}
                        />
                        <span className="text-xs text-muted-foreground">
                          {general
                            ? tf(t.areasOurMachines, {
                                online: area.machinesOnline,
                                total: area.machines,
                              })
                            : area.machines === 0
                              ? t.areasNoOwnMachines
                              : tf(t.areasOwnMachines, {
                                  online: area.machinesOnline,
                                  total: area.machines,
                                })}
                        </span>
                      </span>
                      {/* Самый заметный тупик: компания выключена, а работа в
                          очереди уже лежит. Без подписи это выглядит как
                          поломка конвейера, а не как чьё-то решение. */}
                      {!general &&
                      area.automationEnabled === false &&
                      area.queued > 0 ? (
                        <span className="mt-0.5 block text-xs text-amber-400">
                          {t.areasHeld}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
