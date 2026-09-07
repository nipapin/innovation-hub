"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useI18n } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { useDisabledAdminTools } from "@/components/admin/shell/features-context"
import {
  findArea,
  isToolActive,
  toolsInArea,
  type AdminArea,
} from "@/components/admin/shell/nav-config"
import { cn } from "@/lib/utils"

/**
 * Вторая колонка админки — список инструментов текущей области.
 *
 * Тот же приём, что у колонки проектов в кабинете: раздел выбирается в боковом
 * меню, а колонка показывает, что внутри. Без неё инструмент виден только на
 * хабе, то есть до него всегда два клика; с ней — один, из любого места области.
 *
 * Ширина тянется за правый край и запоминается, как у колонки проектов.
 */
export function AdminToolsColumn({ area }: { area: AdminArea }) {
  const { t } = useI18n()
  const pathname = usePathname() ?? ""
  const { currentUserRole, currentUserCapabilities } = useAdminData()

  const info = findArea(area)
  const disabled = useDisabledAdminTools()
  const tools = toolsInArea(area, currentUserRole, currentUserCapabilities, disabled)

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 260,
    min: 200,
    max: 420,
    axis: "x",
    storageKey: "ffworks-admin-tools-width",
  })

  if (!info || tools.length === 0) return null

  return (
    <section
      style={{ width: size }}
      className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well lg:flex"
    >
      <header className="flex items-center gap-2 px-4 pb-2 pt-5">
        <span className="h-3 w-[3px] shrink-0 rounded-full bg-primary/60" />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-ws-4">
          {t[info.labelKey]}
        </span>
      </header>

      <nav className="scrollbar-elegant flex-1 overflow-y-auto px-2 pb-3">
        {tools.map((tool) => {
          const Icon = tool.icon
          const active = isToolActive(tool, pathname)
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className={cn(
                "flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors",
                active
                  ? "bg-ws-select/35 text-ws-1"
                  : "text-ws-3 hover:bg-white/5 hover:text-ws-1",
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">
                  {t[tool.labelKey]}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-ws-4">
                  {t[tool.descriptionKey]}
                </span>
              </span>
            </Link>
          )
        })}
      </nav>

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.adminHubTools}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}
