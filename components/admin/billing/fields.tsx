"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { HelpSectionButton } from "@/components/help/help-section-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { HelpTopicId } from "@/lib/help/topics"
import { cn } from "@/lib/utils"

/**
 * Общие поля инструментов биллинга.
 *
 * Вынесены сюда, потому что «Тарифы», «Тестовый период» и «Акции» — три разных
 * инструмента с тремя разными тегами, но одной вёрсткой формы. Копия на каждый
 * разъехалась бы на первой же правке отступа.
 */

export function Section({
  title,
  description,
  help,
  children,
}: {
  title: string
  description?: string
  /**
   * Статья про эту секцию. Ставится, только когда статья у секции своя:
   * кнопка на ту же статью, что открывает заголовок страницы, обещает
   * подробности, которых нет (docs/HELP_SYSTEM.md §7).
   */
  help?: HelpTopicId
  children: React.ReactNode
}) {
  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold">
          {title}
          {help ? <HelpSectionButton id={help} /> : null}
        </CardTitle>
        {description ? (
          <CardDescription className="max-w-3xl text-sm leading-relaxed">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  className,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        // В формах области «Деньги» рядом живёт поле `type="password"` — ключ
        // вендора. Браузер по нему принимает всю форму за форму входа и
        // заполняет соседей: в «Дневной потолок расхода» так приезжала почта.
        // Потолок — страховка от утёкшего ключа, и мусор в нём не косметика.
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-xs"
      />
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

/** Копейки → строка в рублях для поля ввода. Пусто — значение не задано. */
export function centsToRubles(cents: number | undefined): string {
  if (cents == null) return ""
  return String(cents / 100)
}

/** Обратно. `null` — поле пустое либо не число: это НЕ ноль. */
export function rublesToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".")
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}
