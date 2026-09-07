"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  FEATURES,
  FEATURE_GROUPS,
  type FeatureGroup,
  type FeatureKey,
} from "@/lib/features"
import type { AdminDictKey } from "@/components/admin/admin-dict"

/**
 * Выключатели частей сайта.
 *
 * Экран рисуется из реестра (lib/features.ts), а не из ответа сервера: новый
 * флаг появляется здесь строкой в массиве, без правки этого файла. Сервер
 * отдаёт только значения — иначе список того, что вообще бывает, разъехался бы
 * с кодом.
 */

type FeatureRow = {
  key: FeatureKey
  enabled: boolean
  source: "env" | "runtime"
  env: string | null
  decided: boolean
}

const GROUP_LABEL: Record<FeatureGroup, AdminDictKey> = {
  public: "featureGroupPublic",
  billing: "featureGroupBilling",
  insights: "featureGroupInsights",
  tools: "featureGroupTools",
}

export function FeaturesContent() {
  const t = useAdminI18n()
  const [rows, setRows] = useState<Map<FeatureKey, FeatureRow> | null>(null)
  const [pending, setPending] = useState<FeatureKey | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/features", { cache: "no-store" })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as { features: FeatureRow[] }
      setRows(new Map(data.features.map((row) => [row.key, row])))
    } catch {
      toast.error(t.featuresLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback(
    async (key: FeatureKey, enabled: boolean) => {
      setPending(key)
      try {
        const response = await fetch("/api/admin/features", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, enabled }),
        })
        if (!response.ok) throw new Error(String(response.status))
        const data = (await response.json()) as { features: FeatureRow[] }
        setRows(new Map(data.features.map((row) => [row.key, row])))
      } catch {
        toast.error(t.featureSaveError)
      } finally {
        setPending(null)
      }
    },
    [t],
  )

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.featuresEyebrow}
        title={t.featuresTitle}
        description={t.featuresDescription}
        help="features.overview"
      />

      {rows === null ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-10">
          {FEATURE_GROUPS.map((group) => {
            const items = FEATURES.filter((feature) => feature.group === group)
            if (items.length === 0) return null

            return (
              <section key={group} className="space-y-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {t[GROUP_LABEL[group]]}
                </h2>

                <ul className="divide-y divide-border/60 rounded-lgx border border-border/60 bg-surface-2/40">
                  {items.map((feature) => {
                    const row = rows.get(feature.key)
                    const isEnv = feature.source === "env"

                    return (
                      <li
                        key={feature.key}
                        className="flex items-start justify-between gap-6 px-4 py-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {t[feature.labelKey]}
                            </span>
                            {/* Источник значения виден сразу: иначе переключатель,
                                не поддающийся нажатию, читается как поломка. */}
                            {isEnv ? (
                              <Badge variant="outline" className="text-[11px]">
                                {t.featureSourceEnv}
                              </Badge>
                            ) : row && !row.decided ? (
                              <Badge variant="outline" className="text-[11px]">
                                {t.featureDecidedDefault}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="max-w-2xl text-sm text-muted-foreground">
                            {t[feature.descriptionKey]}
                          </p>
                          {isEnv && feature.env ? (
                            <p className="text-xs text-muted-foreground/80">
                              {tf(t.featureSourceEnvHint, { name: feature.env })}
                            </p>
                          ) : null}
                        </div>

                        <Switch
                          checked={row?.enabled ?? false}
                          disabled={isEnv || pending === feature.key}
                          onCheckedChange={(next) => {
                            void toggle(feature.key, next)
                          }}
                          aria-label={t[feature.labelKey]}
                        />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
