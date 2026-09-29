"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FolderOpen, Workflow, type LucideIcon } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { useProductionAvailable } from "./availability"

/**
 * «Проекты | Производство» — переключатель рабочего места в верхней панели
 * (docs/PRODUCTION_PLAN.md §9.1, эскиз владельца продукта).
 *
 * Ссылки, а не состояние: это два разных маршрута, и адрес в строке браузера
 * должен говорить, где человек, — чтобы работали «назад» и ссылка в чат.
 *
 * Только с `lg`, как переключатель режима рядом: ниже раскладка мобильная, и
 * вход в раздел там — пункт бокового меню. Раздел недоступен — переключателя
 * нет вовсе: одна кнопка «Проекты» ничего бы не переключала.
 */
export function WorkplaceModeSwitch({ className }: { className?: string }) {
  const { t } = useI18n()
  const pathname = usePathname()
  const available = useProductionAvailable()
  if (!available) return null

  const inProduction = pathname.startsWith("/account/production")
  const options: { href: string; active: boolean; icon: LucideIcon; label: string }[] = [
    { href: "/account/projects", active: !inProduction, icon: FolderOpen, label: t.projects },
    { href: "/account/production", active: inProduction, icon: Workflow, label: t.productionNav },
  ]

  return (
    <div
      className={cn(
        "hidden shrink-0 gap-[3px] rounded-[9px] border border-foreground/10 bg-ws-control p-[3px] lg:flex",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        return (
          <Link
            key={option.href}
            href={option.href}
            aria-current={option.active ? "page" : undefined}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] transition-colors",
              option.active ? "bg-ws-select/35 text-ws-1" : "text-ws-3 hover:text-ws-1",
            )}
          >
            <Icon className="h-[17px] w-[17px]" />
            {option.label}
          </Link>
        )
      })}
    </div>
  )
}
