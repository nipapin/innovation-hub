"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
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
import { Switch } from "@/components/ui/switch"
import { FieldGroup, SliderField } from "./modal-fields"
import {
  buildBgFilter,
  mergeVideoAdjustValue,
  oppositeFormat,
  parseVideoAdjustValue,
  sampleAspect,
  VIDEO_ADJUST_LIMITS,
  type FrameOrientation,
  type VideoAdjustValue,
} from "@/lib/options/video-adjust"
import { cn } from "@/lib/utils"

/**
 * Смена формата кадра — docs/VIDEO_ADJUST_CONTROL_PLAN.md.
 *
 * Вертикальный ролик из горизонтального: кадр вписывается в новый формат, а
 * пустое место занимает тот же ролик, размытый и подкрашенный.
 *
 * Клиенту открыто шесть ручек и свёрнутый блок тени — из двадцати с лишним
 * (§2). Формат всегда автоматический: он и есть смысл ноды, а не выбор клиента.
 *
 * Превью — ОБРАЗЕЦ, а не кадр ролика: кадра у сайта нет. Зато вид фона в
 * программе задаётся строкой CSS-фильтра (`buildCanvasFilter`), и браузер
 * показывает его ровно так же — размытие и цветокор здесь не «похожие», а те же.
 */

/** Наибольшая сторона превью на экране. */
const STAGE_MAX = 300

/**
 * Образец вместо кадра: цветные плашки, переход и мелкая деталь.
 *
 * Рисуется, а не хранится файлом — ни веса, ни вопросов о правах. Набор выбран
 * так, чтобы каждая ручка была видна: размытие съедает полоски, насыщенность —
 * цвет плашек, контраст — переход.
 */
function SampleArt() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-sky-500 via-fuchsia-500 to-amber-400" />
      <div className="absolute inset-x-0 top-1/3 flex h-1/3">
        <span className="h-full flex-1 bg-red-500" />
        <span className="h-full flex-1 bg-green-500" />
        <span className="h-full flex-1 bg-blue-600" />
        <span className="h-full flex-1 bg-white" />
        <span className="h-full flex-1 bg-black" />
      </div>
      {/* Мелкая деталь: по ней видно размытие, когда цвет уже не меняется. */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 8px)",
        }}
      />
    </div>
  )
}

