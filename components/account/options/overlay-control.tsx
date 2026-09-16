"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Move } from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import {
  OVERLAY_FORMATS,
  parseOverlayValue,
  type OverlayFormat,
  type OverlayGeometry,
  type OverlayValue,
} from "@/lib/options/overlay"
import { cn } from "@/lib/utils"
import { FieldGroup, SliderField } from "./modal-fields"

/**
 * Наложение объекта на кадр — docs/OVERLAY_CONTROL_PLAN.md §3–4, §8.
 *
 * В списке настроек — сводка и кнопка; расстановка в модалке. Инлайн это было бы
 * восемнадцать числовых полей (шесть значений на каждый из трёх форматов).
 *
 * Под рамкой НЕ кадр ролика: кадра у сайта нет и не будет. Рамка — это
 * заготовка, то есть сама система координат, в которой хранятся числа.
 *
 * Слово «логотип» в текстах не употребляется намеренно (§8.4): накладывают и
 * плашку, и подпись, и видео с альфа-каналом.
 */

/**
 * Наибольшая сторона рамки на экране. Внутри всё считается в пикселях заготовки.
 *
 * Столько же, сколько у смены формата: обе модалки лежат в одном списке, и
 * превью разного размера читалось бы как разные экраны. Плюс в диалоге шириной
 * 768 пикселей 420 не оставляли колонке настроек места.
 */
const STAGE_MAX = 300

/** Прилипание к центру — в ЭКРАННЫХ пикселях (§8.2). */
const SNAP_PX = 6

type Drag = {
  kind: "move" | "resize"
  startX: number
  startY: number
  origin: OverlayGeometry
}

function round(g: OverlayGeometry): OverlayGeometry {
  return {
    ...g,
    posX: Math.round(g.posX),
    posY: Math.round(g.posY),
    scaleW: Math.max(8, Math.round(g.scaleW)),
    scaleH: Math.max(8, Math.round(g.scaleH)),
    rotation: Number.isFinite(g.rotation) ? g.rotation : 0,
  }
}

/**
 * Не даём объекту улететь совсем: уйти наполовину за край — законный приём
 * (подпись «в край», уезжающая плашка), а вот поймать его мышью после этого
 * должно остаться возможным.
 */
function clampGeometry(g: OverlayGeometry): OverlayGeometry {
  const r = round(g)
  return {
    ...r,
    posX: Math.min(Math.max(r.posX, -r.scaleW), r.bgWidth),
    posY: Math.min(Math.max(r.posY, -r.scaleH), r.bgHeight),
  }
}

/**
 * Объект считается стоящим по середине оси, если его центр отклонён от середины
 * кадра меньше чем на столько пикселей заготовки. Без порога выровненный по
 * центру объект прилипал бы к тому краю, который случайно оказался ближе.
 */
const CENTER_EPS_PX = 12

/**
 * Перенос положения по одной оси — ОТ БЛИЖНЕГО КРАЯ (§8.1).
 *
 * Человек двигает объект не центром, а к краю: придвинул вправо — значит настроил
 * отступ справа, его и сохраняем. Отступ переносится КАК ЕСТЬ, в пикселях: все три
 * заготовки заданы в одном масштабе (короткая сторона 1080 у каждой), поэтому 300 px
 * от низа означают в них одно и то же, и «на 300 px от низа» остаётся ровно этим во
 * всех форматах.
 */
function transferAxis(
  pos: number,
  size: number,
  fromBg: number,
  toSize: number,
  toBg: number,
): number {
  const gapStart = pos
  const gapEnd = fromBg - (pos + size)
  // Насколько центр объекта смещён от середины кадра, в пикселях.
  const offset = (gapStart - gapEnd) / 2
  if (Math.abs(offset) <= CENTER_EPS_PX) {
    return (toBg - toSize) / 2 + offset
  }
  return gapStart < gapEnd ? gapStart : toBg - toSize - gapEnd
}

/**
 * Перенос раскладки в другой формат (§8.1).
 *
 * Размер — ПО ПЛОЩАДИ кадра. У горизонтальной и вертикальной заготовок площадь
 * одна и та же, поэтому при повороте формата объект сохраняет физический размер.
 * Прежняя доля ширины делала его в вертикальном кадре вдвое мельче — нормальный
 * в горизонтальном ролике логотип приезжал туда крошечным.
 */
