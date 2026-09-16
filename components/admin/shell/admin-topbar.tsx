"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, ArrowUpRight, PanelLeft, PanelLeftClose } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import {
  ADMIN_AREAS,
  findArea,
  findTool,
  isAreaActive,
} from "./nav-config"
import { AdminMobileSidebar } from "./admin-mobile-sidebar"
import type { AdminDensity } from "./use-admin-density"
import { cn } from "@/lib/utils"

type Props = {
  email: string
  fullName: string
  density: AdminDensity
  setDensity: (density: AdminDensity) => void
  /** Колонки на этой странице нет — переключать нечего. */
  hasColumn: boolean
}

/**
 * Верхняя панель админки: где я нахожусь, полный вид или упрощённый, выход на сайт.
 *
 * Раскладка та же, что у шапки кабинета, — человек не должен переучиваться,
 * переходя из рабочего места в админку. Отличается акцентом: иконка области
 * подсвечена, и над панелью тонкая линия — чтобы по одному взгляду было видно,
 * что это админская зона, а не кабинет.
 */
export function AdminTopbar({
  email,
  fullName,
  density,
  setDensity,
  hasColumn,
}: Props) {
  const pathname = usePathname() ?? ""
  const { t } = useI18n()
  const adminT = useAdminI18n()

  const tool = findTool(pathname)
  const area = tool
    ? findArea(tool.areas[0])
    : ADMIN_AREAS.find((candidate) => isAreaActive(candidate, pathname))
  const AreaIcon = area?.icon
  // Инструмент, который сам является хабом области, во второй крошке не
  // повторяется: «Тарифы / Тарифы» ничего не сообщает.
  const toolLabel =
    tool && !tool.isAreaHub ? (t[tool.labelKey] as string) : null
  // Мы уже на главной странице области — вести «наверх» некуда.
  const atAreaHome = area != null && pathname === area.href
  // «Наверх» — на ближайший уровень, а не сразу в хаб области: со страницы
  // внутри раздела (документация машинного API внутри «Удалённого доступа»)
  // ожидаемый шаг назад — сам раздел. Название области рядом остаётся ссылкой
  // на хаб, так что оба уровня доступны.
  const upHref =
    tool && !tool.isAreaHub && pathname !== tool.href ? tool.href : area?.href

  const densityOptions: { id: AdminDensity; icon: typeof PanelLeft; label: string }[] =
    [
      { id: "full", icon: PanelLeft, label: t.compact },
      { id: "simple", icon: PanelLeftClose, label: t.cozy },
    ]

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
      <span className="absolute inset-x-0 top-0 h-px bg-primary/40" />

      <div className="flex min-w-0 items-center gap-2">
        <AdminMobileSidebar email={email} fullName={fullName} />

        {/* Стрелка и название области — ссылки на хаб. Это единственный путь
            «наверх», когда колонка инструментов скрыта: в упрощённом виде до
            главной страницы раздела иначе не добраться вовсе. */}
        {area && !atAreaHome ? (
          <Link
            href={upHref ?? area.href}
            aria-label={t[area.labelKey] as string}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <ArrowLeft className="h-[19px] w-[19px]" />
          </Link>
        ) : AreaIcon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-primary/25 bg-primary/10 text-primary">
            <AreaIcon className="h-[18px] w-[18px]" />
          </span>
        ) : null}

        <nav
          aria-label={adminT.breadcrumb}
          className="flex min-w-0 items-center gap-2"
        >
          {area && !atAreaHome ? (
            <Link
              href={area.href}
              className="hidden truncate rounded-lg px-2 py-1 text-[15px] font-medium text-ws-3 hover:bg-foreground/5 hover:text-ws-1 sm:block md:text-[16px]"
            >
              {t[area.labelKey] as string}
            </Link>
          ) : (
            <span className="truncate text-[15px] font-semibold text-ws-1 md:text-[16px]">
              {area ? (t[area.labelKey] as string) : t.adminPanel}
            </span>
          )}
          {toolLabel && !atAreaHome ? (
            <>
              <span className="hidden text-[16px] text-ws-5 sm:inline">/</span>
              <span className="truncate text-[15px] font-semibold text-ws-1 md:text-[16px]">
                {toolLabel}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3 md:gap-4">
        {hasColumn ? (
          <div className="hidden shrink-0 gap-[3px] rounded-[9px] border border-foreground/10 bg-ws-control p-[3px] lg:flex">
            {densityOptions.map((option) => {
              const Icon = option.icon
              const active = density === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDensity(option.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-ws-select/35 text-ws-1"
                      : "text-ws-3 hover:text-ws-1",
                  )}
                >
                  <Icon className="h-[17px] w-[17px]" />
                  {option.label}
                </button>
              )
            })}
          </div>
        ) : null}

        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 text-[13.5px] text-ws-3 hover:text-ws-1 sm:flex"
        >
          {t.viewSite}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </header>
  )
}