/** hex + прозрачность → rgba(): тень в программе задаётся двумя полями. */
function rgba(hex: string, opacity: number): string {
  const value = hex.replace("#", "")
  const r = Number.parseInt(value.slice(0, 2), 16) || 0
  const g = Number.parseInt(value.slice(2, 4), 16) || 0
  const b = Number.parseInt(value.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function Preview({
  value,
  orientation,
}: {
  value: VideoAdjustValue
  orientation: FrameOrientation
}) {
  const [outW, outH] = oppositeFormat(orientation)
  const [inW, inH] = sampleAspect(orientation)
  const scale = STAGE_MAX / Math.max(outW, outH)
  const stageW = outW * scale
  const stageH = outH * scale

  /**
   * Размер переднего плана — та же формула, что в графе программы
   * (`ffSwitchGraph.ts`): `fitPercent` смешивает «вписать целиком» и «заполнить
   * с обрезкой». 0 — видно весь кадр и есть поля, 100 — полей нет и края
   * срезаны.
   */
  const p = Math.min(100, Math.max(0, value.fitPercent)) / 100
  const fit = Math.min(outW / inW, outH / inH)
  const fill = Math.max(outW / inW, outH / inH)
  const fgScale = fit + (fill - fit) * p
  const fgW = inW * fgScale * scale
  const fgH = inH * fgScale * scale

  const shadow = value.shadow.enabled
    ? `${value.shadow.offsetX * scale}px ${value.shadow.offsetY * scale}px ${
        value.shadow.blur * scale
      }px ${value.shadow.spread * scale}px ${rgba(
        value.shadow.color,
        value.shadow.opacity,
      )}`
    : undefined

  return (
    /**
     * Место под превью ФИКСИРОВАНО и квадратно, а рамка центрируется внутри.
     *
     * Иначе при смене ориентации менялась бы ширина превью, а с ней — ширина
     * колонки настроек: ползунки прыгали бы вслед за выбором формата. Настройки
     * к формату отношения не имеют и дёргаться не должны.
     */
    <div
      style={{ width: STAGE_MAX, height: STAGE_MAX }}
      className="flex shrink-0 items-center justify-center"
    >
    <div
      style={{ width: stageW, height: stageH }}
      className="relative overflow-hidden rounded-lg border border-border/60 bg-black"
    >
      {/* Фон: тот же образец на всю площадь, с фильтром программы. */}
      {value.useFgAsBg ? (
        <div
          className="absolute inset-0"
          style={{
            filter: buildBgFilter(value.bg) || undefined,
            transform: value.bg.hFlip ? "scaleX(-1)" : undefined,
          }}
        >
          <SampleArt />
        </div>
      ) : null}

      {/* Передний план: образец в своих пропорциях, по центру. */}
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{
          width: fgW,
          height: fgH,
          transform: "translate(-50%, -50%)",
          boxShadow: shadow,
        }}
      >
        <SampleArt />
      </div>
    </div>
    </div>
  )
}

export function VideoAdjustControl({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<VideoAdjustValue>(() =>
    parseVideoAdjustValue(value),
  )
  /**
   * Ориентация входа НЕ сохраняется: это вопрос «покажи, как будет», а не
   * свойство проекта. Формат выхода из неё и считается — в этом смысл ноды.
   */
  const [orientation, setOrientation] = useState<FrameOrientation>("landscape")
  const [shadowOpen, setShadowOpen] = useState(false)

  useEffect(() => {
    if (open) setDraft(parseVideoAdjustValue(value))
  }, [open, value])

  const summary = useMemo(() => {
    const parsed = parseVideoAdjustValue(value)
    return tf(t.vaSummary, {
      fill: Math.round(parsed.fitPercent),
      blur: parsed.bg.blur,
    })
  }, [value, t])

  const [outW, outH] = oppositeFormat(orientation)
  const L = VIDEO_ADJUST_LIMITS
  const set = (patch: Partial<VideoAdjustValue>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const setBg = (patch: Partial<VideoAdjustValue["bg"]>) =>
    setDraft((prev) => ({ ...prev, bg: { ...prev.bg, ...patch } }))
  const setShadow = (patch: Partial<VideoAdjustValue["shadow"]>) =>
    setDraft((prev) => ({ ...prev, shadow: { ...prev.shadow, ...patch } }))

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
        {t.vaConfigure}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t.vaTitle}</DialogTitle>
            <DialogDescription>{t.vaHint}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">{t.vaInput}</span>
            {(["landscape", "portrait", "square"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === orientation ? "default" : "outline"}
                onClick={() => setOrientation(item)}
                className="text-[13px] font-normal"
              >
                {t[
                  item === "landscape"
                    ? "vaLandscape"
                    : item === "portrait"
                      ? "vaPortrait"
                      : "vaSquare"
                ]}
              </Button>
            ))}
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">
              {tf(t.vaOutput, { width: outW, height: outH })}
            </span>
          </div>

          <div className="flex flex-col gap-5 sm:flex-row">
            <Preview value={draft} orientation={orientation} />

            <div className="min-w-0 flex-1 space-y-5">
              <FieldGroup title={t.vaFrame}>
                <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                  <Switch
                    checked={draft.useFgAsBg}
                    onCheckedChange={(checked) => set({ useFgAsBg: checked })}
                  />
                  {t.vaUseFgAsBg}
                </label>
                <SliderField
                  label={t.vaFill}
                  value={draft.fitPercent}
                  min={L.fitPercent.min}
                  max={L.fitPercent.max}
                  step={L.fitPercent.step}
                  format={(v) => `${Math.round(v)}%`}
                  onChange={(fitPercent) => set({ fitPercent })}
                />
              </FieldGroup>

              <FieldGroup title={t.vaBackground}>
                <SliderField
                  label={t.vaBlur}
                  value={draft.bg.blur}
                  min={L.blur.min}
                  max={L.blur.max}
                  step={L.blur.step}
                  onChange={(blur) => setBg({ blur })}
                />
                <SliderField
                  label={t.vaBrightness}
                  value={draft.bg.brightness}
                  min={L.brightness.min}
                  max={L.brightness.max}
                  step={L.brightness.step}
                  format={(v) => v.toFixed(2)}
                  onChange={(brightness) => setBg({ brightness })}
                />
                <SliderField
                  label={t.vaContrast}
                  value={draft.bg.contrast}
                  min={L.contrast.min}
                  max={L.contrast.max}
                  step={L.contrast.step}
                  format={(v) => v.toFixed(2)}
                  onChange={(contrast) => setBg({ contrast })}
                />
                <SliderField
                  label={t.vaSaturation}
                  value={draft.bg.saturation}
                  min={L.saturation.min}
                  max={L.saturation.max}
                  step={L.saturation.step}
                  format={(v) => v.toFixed(2)}
                  onChange={(saturation) => setBg({ saturation })}
                />
                <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                  <Switch
                    checked={draft.bg.hFlip}
                    onCheckedChange={(hFlip) => setBg({ hFlip })}
                  />
                  {t.vaFlip}
                </label>
              </FieldGroup>

              {/* Тень — свёрнутым блоком: семь полей ради рамки вокруг кадра,
                  открытыми они раздули бы модалку вдвое. Выключатель снаружи,
                  чтобы включить её можно было не разворачивая. */}
              <div className="space-y-3 border-t border-border/50 pt-4">
                <div className="flex items-center gap-2.5">
                  <Switch
                    checked={draft.shadow.enabled}
                    onCheckedChange={(enabled) => setShadow({ enabled })}
                  />
                  <button
                    type="button"
                    onClick={() => setShadowOpen((prev) => !prev)}
                    className="flex items-center gap-1 text-[13px] text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        shadowOpen ? "rotate-90" : null,
                      )}
                    />
                    {t.vaShadow}
                  </button>
                </div>
                {shadowOpen ? (
                  <div className="space-y-3 pl-1">
                    <SliderField
                      label={t.vaShadowBlur}
                      value={draft.shadow.blur}
                      min={L.shadowBlur.min}
                  max={L.shadowBlur.max}
                  step={L.shadowBlur.step}
                      onChange={(blur) => setShadow({ blur })}
                    />
                    <SliderField
                      label={t.vaShadowSpread}
                      value={draft.shadow.spread}
                      min={L.shadowSpread.min}
                  max={L.shadowSpread.max}
                  step={L.shadowSpread.step}
                      onChange={(spread) => setShadow({ spread })}
                    />
                    <SliderField
                      label={t.vaShadowOffsetX}
                      value={draft.shadow.offsetX}
                      min={L.shadowOffset.min}
                  max={L.shadowOffset.max}
                  step={L.shadowOffset.step}
                      onChange={(offsetX) => setShadow({ offsetX })}
                    />
                    <SliderField
                      label={t.vaShadowOffsetY}
                      value={draft.shadow.offsetY}
                      min={L.shadowOffset.min}
                  max={L.shadowOffset.max}
                  step={L.shadowOffset.step}
                      onChange={(offsetY) => setShadow({ offsetY })}
                    />
                    <SliderField
                      label={t.vaShadowOpacity}
                      value={draft.shadow.opacity}
                      min={L.shadowOpacity.min}
                  max={L.shadowOpacity.max}
                  step={L.shadowOpacity.step}
                      format={(v) => v.toFixed(2)}
                      onChange={(opacity) => setShadow({ opacity })}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[12px] text-muted-foreground">
                        {t.vaShadowColor}
                      </Label>
                      <input
                        type="color"
                        value={draft.shadow.color}
                        onChange={(event) =>
                          setShadow({ color: event.target.value })
                        }
                        className="h-7 w-12 cursor-pointer rounded border border-border/60 bg-transparent"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.vaCancel}
            </Button>
            <Button
              onClick={() => {
                // Отдаём значение В ФОРМЕ ГРАФА, а не свою плоскую: у `fg` и
                // `bg` там своя вложенность (`bg.adjust`), и сервер разбирает
                // именно её. Плоскую он прочитал бы как пустую и молча обнулил
                // правку — этим и ловится расхождение в приёмке.
                //
                // Сервер всё равно сольёт ещё раз, со своей копией файла: эта
                // вкладка могла открыться до того, как в программе добавили
                // новое поле.
                onChange(mergeVideoAdjustValue(value, draft))
                setOpen(false)
              }}
            >
              {t.vaApply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
