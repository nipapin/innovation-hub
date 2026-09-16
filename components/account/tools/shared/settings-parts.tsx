"use client"

import { useEffect, useState } from "react"
import { Folder } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { cn } from "@/lib/utils"
import { keyLabel } from "./editor-state"
import { projectRules, type ProjectRule } from "./project-rules"
import { useTools, type ToolInstance } from "../tools-context"

/**
 * Части окна настроек, общие для инструментов раздела.
 *
 * Здесь то, что не знает про титры и озвучку: элементы формы, строка
 * переназначения клавиши и список проектов с правилами чтения папки. Список
 * проектов общий не «похож», а буквально один и тот же: он работает с
 * `user_tools.settings` экземпляра, а не с содержимым документа.
 *
 * Своё у каждого инструмента — набор строк и порядок разделов; он остаётся в
 * его собственном окне.
 */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
      {children}
    </h3>
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = "px",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Подпись справа от ползунка. Пустая строка — без подписи. */
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="grid grid-cols-[220px_1fr_62px] items-center gap-3">
      <span className="text-[13px] text-ws-2">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 accent-ws-action"
      />
      <span className="text-right font-mono text-[12px] tabular-nums text-ws-3">
        {value}
        {unit}
      </span>
    </div>
  )
}

/** Переключатель 34×20 — как в дизайне; `ui/switch` крупнее и ломает сетку. */
export function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean
  disabled?: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-5 w-[34px] flex-none items-center rounded-full p-[2px] justify-self-start",
        on ? "bg-ws-action" : "bg-foreground/[0.14]",
        disabled && "cursor-default opacity-40",
      )}
    >
      <span
        className="h-4 w-4 rounded-full bg-white transition-transform duration-150"
        style={{ transform: `translateX(${on ? 14 : 0}px)` }}
      />
    </button>
  )
}

export function NativeSelect({
  value,
  disabled,
  onChange,
  options,
  className,
}: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-[30px] w-full rounded border border-foreground/[0.10] bg-ws-well px-2 text-[12px] text-ws-2 outline-none focus:border-ws-action disabled:cursor-default disabled:opacity-40",
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-ws-panel">
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Одна строка переназначения: кнопка ловит следующее нажатие.
 *
 * Запоминается код физической кнопки, поэтому назначенная на русской раскладке
 * клавиша работает и на английской — это та же кнопка.
 */
export function HotkeyRow({
  label,
  code,
  taken,
  onChange,
}: {
  label: string
  code: string
  taken: string[]
  onChange: (code: string) => void
}) {
  const { t } = useWorkspace()
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setCapturing(false)
      if (event.code === "Escape") return
      // Занятая клавиша молча перебила бы чужое действие — не берём.
      if (taken.includes(event.code)) return
      onChange(event.code)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [capturing, onChange, taken])

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] text-ws-2">{label}</span>
      <button
        type="button"
        onClick={() => setCapturing((current) => !current)}
        className={cn(
          "h-7 min-w-[92px] shrink-0 rounded border px-2 font-mono text-[12px]",
          capturing
            ? "border-ws-action bg-ws-action/15 text-ws-1"
            : "border-foreground/[0.10] bg-ws-well text-ws-2 hover:border-foreground/25",
        )}
      >
        {capturing ? t.srtKeyCapture : keyLabel(code)}
      </button>
    </div>
  )
}

/**
 * Клавиши инструмента: строка на действие и сброс к умолчанию.
 *
 * Порядок и названия действий приходят от инструмента — они у титров и озвучки
 * разные, — а всё остальное общее.
 */
