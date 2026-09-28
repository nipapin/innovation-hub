"use client"

import type { CSSProperties } from "react"

import type { AccentPair } from "@/lib/branding"
import { cn } from "@/lib/utils"

/**
 * Монограмма компании в её акцентном цвете — в переключателе рабочих мест и на
 * плашке расшаренного проекта (docs/MULTI_COMPANY_PROFILES_PLAN.md §2, §8.4).
 *
 * Акцент компании — пара значений, для светлой темы и для тёмной
 * (COMPANY_ACCOUNTS_PLAN.md §10): тема выбирается человеком, акцент — компанией.
 * Обе кладутся в переменные, а нужную выбирает `data-theme` страницы, как у
 * `accentCss` в lib/branding.ts. Сами значения — токены HSL без обёртки.
 */
export function CompanyMark({
  monogram,
  accent,
  className,
}: {
  monogram: string
  accent: AccentPair
  className?: string
}) {
  return (
    <span
      aria-hidden
      style={
        {
          "--mark-dark": `hsl(${accent.dark})`,
          "--mark-light": `hsl(${accent.light})`,
        } as CSSProperties
      }
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold leading-none",
        "border-[color:var(--mark-dark)] text-[color:var(--mark-dark)]",
        "[[data-theme=light]_&]:border-[color:var(--mark-light)] [[data-theme=light]_&]:text-[color:var(--mark-light)]",
        className,
      )}
    >
      {monogram}
    </span>
  )
}

/**
 * Плашка компании-владельца на карточке расшаренного проекта
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §8.4): монограмма и название в акцентном
 * цвете компании. Отвечает на вопрос «чья это работа и кто за неё платит» —
 * проект чужой компании виден из любого профиля человека.
 */
export function CompanyBadge({
  title,
  monogram,
  accent,
  tooltip,
}: {
  title: string
  monogram: string
  accent: AccentPair
  tooltip: string
}) {
  return (
    <span
      title={tooltip}
      style={
        {
          "--mark-dark": `hsl(${accent.dark})`,
          "--mark-light": `hsl(${accent.light})`,
        } as CSSProperties
      }
      className={cn(
        "flex min-w-0 max-w-[45%] shrink items-center gap-1 rounded-full border px-1.5 py-[1px] text-[11px] font-medium",
        "border-[color:var(--mark-dark)] text-[color:var(--mark-dark)]",
        "[[data-theme=light]_&]:border-[color:var(--mark-light)] [[data-theme=light]_&]:text-[color:var(--mark-light)]",
      )}
    >
      <span className="shrink-0 font-bold">{monogram}</span>
      <span className="truncate">{title}</span>
    </span>
  )
}
