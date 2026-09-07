"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleHelp, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ExposedOptionChange } from "@/lib/options/apply"
import type { ExposedOption, ExposedOptionValue } from "@/lib/options/types"
import { cn } from "@/lib/utils"
import { formatOptionValue, OPTION_CONTROLS } from "./option-controls"
import { socialControlFor } from "./social-controls"

/**
 * Параметры обработки, которые автор графа открыл клиенту (`exposedToSite`).
 *
 * Плоский список: имя, подсказка автора и сам контрол. Ни нод, ни связей, ни
 * группировки по ним — клиенту важна «длительность ролика», а не то, в какой
 * ноде она лежит. Значение уходит в `controlProps.value` того же
 * `options.json`, который потом читает обработка, поэтому изменённое здесь
 * идёт в работу как есть — см. docs/PROJECT_OPTIONS_PANEL.md.
 */

type Props = {
  options: ExposedOption[]
  /**
   * Отправка правок. Возвращает свежий список (сервер мог зажать число в
   * границы) либо кидает ошибку с текстом для тоста. `null` — правки отсюда
   * не предусмотрены вовсе: показываем только значения.
   */
  onSave: ((changes: ExposedOptionChange[]) => Promise<ExposedOption[]>) | null
  className?: string
}

function optionKey(option: ExposedOption): string {
  return option.path.join(".")
}

function buildDraft(
  options: ExposedOption[],
): Record<string, ExposedOptionValue> {
  const draft: Record<string, ExposedOptionValue> = {}
  for (const option of options) draft[optionKey(option)] = option.value
  return draft
}

/** Значения бывают массивами, поэтому сравниваем по сериализации. */
function isDirty(option: ExposedOption, draft: ExposedOptionValue | undefined) {
  if (draft === undefined) return false
  return JSON.stringify(draft) !== JSON.stringify(option.value)
}

export function ExposedOptionsList({ options, onSave, className }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Record<string, ExposedOptionValue>>(() =>
    buildDraft(options),
  )
  const [saving, setSaving] = useState(false)

  // Список приходит заново после сохранения и при смене проекта — черновик
  // всегда начинается с того, что реально лежит в файле.
  useEffect(() => setDraft(buildDraft(options)), [options])

  const dirty = useMemo(
    () => options.filter((o) => o.editable && isDirty(o, draft[optionKey(o)])),
    [options, draft],
  )

  /**
   * Значения по нодам: `нода → { id свойства → значение }`.
   *
   * Единственное место, где плоский список всё-таки помнит про ноды, и это не
   * отступление от «никаких нод клиенту» (docs/PROJECT_OPTIONS_PANEL.md §1):
   * ноды не показываются, но список сообществ имеет смысл только для аккаунта,
   * выбранного в ТОЙ ЖЕ ноде. Считаем из черновика, а не из сохранённого:
   * сменив аккаунт, человек ждёт, что список целей обновится сразу, а не после
   * сохранения.
   */
  const siblings = useMemo(() => {
    const map: Record<string, Record<string, ExposedOptionValue>> = {}
    for (const option of options) {
      const group = (map[option.siblingKey] ??= {})
      group[option.key] = draft[optionKey(option)] ?? option.value
    }
    return map
  }, [options, draft])

  if (options.length === 0) return null

  const save = async () => {
    if (!onSave || dirty.length === 0) return
    setSaving(true)
    try {
      const next = await onSave(
        dirty.map((option) => ({
          path: option.path,
          value: draft[optionKey(option)]!,
        })),
      )
      setDraft(buildDraft(next))
      toast.success(t.optionsSaved)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t.optionsSaveFailed,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <section className={cn("space-y-3", className)}>
        <p className="text-[11px] font-semibold tracking-[1.4px] text-ws-accent">
          {t.optionsHeading}
        </p>

        <ul className="divide-y divide-white/[0.07]">
          {options.map((option) => {
            const key = optionKey(option)
            // Аккаунт площадки и цель публикации рисуются своим контролом,
            // хотя в графе это обычный `ddm`: варианты у них не из графа, а из
            // сейфа аккаунтов, и цель вдобавок зависит от соседнего свойства.
            const SocialControl = socialControlFor(option)
            const Control = OPTION_CONTROLS[option.control]
            // Чекбокс встаёт в одну строку с именем — как в ноде; остальным
            // контролам нужна своя строка под именем.
            const inline = option.control === "checkbox"

            const change = (value: ExposedOptionValue) =>
              setDraft((prev) => ({ ...prev, [key]: value }))

            const control = !option.editable ? (
              // Список вариантов знает только программа: там папки на машине и
              // её словари. Значение показываем — оно у параметра есть, и
              // видеть его полезно, — а правится оно там же, где настраивается.
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-ws-2">
                  {formatOptionValue(option, option.value, t.optionsEmptyValue)}
                </span>
                <span className="shrink-0 text-[11px] text-ws-4">
                  {t.optionsLocked}
                </span>
              </div>
            ) : SocialControl ? (
              <SocialControl
                option={option}
                value={draft[key] ?? option.value}
                disabled={saving || !onSave}
                onChange={change}
                siblings={siblings[option.siblingKey] ?? {}}
              />
            ) : (
              <Control
                option={option}
                value={draft[key] ?? option.value}
                disabled={saving || !onSave}
                onChange={change}
              />
            )

            return (
              <li key={key} className="py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ws-1">
                    {option.label}
                  </span>
                  {inline ? <div className="shrink-0">{control}</div> : null}
                  {option.tooltip ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={option.label}
                          className="shrink-0 text-ws-4 transition-colors hover:text-ws-2"
                        >
                          <CircleHelp className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        align="end"
                        className="max-w-[320px] whitespace-pre-line text-[13px] leading-relaxed"
                      >
                        {option.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>

                {inline ? null : <div className="mt-2">{control}</div>}
              </li>
            )
          })}
        </ul>

        {onSave ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={saving || dirty.length === 0}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t.optionsSave}
            </Button>
          </div>
        ) : null}
      </section>
    </TooltipProvider>
  )
}