function transfer(from: OverlayGeometry, to: OverlayGeometry): OverlayGeometry {
  const k = Math.sqrt(
    (to.bgWidth * to.bgHeight) / (from.bgWidth * from.bgHeight),
  )
  const scaleW = from.scaleW * k
  const scaleH = from.scaleH * k
  return clampGeometry({
    ...to,
    scaleW,
    scaleH,
    posX: transferAxis(from.posX, from.scaleW, from.bgWidth, scaleW, to.bgWidth),
    posY: transferAxis(from.posY, from.scaleH, from.bgHeight, scaleH, to.bgHeight),
    rotation: from.rotation,
  })
}

function FormatStage({
  geometry,
  referenceUrl,
  onChange,
}: {
  geometry: OverlayGeometry
  /** Что реально будет наложено. Пусто — рамка пустая (§8.5). */
  referenceUrl: string | null
  onChange: (next: OverlayGeometry) => void
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [guides, setGuides] = useState({ x: false, y: false })
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  const scale = STAGE_MAX / Math.max(geometry.bgWidth, geometry.bgHeight)
  const stageW = geometry.bgWidth * scale
  const stageH = geometry.bgHeight * scale

  useEffect(() => {
    if (!drag) return
    const snap = SNAP_PX / scale

    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startX) / scale
      const dy = (event.clientY - drag.startY) / scale
      const origin = drag.origin

      if (drag.kind === "resize") {
        // Пропорции сохраняются всегда (§8.5): тянем за угол — отношение сторон
        // остаётся. Точные значения задаются полями под рамкой.
        const aspect = origin.scaleW > 0 ? origin.scaleH / origin.scaleW : 1
        const scaleW = origin.scaleW + dx
        onChange(clampGeometry({ ...origin, scaleW, scaleH: scaleW * aspect }))
        setGuides({ x: false, y: false })
        return
      }

      let posX = origin.posX + dx
      let posY = origin.posY + dy

      // Прилипание центра к центру кадра, по осям независимо: объект бывает
      // выровнен по одной оси и намеренно смещён по другой.
      const centerX = origin.bgWidth / 2 - origin.scaleW / 2
      const centerY = origin.bgHeight / 2 - origin.scaleH / 2
      const hitX = Math.abs(posX - centerX) <= snap
      const hitY = Math.abs(posY - centerY) <= snap
      if (hitX) posX = centerX
      if (hitY) posY = centerY

      setGuides({ x: hitX, y: hitY })
      onChange(clampGeometry({ ...origin, posX, posY }))
    }

    const stop = () => {
      setDrag(null)
      setGuides({ x: false, y: false })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", stop)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", stop)
    }
  }, [drag, scale, onChange])

  const start = (kind: Drag["kind"]) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDrag({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: geometryRef.current,
    })
  }

  return (
    /**
     * Место под рамку ФИКСИРОВАНО и квадратно, сама рамка центрируется внутри.
     *
     * Заготовки разной ориентации (1920×1080 и 1080×1920) дают разную ширину, и
     * без этой обёртки колонка настроек ездила бы при переключении вкладки
     * формата — ползунки прыгали бы вслед за ней. Ползунки к формату отношения
     * не имеют.
     */
    <div
      style={{ width: STAGE_MAX, height: STAGE_MAX }}
      className="flex shrink-0 items-center justify-center"
    >
    <div
      style={{ width: stageW, height: stageH }}
      className="relative overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]"
    >
      {/* Направляющие — только пока тянут и только по сработавшей оси. */}
      {guides.x ? (
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary/70" />
      ) : null}
      {guides.y ? (
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-primary/70" />
      ) : null}

      <div
        onPointerDown={start("move")}
        style={{
          left: geometry.posX * scale,
          top: geometry.posY * scale,
          width: geometry.scaleW * scale,
          height: geometry.scaleH * scale,
          transform: `rotate(${geometry.rotation}deg)`,
        }}
        className={cn(
          "absolute cursor-move touch-none select-none rounded-sm border-2 border-primary/70 bg-primary/10",
          drag ? "border-primary" : null,
        )}
      >
        {referenceUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={referenceUrl}
            alt=""
            draggable={false}
            className="pointer-events-none h-full w-full object-fill"
          />
        ) : (
          // Крестик стрелок вместо подписи: слова «логотип» здесь быть не
          // должно (§8.4), но пустая рамка не говорит, что её можно таскать.
          // Значок молчит про содержимое и показывает только это.
          <span className="pointer-events-none flex h-full w-full items-center justify-center text-primary/60">
            <Move className="h-4 w-4" />
          </span>
        )}
        <span
          onPointerDown={start("resize")}
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize touch-none rounded-sm border border-background bg-primary"
        />
      </div>
    </div>
    </div>
  )
}

