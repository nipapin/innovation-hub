"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { useDisabledAdminTools } from "@/components/admin/shell/features-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import {
  findArea,
  toolsInArea,
  type AdminArea,
} from "@/components/admin/shell/nav-config"

/**
 * Страница-хаб группы: карточки инструментов, которые в ней лежат.
 *
 * Меню показывает только группы, поэтому список инструментов должен где-то
 * жить целиком — иначе о разделе можно узнать только случайно. Хаб — это тот
 * список, и он же место, куда группа будет расти: добавить сюда карточку
 * дешевле, чем ещё одну строку в боковое меню.
 *
 * Скрываем недоступное теми же правилами, что и меню (`visibleNavItems`):
 * карточка, ведущая на редирект, ничем не лучше кнопки, ведущей в 403.
 */
/**
 * Только карточки, без шапки.
 *
 * Отдельно от AdminHub, потому что «Главной» страницы-хаба нет — её хаб это сам
 * обзор. Без этого «Контент» стал бы недостижим: в меню теперь одни группы.
 *
 * `exclude` — адрес, который на этой странице показывать не нужно: обзор не
 * ссылается сам на себя.
 */
export function AdminHubCards({ area }: { area: AdminArea }) {
  const { t } = useI18n()
  const { currentUserRole, currentUserCapabilities } = useAdminData()

  // Хаб области не рисует карточку на самого себя: обзор не ссылается на обзор.
  const disabled = useDisabledAdminTools()
  const items = toolsInArea(
    area,
    currentUserRole,
    currentUserCapabilities,
    disabled,
  ).filter((tool) => !tool.isAreaHub)

  if (items.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-start gap-4 rounded-2xl border border-border/60 bg-card/40 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-card/70"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-display text-[15px] font-semibold text-foreground">
                    {t[item.labelKey]}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                  {t[item.descriptionKey]}
                </span>
              </span>
            </Link>
          )
        })}
    </div>
  )
}

export function AdminHub({ area }: { area: AdminArea }) {
  const { t } = useI18n()
  const info = findArea(area)
  if (!info) return null

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.adminPanel}
        title={t[info.labelKey]}
        description={t[info.descriptionKey]}
      />
      <AdminHubCards area={area} />
    </div>
  )
}
