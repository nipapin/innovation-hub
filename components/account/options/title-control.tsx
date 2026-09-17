"use client"

import { useEffect, useMemo, useState } from "react"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { missingCharacters } from "@/lib/fonts/coverage"
import { loadFont } from "@/lib/fonts/face-loader"
import {
  mergeTitleValue,
  parseTitleValue,
  sizeForFormat,
  TITLE_BOXES,
  TITLE_COLORS,
  TITLE_FORMATS,
  TITLE_FRAME,
  TITLE_LIMITS,
  TITLE_POSITIONS,
  TITLE_SAMPLE_TEXT,
  TITLE_SHADOWS,
  TITLE_SYSTEM_FONTS,
  type TitleBoxPreset,
  type TitleFormat,
  type TitlePosition,
  type TitleShadowPreset,
  type TitleValue,
} from "@/lib/options/title"
import { cn } from "@/lib/utils"
import { FontPicker, useFontSources } from "./font-picker"
import { FieldGroup, SliderField } from "./modal-fields"

/**
 * Титры — docs/TITLE_CONTROL_PLAN.md.
 *
 * Из ста с лишним полей клиенту открыто девять. Разделение простое: одно число —
 * ползунок, несколько связанных — заготовка. Заготовка при этом не режим: она
 * просто записывает набор значений, и в сохранённом виде её имени нет.
 *
 * ПРЕВЬЮ ПРИБЛИЗИТЕЛЬНОЕ, и это написано на экране. Программа рендерит ASS через
 * libass, браузер умеет только CSS-текст: начертание, цвет, обводка, плашка и
 * положение совпадут, переносы строк и межбуквенные интервалы могут разойтись.
 */

const STAGE_MAX = 300