export function OverlayControl({
  value,
  disabled,
  onChange,
  referenceUrl,
}: {
  value: string
  disabled: boolean
  onChange: (next: string) => void
  referenceUrl: string | null
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<OverlayFormat>("landscape")
  const [draft, setDraft] = useState<OverlayValue>(() => parseOverlayValue(value))
  /**
   * Синхронизация включена по умолчанию, но снимается (§8.1): три раскладки
   * заведены в программе именно затем, чтобы в вертикальном кадре объект можно
   * было поставить иначе. Жёсткая связка отняла бы то, ради чего форматов три.
   */
  const [sync, setSync] = useState(true)

  useEffect(() => {
    if (open) setDraft(parseOverlayValue(value))
  }, [open, value])

  const current = draft[format]
  const summary = useMemo(() => {
    const g = parseOverlayValue(value).landscape
    return tf(t.overlaySummary, {
      width: Math.round(g.scaleW),
      height: Math.round(g.scaleH),
      x: Math.round(g.posX),
      y: Math.round(g.posY),
    })
  }, [value, t])

  const setCurrent = (next: OverlayGeometry) =>
    setDraft((prev) => {
      const updated = { ...prev, [format]: next }
      if (!sync) return updated
      for (const other of OVERLAY_FORMATS) {
        if (other === format) continue
        updated[other] = transfer(next, prev[other])
      }
      return updated
    })

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
        {t.overlayConfigure}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t.overlayTitle}</DialogTitle>
            <DialogDescription>{t.overlayHint}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Заготовка выбирается при обработке по ОРИЕНТАЦИИ кадра, поэтому
                форматов три: какое видео придёт на вход, заранее неизвестно. */}
            <div className="flex gap-1.5">
              {OVERLAY_FORMATS.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={item === format ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormat(item)}
                  className="text-[13px] font-normal"
                >
                  {t[
                    item === "landscape"
                      ? "overlayLandscape"
                      : item === "portrait"
                        ? "overlayPortrait"
                        : "overlaySquare"
                  ]}
                  <span className="ml-1.5 text-[11px] opacity-70">
                    {draft[item].bgWidth}×{draft[item].bgHeight}
                  </span>
                </Button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Switch checked={sync} onCheckedChange={setSync} />
              {t.overlaySync}
            </label>
          </div>

          <div className="flex flex-col gap-5 sm:flex-row">
            <FormatStage
              geometry={current}
              referenceUrl={referenceUrl}
              onChange={setCurrent}
            />

            <div className="min-w-0 flex-1 space-y-5">
              {/* Границы ползунков — те же, что у зажима: уйти наполовину за
                  край можно, улететь совсем нельзя. Точное значение показано
                  рядом, потому что шкала в две тысячи пикселей сама по себе в
                  нужное место не попадает. */}
              <FieldGroup title={t.overlayPosition}>
                <SliderField
                  label={t.overlayX}
                  value={current.posX}
                  min={-current.scaleW}
                  max={current.bgWidth}
                  onChange={(posX) => setCurrent(clampGeometry({ ...current, posX }))}
                />
                <SliderField
                  label={t.overlayY}
                  value={current.posY}
                  min={-current.scaleH}
                  max={current.bgHeight}
                  onChange={(posY) => setCurrent(clampGeometry({ ...current, posY }))}
                />
              </FieldGroup>

              <FieldGroup title={t.overlaySize}>
                <SliderField
                  label={t.overlayW}
                  value={current.scaleW}
                  min={8}
                  max={current.bgWidth * 2}
                  onChange={(scaleW) => {
                    // Пропорции сохраняются и здесь: высота идёт за шириной,
                    // иначе поле противоречило бы перетаскиванию за угол.
                    const aspect =
                      current.scaleW > 0 ? current.scaleH / current.scaleW : 1
                    setCurrent(
                      clampGeometry({ ...current, scaleW, scaleH: scaleW * aspect }),
                    )
                  }}
                />
                <SliderField
                  label={t.overlayH}
                  value={current.scaleH}
                  min={8}
                  max={current.bgHeight * 2}
                  onChange={(scaleH) => {
                    const aspect =
                      current.scaleH > 0 ? current.scaleW / current.scaleH : 1
                    setCurrent(
                      clampGeometry({ ...current, scaleH, scaleW: scaleH * aspect }),
                    )
                  }}
                />
                <SliderField
                  label={t.overlayRotation}
                  value={current.rotation}
                  min={-180}
                  max={180}
                  format={(v) => `${Math.round(v)}°`}
                  onChange={(rotation) =>
                    setCurrent(clampGeometry({ ...current, rotation }))
                  }
                />
              </FieldGroup>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.overlayCancel}
            </Button>
            <Button
              onClick={() => {
                onChange(JSON.stringify(draft))
                setOpen(false)
              }}
            >
              {t.overlayApply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
