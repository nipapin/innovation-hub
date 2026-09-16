"use client"

import { useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import {
  THEME_CHOICES,
  THEME_COOKIE,
  isThemeChoice,
  type ThemeChoice,
} from "@/lib/theme"
import { cn } from "@/lib/utils"

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const

/**
 * Переключатель темы — docs/THEMING_PLAN.md §5.
 *
 * Выбор пишется в куку, а не в `localStorage`: корневой layout — серверный
 * компонент, он читает куку и проставляет `data-theme` прямо в разметку, поэтому
 * первый кадр приходит уже правильным. `localStorage` читается только после
 * гидратации, и светлой теме предшествовала бы тёмная вспышка на каждой загрузке.
 *
 * Кука ставится здесь же, `document.cookie`, без похода на сервер: тема — это
 * оформление, а не данные аккаунта, и round-trip ради неё задержал бы отклик на
 * действие, которое обязано быть мгновенным. Один и тот же человек на двух
 * машинах волен смотреть по-разному.
 */
export function ThemeSwitch({ collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n()
  const [choice, setChoice] = useState<ThemeChoice>("system")

  // Начальное значение читается после монтирования: на сервере куки этого
  // браузера нет, и отрисовать подсветку заранее нечем.
  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )theme=([^;]*)/)
    const raw = match ? decodeURIComponent(match[1]) : null
    if (isThemeChoice(raw)) setChoice(raw)
  }, [])

  const apply = (next: ThemeChoice) => {
    setChoice(next)
    document.cookie = `theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`

    const resolved =
      next === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : next
    document.documentElement.setAttribute("data-theme", resolved)
  }

  const label: Record<ThemeChoice, string> = {
    system: t.themeSystem,
    light: t.themeLight,
    dark: t.themeDark,
  }

  return (
    <div
      className={cn(
        "flex gap-1 rounded-[9px] border border-foreground/10 bg-surface-1 p-[3px]",
        collapsed ? "flex-col" : "flex-row",
      )}
      role="group"
      aria-label={t.themeTitle}
    >
      {THEME_CHOICES.map((value) => {
        const Icon = ICONS[value]
        return (
          <button
            key={value}
            type="button"
            title={label[value]}
            aria-label={label[value]}
            aria-pressed={choice === value}
            onClick={() => apply(value)}
            className={cn(
              "flex items-center justify-center rounded-md",
              collapsed ? "h-7 w-full" : "h-7 flex-1",
              choice === value
                ? "bg-primary/30 text-foreground"
                : "bg-transparent text-muted-foreground/90 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}