/** hex + прозрачность → rgba(): плашка задаётся двумя полями, как в программе. */
function rgba(hex: string, opacity: number): string {
  const v = hex.replace("#", "")
  const r = Number.parseInt(v.slice(0, 2), 16) || 0
  const g = Number.parseInt(v.slice(2, 4), 16) || 0
  const b = Number.parseInt(v.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function Stage({
  value,
  format,
  sample,
  onEditSample,
}: {
  value: TitleValue
  format: TitleFormat
  sample: string
  onEditSample: () => void
}) {
  const { width, height } = TITLE_FRAME[format]
  const scale = STAGE_MAX / Math.max(width, height)
  const place = TITLE_POSITIONS[value.position]
  const shadow = TITLE_SHADOWS[value.shadow]
  const box = TITLE_BOXES[value.box]
  const size = sizeForFormat(value.size, format) * scale

  /**
   * Обводка — через `paint-order`, а не через четыре тени: так браузер рисует
   * контур ПОД глифом, и он не съедает тонкие штрихи, как это делает набор
   * смещённых копий. Ближе всего к тому, что делает libass.
   */
  const textStyle: React.CSSProperties = {
    fontFamily: `"${value.font}", sans-serif`,
    fontSize: size,
    lineHeight: 1.2,
    color: value.color,
    WebkitTextStrokeWidth: value.outlineWidth > 0 ? value.outlineWidth * scale : undefined,
    WebkitTextStrokeColor: value.outlineWidth > 0 ? value.outlineColor : undefined,
    paintOrder: "stroke fill",
    textShadow: shadow.enabled
      ? `${shadow.offsetX * scale}px ${shadow.offsetY * scale}px ${
          shadow.blur * scale
        }px ${shadow.color}`
      : undefined,
  }

  return (
    <div
      style={{ width: STAGE_MAX, height: STAGE_MAX }}
      className="flex shrink-0 items-center justify-center"
    >
      <div
        style={{ width: width * scale, height: height * scale }}
        className="relative overflow-hidden rounded-lg border border-border/60 bg-neutral-800"
      >
        <div
          className={cn(
            "absolute inset-x-0 flex px-[6%]",
            place.vAlign === "top"
              ? "top-[10%] items-start"
              : place.vAlign === "middle"
                ? "top-1/2 -translate-y-1/2 items-center"
                : "bottom-[10%] items-end",
          )}
        >
          <span
            onDoubleClick={onEditSample}
            style={{
              ...textStyle,
              backgroundColor: box.enabled
                ? rgba(box.color, box.opacity)
                : undefined,
              padding: box.enabled
                ? `${box.paddingY * scale}px ${box.paddingX * scale}px`
                : undefined,
              borderRadius: box.enabled ? box.borderRadius * scale : undefined,
            }}
            className="mx-auto cursor-text select-none text-center"
          >
            {sample}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Ряд одинаковых кнопок-вариантов: положение, тень, плашка. */
function ChoiceRow<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: readonly T[]
  value: T
  labels: Record<T, string>
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((item) => (
        <Button
          key={item}
          type="button"
          size="sm"
          variant={item === value ? "default" : "outline"}
          onClick={() => onChange(item)}
          className="text-[12px] font-normal"
        >
          {labels[item]}
        </Button>
      ))}
    </div>
  )
}

export function TitleControl({
  value,
  disabled,
  projectId,
  onChange,
}: {
  value: string
  disabled: boolean
  projectId: string
  onChange: (next: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<TitleFormat>("landscape")
  const [draft, setDraft] = useState<TitleValue>(() => parseTitleValue(value))
  /** Текст образца НЕ сохраняется: настоящие слова придут из входа ноды. */
  const [sample, setSample] = useState(TITLE_SAMPLE_TEXT)

  const sources = useFontSources(projectId, open)
  const [covered, setCovered] = useState<Set<number> | null>(null)
  const [fontState, setFontState] = useState<"none" | "loading" | "ready" | "failed">(
    "none",
  )

  useEffect(() => {
    if (open) setDraft(parseTitleValue(value))
  }, [open, value])

  /**
   * Образец рисуется НАСТОЯЩИМ файлом — тем, который поедет на машину
   * (docs/FONTS_PLAN.md §6). Из тех же байтов приходит покрытие: без него
   * браузер молча подставил бы системный шрифт, и образец с иероглифами
   * выглядел бы правильным там, где libass нарисует пустые квадраты.
   */
  useEffect(() => {
    if (!open) return
    const family = draft.font
    const url = sources.resolveUrl(family)
    if (!url) {
      // Системный шрифт: файла у нас нет, браузер рисует своим. Покрытие
      // неизвестно, и молчать тут честнее, чем гадать.
      setCovered(null)
      setFontState("none")
      return
    }

    let alive = true
    setFontState("loading")
    loadFont(family, url)
      .then((font) => {
        if (!alive) return
        setCovered(font.covered)
        setFontState("ready")
      })
      .catch(() => {
        if (!alive) return
        setCovered(null)
        setFontState("failed")
      })
    return () => {
      alive = false
    }
  }, [open, draft.font, sources])

  const missing = useMemo(
    () => (covered ? missingCharacters(covered, sample) : []),
    [covered, sample],
  )

  /** Системный шрифт из старых настроек — и чем его заменить (§5 плана). */
  const legacy = TITLE_SYSTEM_FONTS.some((name) => name === draft.font)
  const replacement = legacy
    ? (sources.library.find((font) => font.replaces === draft.font) ?? null)
    : null

  const summary = useMemo(() => {
    const parsed = parseTitleValue(value)
    return `${parsed.font} ${parsed.size} · ${t[
      parsed.position === "top"
        ? "titlePosTop"
        : parsed.position === "middle"
          ? "titlePosMiddle"
          : "titlePosBottom"
    ]}`
  }, [value, t])

  const set = (patch: Partial<TitleValue>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ws-4">
        {summary}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-8 shrink-0 text-[13px] font-normal"
      >
        {t.titleConfigure}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t.titleTitle}</DialogTitle>
            <DialogDescription>{t.titleHint}</DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5">
            {TITLE_FORMATS.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === format ? "default" : "outline"}
                onClick={() => setFormat(item)}
                className="text-[13px] font-normal"
              >
                {t[
                  item === "landscape"
                    ? "titleLandscape"
                    : item === "portrait"
                      ? "titlePortrait"
                      : "titleSquare"
                ]}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="shrink-0 space-y-2">
              <Stage
                value={draft}
                format={format}
                sample={sample}
                onEditSample={() => {
                  const next = window.prompt(t.titleSamplePrompt, sample)
                  if (next !== null) setSample(next || TITLE_SAMPLE_TEXT)
                }}
              />
              {/* Каких символов в шрифте нет — под самим образцом, где их и
                  недосчитались. Это не предупреждение «на всякий случай»:
                  ответ прочитан из таблицы `cmap` того же файла. */}
              {missing.length > 0 ? (
                <p className="max-w-[300px] text-[11px] leading-snug text-destructive">
                  {t.fontMissing}{" "}
                  <span className="font-medium">
                    {missing.slice(0, 12).join(" ")}
                    {missing.length > 12 ? " …" : ""}
                  </span>
                </p>
              ) : null}
              {fontState === "loading" ? (
                <p className="max-w-[300px] text-[11px] leading-snug text-muted-foreground">
                  {t.fontLoading}
                </p>
              ) : null}
              {fontState === "failed" ? (
                <p className="max-w-[300px] text-[11px] leading-snug text-destructive">
                  {t.fontFailed}
                </p>
              ) : null}
              {/* Честно про приближение — на экране, а не в подсказке. */}
              <p className="max-w-[300px] text-[11px] leading-snug text-muted-foreground">
                {t.titleApproximate}
              </p>
            </div>

            <div className="min-w-0 flex-1 space-y-5">
              <FieldGroup title={t.titleText}>
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {t.titleFont}
                  </Label>
                  <FontPicker
                    sources={sources}
                    value={draft.font}
                    onChange={(choice) => set({ font: choice.family })}
                  />
                  {/* Системный шрифт файла в проект не кладёт: раздавать Arial
                      мы не вправе, и на машине без него прогон остановится. */}
                  {legacy ? (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t.fontLegacy}
                      {replacement ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => set({ font: replacement.family })}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {t.fontReplaceWith} {replacement.family}
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {t.titleColor}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    {TITLE_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color}
                        onClick={() => set({ color })}
                        style={{ backgroundColor: color }}
                        className={cn(
                          "h-6 w-6 rounded-full border",
                          color === draft.color
                            ? "border-primary ring-2 ring-primary/40"
                            : "border-border/60",
                        )}
                      />
                    ))}
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(event) => set({ color: event.target.value })}
                      className="h-6 w-8 cursor-pointer rounded border border-border/60 bg-transparent"
                    />
                  </div>
                </div>

                <SliderField
                  label={t.titleSize}
                  value={draft.size}
                  min={TITLE_LIMITS.size.min}
                  max={TITLE_LIMITS.size.max}
                  step={TITLE_LIMITS.size.step}
                  onChange={(size) => set({ size })}
                />

                <div className="space-y-1.5">
                  <SliderField
                    label={t.titleOutline}
                    value={draft.outlineWidth}
                    min={TITLE_LIMITS.outline.min}
                    max={TITLE_LIMITS.outline.max}
                    step={TITLE_LIMITS.outline.step}
                    onChange={(outlineWidth) => set({ outlineWidth })}
                  />
                  {/* Цвет обводки рядом с её толщиной, а не отдельной группой:
                      нулевая толщина отключает и то и другое. */}
                  {draft.outlineWidth > 0 ? (
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[12px] text-muted-foreground">
                        {t.titleOutlineColor}
                      </Label>
                      <input
                        type="color"
                        value={draft.outlineColor}
                        onChange={(event) =>
                          set({ outlineColor: event.target.value })
                        }
                        className="h-6 w-8 cursor-pointer rounded border border-border/60 bg-transparent"
                      />
                    </div>
                  ) : null}
                </div>
              </FieldGroup>

              <FieldGroup title={t.titlePosition}>
                <ChoiceRow<TitlePosition>
                  options={["top", "middle", "bottom"]}
                  value={draft.position}
                  labels={{
                    top: t.titlePosTop,
                    middle: t.titlePosMiddle,
                    bottom: t.titlePosBottom,
                  }}
                  onChange={(position) => set({ position })}
                />
              </FieldGroup>

              <FieldGroup title={t.titleShadow}>
                <ChoiceRow<TitleShadowPreset>
                  options={["none", "soft", "hard", "glow", "lift"]}
                  value={draft.shadow}
                  labels={{
                    none: t.titleNone,
                    soft: t.titleShadowSoft,
                    hard: t.titleShadowHard,
                    glow: t.titleShadowGlow,
                    lift: t.titleShadowLift,
                  }}
                  onChange={(shadow) => set({ shadow })}
                />
              </FieldGroup>

              <FieldGroup title={t.titleBox}>
                <ChoiceRow<TitleBoxPreset>
                  options={["none", "translucent", "solid", "rounded"]}
                  value={draft.box}
                  labels={{
                    none: t.titleNone,
                    translucent: t.titleBoxTranslucent,
                    solid: t.titleBoxSolid,
                    rounded: t.titleBoxRounded,
                  }}
                  onChange={(box) => set({ box })}
                />
              </FieldGroup>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.titleCancel}
            </Button>
            <Button
              onClick={() => {
                // В форме графа, как и у смены формата: сервер сольёт ещё раз.
                onChange(mergeTitleValue(value, draft))
                setOpen(false)
              }}
            >
              {t.titleApply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