export function HotkeySection<A extends string>({
  actions,
  labels,
  keymap,
  onChange,
  onReset,
}: {
  actions: A[]
  labels: Record<A, string>
  keymap: Record<A, string>
  onChange: (keymap: Record<A, string>) => void
  onReset: () => void
}) {
  const { t } = useWorkspace()

  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle>{t.srtHotkeys}</SectionTitle>
      <p className="text-pretty text-[12px] leading-relaxed text-ws-3">{t.srtHotkeysHint}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {actions.map((action) => (
          <HotkeyRow
            key={action}
            label={labels[action]}
            code={keymap[action]}
            taken={actions.filter((item) => item !== action).map((item) => keymap[item])}
            onChange={(code) => onChange({ ...keymap, [action]: code })}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="self-start text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline"
      >
        {t.srtKeyReset}
      </button>
    </section>
  )
}

/**
 * Проекты инструмента и правила чтения папки.
 *
 * Ничего своего у инструментов здесь нет: и титры, и озвучка берут папку задачи
 * одинаково, а настройка уходит в `user_tools.settings` экземпляра, чтобы
 * работать с любой машины (§9).
 */
export function ProjectRulesSection({ tool }: { tool: ToolInstance }) {
  const { t, projects } = useWorkspace()
  const { patchSettings } = useTools()

  const hidden = new Set(
    Array.isArray(tool.settings?.hiddenProjectIds)
      ? (tool.settings.hiddenProjectIds as string[])
      : [],
  )
  const rules = projectRules(tool)

  /**
   * Что показываем в списке: всё, кроме корзины.
   *
   * Пауза и архив тоже здесь — их надо видеть, иначе непонятно, почему проекта
   * нет в выпадающем списке. Доступные идут первыми, остальные ниже: в них
   * работать всё равно нельзя, и место наверху они занимали бы зря.
   */
  const listed = projects
    .filter((project) => !project.deletedAt)
    .slice()
    .sort((a, b) => {
      const rank = (p: typeof a) => (p.isArchived ? 2 : p.isPaused ? 1 : 0)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })

  const setHidden = (projectId: string, isHidden: boolean) => {
    const next = new Set(hidden)
    if (isHidden) next.add(projectId)
    else next.delete(projectId)
    void patchSettings(tool.id, { hiddenProjectIds: [...next] })
  }

  const setRule = (projectId: string, patch: { rule?: ProjectRule }) => {
    void patchSettings(tool.id, {
      projectRules: {
        ...rules.all,
        [projectId]: { ...rules.for(projectId), ...patch },
      },
    })
  }

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <SectionTitle>{t.srtSetProjects}</SectionTitle>
        <span className="text-[12px] text-ws-5">
          {tf(t.srtSetHidden, { count: hidden.size })} ·{" "}
          {tf(t.srtProjectsSeen, { count: listed.length })}
        </span>
      </div>
      <p className="text-pretty text-[12px] leading-relaxed text-ws-3">{t.srtSetProjectsHint}</p>
      <div className="grid grid-cols-[1fr_190px_130px] gap-3 pt-1 text-[11px] uppercase tracking-[0.32px] text-ws-4">
        <span>{t.srtColProject}</span>
        <span>{t.srtColRule}</span>
        <span>{t.srtColSort}</span>
      </div>
      {listed.map((project) => {
        const isHidden = hidden.has(project.id)
        const rule = rules.for(project.id)
        // Пауза и архив недоступны инструменту по определению (§6): в них не
        // идёт обработка, брать оттуда папку нечего. Строку показываем, чтобы
        // было видно причину, но управлять ею нельзя — иначе включённый
        // переключатель обещал бы то, чего не будет.
        const unavailable = project.isPaused || project.isArchived
        return (
          <div
            key={project.id}
            className="grid grid-cols-[1fr_260px] items-center gap-3 border-t border-foreground/[0.06] py-2"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Toggle
                on={!isHidden && !unavailable}
                disabled={unavailable}
                onClick={() => setHidden(project.id, !isHidden)}
                label={project.name}
              />
              <Folder className="h-[18px] w-[18px] shrink-0 text-ws-4" />
              <span
                className={cn(
                  "truncate text-[13px]",
                  unavailable ? "text-ws-5" : isHidden ? "text-ws-4" : "text-ws-1",
                )}
              >
                {project.name}
              </span>
              {project.sharedWithMe ? (
                <span className="shrink-0 text-[12px] text-ws-5">{t.groupShared}</span>
              ) : null}
              {/*
                Пауза и архив отсекаются в выпадающем списке всегда, и без
                пометки строка выглядела бы включённой, а проекта в списке всё
                равно не было бы.
              */}
              {project.isArchived ? (
                <span className="shrink-0 text-[12px] text-ws-5">{t.srtProjectArchived}</span>
              ) : project.isPaused ? (
                <span className="shrink-0 text-[12px] text-ws-5">{t.srtProjectPaused}</span>
              ) : null}
            </div>
            <NativeSelect
              value={rule.rule}
              disabled={unavailable}
              onChange={(value) => setRule(project.id, { rule: value as ProjectRule })}
              options={[
                { value: "folders", label: t.srtRuleFolders },
                { value: "folders2", label: t.srtRuleFolders2 },
                { value: "auto", label: t.srtRuleAuto },
                { value: "srt", label: t.srtRuleSrt },
                { value: "flat", label: t.srtRuleFlat },
              ]}
            />
          </div>
        )
      })}
    </section>
  )
}
