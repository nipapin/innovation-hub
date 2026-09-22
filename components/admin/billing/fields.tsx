"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

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
import { readUiPref, writeUiPref } from "@/lib/ui-prefs"
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
  collapsible,
  defaultOpen = true,
  storageKey,
  actions,
  children,
}: {
  title: string
  description?: string
  /**
   * Кнопка этой секции. Ставится, когда секция сохраняется сама: одна кнопка
   * на всю страницу не говорит, ЧТО именно уедет, а у «Тестового периода» цена
   * ошибки разная — сумма подарка меняет будущие выдачи, а состав набора
   * возвращает кнопку всем, кто период уже проходил.
   */
  actions?: React.ReactNode
  /**
   * Статья про эту секцию. Ставится, только когда статья у секции своя:
   * кнопка на ту же статью, что открывает заголовок страницы, обещает
   * подробности, которых нет (docs/HELP_SYSTEM.md §7).
   */
  help?: HelpTopicId
  /**
   * Складывать по клику на заголовок. По умолчанию нет: у формы прятать нечего,
   * а вот таблица, ради которой не приходили, занимает экран целиком.
   */
  collapsible?: boolean
  defaultOpen?: boolean
  /**
   * Имя куки (`lib/ui-prefs.ts`): свёртка запоминается между заходами. Ставится
   * секциям, которые сворачивают надолго («пульт» на странице конвейера), а не
   * на один взгляд. Реестр таких ключей — docs/UI_PREFS.md.
   *
   * ВАЖНО: только секциям, которых нет в серверном кадре. `readUiPref` читает
   * `document.cookie`, а на сервере его нет — секция, отрисованная сервером,
   * приедет развёрнутой, а при гидратации схлопнется, и React пожалуется на
   * расхождение. «Пульт» подходит: его страница до ответа API рисует `null`.
   */
  storageKey?: string
  children: React.ReactNode
}) {
  // Читается один раз, ленивым инициализатором: эффектом свёрнутая секция
  // успела бы моргнуть развёрнутой.
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen
    const stored = readUiPref(storageKey)
    return stored === null ? defaultOpen : stored === "1"
  })
  const shown = !collapsible || open

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev
      if (storageKey) writeUiPref(storageKey, next ? "1" : "0")
      return next
    })
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold">
          {/* Кнопка прижата вправо той же строкой, что и заголовок: она
              относится к секции целиком, и снизу её пришлось бы искать под
              таблицей произвольной длины. */}
          {actions ? (
            <span className="order-last ml-auto flex shrink-0 items-center gap-2">
              {actions}
            </span>
          ) : null}
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              aria-expanded={open}
              className="-ml-1 flex items-center gap-2 rounded px-1 text-left transition-colors hover:text-foreground/80"
            >
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {title}
            </button>
          ) : (
            title
          )}
          {help ? <HelpSectionButton id={help} /> : null}
        </CardTitle>
        {/* Свёрнутая секция — одна строка: описание под скрытой таблицей
            объясняет то, чего на экране уже нет. */}
        {description && shown ? (
          <CardDescription className="max-w-3xl text-sm leading-relaxed">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {shown ? (
        <CardContent className="space-y-4">{children}</CardContent>
      ) : null}
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
