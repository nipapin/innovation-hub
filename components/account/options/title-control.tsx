"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Settings } from "lucide-react"

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
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { missingCharacters } from "@/lib/fonts/coverage"
import { loadFont } from "@/lib/fonts/face-loader"
import {
  matchTitlePreset,
  mergeTitleValue,
  parseTitleValue,
  TITLE_ANCHOR_X,
  TITLE_BOXES,
  TITLE_COLORS,
  TITLE_FORMATS,
  TITLE_FRAME,
  TITLE_LINES,
  TITLE_LIMITS,
  TITLE_POSITIONS,
  TITLE_SAMPLE_TEXT,
  TITLE_SHADOWS,
  TITLE_SYSTEM_FONTS,
  TITLE_WRAPS,
  type TitleBox,
  type TitleBoxPreset,
  type TitleFormat,
  type TitleHAlign,
  type TitlePosition,
  type TitleShadow,
  type TitleShadowPreset,
  type TitleValue,
} from "@/lib/options/title"
import { cn } from "@/lib/utils"
import { FontPicker, useFontSources } from "./font-picker"
import { FieldGroup, SliderField } from "./modal-fields"

/**
 * Титры — docs/TITLE_CONTROL_PLAN.md.
 *
 * Из ста с лишним полей клиенту открыто десять. Разделение простое: одно число —
 * ползунок, несколько связанных — заготовка. Заготовка при этом не режим: она
 * просто записывает набор значений, и в сохранённом виде её имени нет.
 *
 * ПРЕВЬЮ ПРИБЛИЗИТЕЛЬНОЕ, и это написано на экране. Программа рендерит ASS через
 * libass, браузер умеет только CSS-текст: начертание, цвет, обводка, плашка и
 * положение совпадут, переносы строк и межбуквенные интервалы могут разойтись.
 */

/**
 * Наибольшая сторона превью на экране — столько же, сколько у наложения и
 * смены формата: все модалки лежат в одном списке, и превью разного размера
 * читалось бы как разные экраны. Под него диалог расширен до max-w-5xl.
 */
const STAGE_MAX = 480

/** hex + прозрачность → rgba(): плашка задаётся двумя полями, как в программе. */
function rgba(hex: string, opacity: number): string {
  const v = hex.replace("#", "")
  const r = Number.parseInt(v.slice(0, 2), 16) || 0
  const g = Number.parseInt(v.slice(2, 4), 16) || 0
  const b = Number.parseInt(v.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/**
 * Образец ломается ТЕМ ЖЕ правилом, что программа ломает настоящие фразы
 * (`buildPreviewLines` в titleAss/buildPhrases.ts): слова набегают, пока строка
 * влезает в `wrapWidth` кадра, потом начинается новая, а за чертой выбранного
 * числа строк слова отбрасываются. Ширину меряет canvas — поэтому обрезка
 * приходится на конец СЛОВА, а не на середину, как у CSS-зажима.
 */
function breakSampleLines(
  text: string,
  lines: number,
  maxWidthPx: number,
  measure: (value: string) => number,
): string {
  const max = Math.max(1, lines)
  let acc = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!acc) {
      acc = word
      continue
    }
    const rows = acc.split("\n")
    const last = rows[rows.length - 1] ?? ""
    const candidate = last ? `${last} ${word}` : word
    if (maxWidthPx > 0 && measure(candidate) > maxWidthPx) {
      if (rows.length >= max) break
      acc += `\n${word}`
    } else {
      acc += ` ${word}`
    }
  }
  return acc
}

/**
 * Общий canvas для замеров: создаётся один раз, шрифт и кегль меняются на
 * каждый замер. Меряет НАСТОЯЩИМ файлом — `loadFont` регистрирует `FontFace`
 * под именем семейства, и canvas видит его через `document.fonts`, как и
 * программа через свой `measure.ts`.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined

function measureTextWidth(family: string, sizePx: number, text: string): number {
  if (measureCtx === undefined) {
    // Замер идёт из useMemo, а тот считается и на сервере: без canvas и без
    // `document` возвращаем ту же оценку, что при неудаче создания контекста.
    measureCtx =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d")
  }
  // Оценка на случай, когда canvas недоступен, — та же, что у программы.
  if (!measureCtx) return text.length * sizePx * 0.55
  measureCtx.font = `${sizePx}px "${family}", sans-serif`
  return measureCtx.measureText(text).width
}

/** Фон превью — НЕ настройка: в файл не пишется. Чтобы оценить титр на светлом и на шашечках. */
const TITLE_BACKDROPS = ["transparent", "white", "gray", "black"] as const
type TitleBackdrop = (typeof TITLE_BACKDROPS)[number]

const BACKDROP_STYLE: Record<TitleBackdrop, React.CSSProperties> = {
  // Шашечки — общепринятая метка прозрачности: на однотонном фоне прозрачность
  // не отличить от серого.
  transparent: {
    backgroundImage: "repeating-conic-gradient(#9ca3af 0% 25%, #4b5563 0% 50%)",
    backgroundSize: "16px 16px",
  },
  white: { background: "#ffffff" },
  // Середина между белым и чёрным, а не «почти чёрный»: четыре подложки нужны
  // затем, чтобы различаться, и тёмно-серая рядом с чёрной этого не даёт.
  gray: { background: "#737373" },
  black: { background: "#000000" },
}

/** Цвета фона в файл не пишутся — значит и переводить их надо здесь, а не в типе. */
const BACKDROP_LABEL = {
  transparent: "titleBgTransparent",
  white: "titleBgWhite",
  gray: "titleBgGray",
  black: "titleBgBlack",
} as const

/** Вид превью: приближение и сдвиг. 1 — кадр ровно в окне, меньше нельзя. */
type StageView = { zoom: number; x: number; y: number }

const ZOOM_MAX = 5
const ZOOM_STEP = 1.2

/**
 * Зажим вида: увеличенный кадр не уезжает за край окна (пустоты по краям не
 * бывает), а при единичном зуме сдвиг просто сбрасывается.
 */
function clampView(view: StageView): StageView {
  if (view.zoom <= 1) return { zoom: 1, x: 0, y: 0 }
  const min = STAGE_MAX * (1 - view.zoom)
  return {
    zoom: view.zoom,
    x: Math.min(0, Math.max(min, view.x)),
    y: Math.min(0, Math.max(min, view.y)),
  }
}

function Stage({
  value,
  format,
  sample,
  backdrop,
  onEditSample,
}: {
  value: TitleValue
  format: TitleFormat
  sample: string
  backdrop: TitleBackdrop
  onEditSample: () => void
}) {
  const { width, height } = TITLE_FRAME[format]
  const scale = STAGE_MAX / Math.max(width, height)
  const place = TITLE_POSITIONS[value.position]
  const shadow = value.shadow
  const box = value.box
  /** Отступы плашки в экранных пикселях: на них правится положение якоря. */
  const padX = box.enabled ? box.paddingX * scale : 0
  const padY = box.enabled ? box.paddingY * scale : 0
  // Размер одинаков во всех форматах — пиксели те же, что уйдут в файл.
  const size = value.size * scale

  /**
   * Колёсико над кадром — приближение к курсору, зажатое колёсико — сдвиг.
   * Мелкий титр в вертикальном кадре иначе не рассмотреть, не меняя самих
   * настроек.
   */
  const [view, setView] = useState<StageView>({ zoom: 1, x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    const node = boxRef.current
    if (!node) return
    // Нативный слушатель: React-обработчик wheel пассивен, а нам нужно
    // запретить прокрутку самой модалки, когда курсор над кадром.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      setView((prev) => {
        const zoom = Math.min(
          ZOOM_MAX,
          Math.max(1, prev.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)),
        )
        if (zoom === prev.zoom) return prev
        // Точка под курсором остаётся на месте: screen = p·zoom + offset.
        const k = zoom / prev.zoom
        return clampView({
          zoom,
          x: cx - (cx - prev.x) * k,
          y: cy - (cy - prev.y) * k,
        })
      })
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    // Только средняя кнопка (колёсико) и только когда есть что таскать.
    if (event.button !== 1 || view.zoom <= 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: view.x,
      y: view.y,
    }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan) return
    setView((prev) =>
      clampView({
        zoom: prev.zoom,
        x: pan.x + (event.clientX - pan.startX),
        y: pan.y + (event.clientY - pan.startY),
      }),
    )
  }
  const endPan = () => {
    panRef.current = null
  }

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
    // Строки уже разбиты замером по концу слова (breakSampleLines) — тем же
    // правилом, каким их ломает программа. Браузеру остаётся нарисовать
    // готовое: `pre` заставляет уважать наши переносы и запрещает переносить
    // самому.
    //
    // Раньше здесь стоял зажим `-webkit-line-clamp`. Он был страховкой на
    // случай, когда браузер всё-таки перенесёт строку иначе, но страховка
    // ДОРИСОВЫВАЛА МНОГОТОЧИЕ — своё штатное поведение, — а программа ничего
    // подобного не делает: лишние слова там просто не попадают в кадр.
    // Обещать многоточие, которого в ролике не будет, хуже, чем показать
    // строку чуть длиннее.
    whiteSpace: "pre",
  }

  return (
    <div
      ref={boxRef}
      style={{ width: STAGE_MAX, height: STAGE_MAX }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      className={cn(
        "shrink-0 overflow-hidden rounded-lg",
        view.zoom > 1 ? "cursor-grab" : null,
      )}
    >
      {/* Зумим и таскаем КВАДРАТ целиком: кадр внутри центрирован, и исходная
          раскладка не знает о виде — всё в одном transform. */}
      <div
        style={{
          width: STAGE_MAX,
          height: STAGE_MAX,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
        className="flex items-center justify-center"
      >
        <div
          style={{
            width: width * scale,
            height: height * scale,
            ...BACKDROP_STYLE[backdrop],
          }}
          className="relative overflow-hidden rounded-lg border border-border/60"
        >
        <div
          className="absolute inset-x-0 flex"
          style={{
            // По вертикали — тот же приём, что по горизонтали: настоящий якорь
            // `y` из настроек, а не край поля. При `top` строка начинается в
            // якоре, при `middle` он её середина, при `bottom` — низ.
            //
            // Отступ плашки вычитаем: в программе на якоре стоит ТЕКСТ, а
            // плашка обводится вокруг него. Без поправки включение плашки
            // двигало бы титр — видно глазом, когда щёлкаешь заготовки.
            top:
              place.vAlign === "top"
                ? `calc(${value.y}% - ${padY}px)`
                : place.vAlign === "bottom"
                  ? `calc(${value.y}% + ${padY}px)`
                  : `${value.y}%`,
            transform:
              place.vAlign === "middle"
                ? "translateY(-50%)"
                : place.vAlign === "bottom"
                  ? "translateY(-100%)"
                  : undefined,
          }}
        >
          <span
            onDoubleClick={onEditSample}
            style={{
              ...textStyle,
              // Ставим текст на НАСТОЯЩИЙ якорь из настроек, а не на край поля:
              // в файле может лежать своё `x` автора графа, и показать его на
              // месте кнопки значило бы соврать о том, что выйдет в ролике.
              // Семантика та же, что у libass: при `left` строка начинается в
              // якоре, при `center` он её середина, при `right` — конец.
              // Отступ плашки вычитаем по той же причине, что и по вертикали.
              marginLeft:
                value.hAlign === "left"
                  ? `calc(${value.x}% - ${padX}px)`
                  : value.hAlign === "right"
                    ? `calc(${value.x}% + ${padX}px)`
                    : `${value.x}%`,
              // Не сжимаемся: при якоре 90 % свободного места остаётся 10 %, и
              // флекс-элемент по умолчанию усох бы до самого длинного слова
              // вместо того, чтобы вылезти за край и обрезаться рамкой.
              flexShrink: 0,
              transform:
                value.hAlign === "center"
                  ? "translateX(-50%)"
                  : value.hAlign === "right"
                    ? "translateX(-100%)"
                    : undefined,
              // Ширина строки — тот самый wrapWidth, что уходит в файл. Меряем
              // по СОДЕРЖИМОМУ: в программе плашка обводится вокруг текста
              // шириной wrapWidth, а не ужимает его. При обычном для проекта
              // border-box отступы плашки съедали бы часть строки, и браузер
              // переносил бы там, где программа не переносит.
              boxSizing: "content-box",
              maxWidth: `${value.wrapWidth}%`,
              textAlign: value.hAlign,
              backgroundColor: box.enabled
                ? rgba(box.color, box.opacity)
                : undefined,
              padding: box.enabled ? `${padY}px ${padX}px` : undefined,
              borderRadius: box.enabled ? box.borderRadius * scale : undefined,
            }}
            className="cursor-text select-none"
          >
            {sample}
          </span>
        </div>
        </div>
      </div>
    </div>
  )
}

/** Подписи ряда «Количество строк»: одна, две, три — словами, как у соседей. */
function lineLabels(extra: number, words: [string, string, string]): Record<number, string> {
  const labels: Record<number, string> = {}
  TITLE_LINES.forEach((n, i) => {
    labels[n] = words[i] ?? String(n)
  })
  // Чужое число автора слова не имеет — показываем само число.
  if (labels[extra] === undefined) labels[extra] = String(extra)
  return labels
}

/**
 * Ряд одинаковых кнопок-вариантов: положение, тень, плашка, число строк.
 *
 * Варианты растянуты поровну на всю ширину, и текст в них по центру — ряд
 * читается как шкала, а не как бусины разной длины. Кнопки из `compact`
 * («нет») в дележе не участвуют и остаются своей ширины: пустой вариант не
 * должен занимать места столько же, сколько содержательный.
 */
function ChoiceRow<T extends string | number>({
  options,
  value,
  labels,
  compact = [],
  onChange,
}: {
  options: readonly T[]
  /** `null` — ни одна кнопка не подсвечена: значения не совпали ни с одной заготовкой. */
  value: T | null
  labels: Record<T, string>
  /** Варианты, которые НЕ делят ширину поровну, а остаются по содержимому. */
  compact?: readonly T[]
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
          className={cn(
            "text-[12px] font-normal",
            compact.includes(item) ? null : "min-w-0 flex-1 basis-0 justify-center text-center",
          )}
        >
          {labels[item]}
        </Button>
      ))}
    </div>
  )
}

/**
 * Шестерёнка у правого края заголовка группы — точная настройка.
 *
 * Кнопки-заготовки ставят набор значений разом; шестерёнка открывает те же
 * значения по одному, на случай когда ни одна заготовка не подошла. Правка
 * ползунком сразу видна в превью, но подсветку с кнопки снимает: числа больше
 * не совпадают с её набором (`matchTitlePreset`). Так и приходят настройки
 * автора графа: применяется всё, а подсвечивается только то, что совпало.
 *
 * Ползунки лежат во ВСПЛЫВАЮЩЕМ окне, а не разворачиваются под заголовком:
 * раскрытая панель меняла высоту диалога, и до нужной группы приходилось
 * прокручивать заново. Закрытие щелчком мимо и по Esc даёт сам Radix, уголок
 * показывает, из какой шестерёнки окно выехало. Открыта одна группа за раз:
 * три окна разом превратили бы столбец в ту самую «тонкую настройку», которой
 * здесь быть не должно.
 */
function TunePopover({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string
  open: boolean
  onOpenChange: (next: boolean) => void
  children: React.ReactNode
}) {
  // `modal` обязателен: окно живёт в портале на `body`, а модальный диалог
  // гасит на нём `pointer-events`. Без флага портал наследует `none`, клик по
  // ползунку считается кликом СНАРУЖИ, и окно закрывается, не дав подвигать
  // значение. Проверено вживую: без `modal` не работает ни один ползунок.
  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "-mr-1 shrink-0 rounded p-1 transition-colors",
            open
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      {/* Шире умолчания: ползунок с подписью и числом в 256 px читается как
          обрубок, а цифру справа приходится ловить глазом. */}
      <PopoverContent align="end" sideOffset={6} className="w-[436px] space-y-3">
        {children}
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  )
}

/** Подпись и квадратик цвета в строку — обводка, тень и плашка задают цвет одинаково. */
function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        disabled ? "pointer-events-none opacity-40" : null,
      )}
    >
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-border/60 bg-transparent"
      />
    </div>
  )
}

/** Подписи ряда «Ширина текста» — просто проценты. */
function wrapLabels(): Record<number, string> {
  const labels: Record<number, string> = {}
  for (const n of TITLE_WRAPS) labels[n] = `${n} %`
  return labels
}

/** Группы, у которых есть точная настройка: набор значений за одной кнопкой. */
type TuneGroup = "wrap" | "position" | "shadow" | "box"

/** Черновик — по блоку на формат: со снятой синхронизацией они различаются. */
function parseAllFormats(raw: string): Record<TitleFormat, TitleValue> {
  return {
    landscape: parseTitleValue(raw, "landscape"),
    portrait: parseTitleValue(raw, "portrait"),
    square: parseTitleValue(raw, "square"),
  }
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
  const [draft, setDraft] = useState<Record<TitleFormat, TitleValue>>(() =>
    parseAllFormats(value),
  )
  /**
   * Синхронизация включена по умолчанию, но снимается — как в наложении:
   * форматов три именно затем, чтобы в вертикальном кадре титр можно было
   * оформить иначе. Жёсткая связка отняла бы то, ради чего форматов три.
   */
  const [sync, setSync] = useState(true)
  /** Текст образца НЕ сохраняется: настоящие слова придут из входа ноды. */
  const [sample, setSample] = useState(TITLE_SAMPLE_TEXT)
  /** Фон под превью — тоже НЕ сохраняется: это подложка для глаз, не свойство титра. */
  const [backdrop, setBackdrop] = useState<TitleBackdrop>("gray")
  /** Какая группа раскрыта в точную настройку (шестерёнка). Одна за раз. */
  const [tune, setTune] = useState<TuneGroup | null>(null)
  const tuneProps = (group: TuneGroup) => ({
    open: tune === group,
    onOpenChange: (next: boolean) => setTune(next ? group : null),
  })

  const sources = useFontSources(projectId, open)
  const [covered, setCovered] = useState<Set<number> | null>(null)
  const [fontState, setFontState] = useState<"none" | "loading" | "ready" | "failed">(
    "none",
  )

  useEffect(() => {
    if (!open) return
    const all = parseAllFormats(value)
    if (!sync) {
      setDraft(all)
      return
    }
    // Синхронизация включена — значит черновик ОДИН. Значения в файле могли
    // разъехаться (их писала программа или старый сайт с пересчётом долей), и
    // показывать их по вкладкам под выключателем «одинаково во всех форматах»
    // значило бы врать. За образец — горизонтальный, как самый ходовой.
    setDraft({
      landscape: all.landscape,
      portrait: all.landscape,
      square: all.landscape,
    })
    // sync в зависимостях нет НАРОЧНО: переключатель обрабатывает сам
    // (onSyncChange), а перечитывание файла при каждом щелчке затирало бы
    // несохранённую правку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value])

  /** Настройки формата, который сейчас на экране. */
  const current = draft[format]

  /**
   * Строки образца — по правилу программы (см. breakSampleLines): набегают до
   * 80 % ширины кадра и обрезаются по концу слова. Пересчёт привязан и к
   * загрузке файла шрифта: до неё canvas мерил подставным, и границы строк
   * были грубее.
   */
  const brokenSample = useMemo(
    () =>
      breakSampleLines(
        sample,
        current.lines,
        (current.wrapWidth / 100) * TITLE_FRAME[format].width,
        (line) => measureTextWidth(current.font, current.size, line),
      ),
    // fontState — триггер пересчёта, само значение внутри не читается.
    [
      sample,
      current.lines,
      current.wrapWidth,
      current.font,
      current.size,
      format,
      fontState,
    ],
  )

  /**
   * Включаем синхронизацию — все форматы берут значения ТЕКУЩЕГО, того, что на
   * экране: иначе щелчок молча подменял бы то, что человек только что видел.
   * Выключаем — копии расходятся, и каждая вкладка правится сама.
   */
  const onSyncChange = (next: boolean) => {
    setSync(next)
    if (next) {
      setDraft((prev) => {
        const shared = prev[format]
        return { landscape: shared, portrait: shared, square: shared }
      })
    }
  }

  /**
   * Образец рисуется НАСТОЯЩИМ файлом — тем, который поедет на машину
   * (docs/FONTS_PLAN.md §6). Из тех же байтов приходит покрытие: без него
   * браузер молча подставил бы системный шрифт, и образец с иероглифами
   * выглядел бы правильным там, где libass нарисует пустые квадраты.
   */
  useEffect(() => {
    if (!open) return
    const family = current.font
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
  }, [open, current.font, sources])

  const missing = useMemo(
    () => (covered ? missingCharacters(covered, sample) : []),
    [covered, sample],
  )

  /** Системный шрифт из старых настроек — и чем его заменить (§5 плана). */
  const legacy = TITLE_SYSTEM_FONTS.some((name) => name === current.font)
  const replacement = legacy
    ? (sources.library.find((font) => font.replaces === current.font) ?? null)
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

  /**
   * Со включённой синхронизацией правка уходит во все три формата, со снятой —
   * только в тот, что на экране. Тот же выключатель, что у наложения.
   */
  const set = (patch: Partial<TitleValue>) =>
    setDraft((prev) => {
      if (!sync) {
        return { ...prev, [format]: { ...prev[format], ...patch } }
      }
      const next = { ...prev }
      for (const item of TITLE_FORMATS) {
        next[item] = { ...prev[item], ...patch }
      }
      return next
    })

  /**
   * Тень включена ровно тогда, когда её видно: нулевые смещение и размытие —
   * это и есть «нет тени». Отдельный выключатель здесь лишний, как у обводки,
   * где ноль ширины уже означает её отсутствие. Правило в точности повторяет
   * заготовки (`TITLE_SHADOWS.none` — сплошные нули), поэтому подсветка кнопок
   * от него не разъезжается.
   */
  const setShadow = (patch: Partial<TitleShadow>) => {
    const next = { ...current.shadow, ...patch }
    set({
      shadow: {
        ...next,
        enabled: next.offsetX !== 0 || next.offsetY !== 0 || next.blur !== 0,
      },
    })
  }

  /** Плашка — то же правило: полностью прозрачная плашка и есть «нет плашки». */
  const setBox = (patch: Partial<TitleBox>) => {
    const next = { ...current.box, ...patch }
    set({ box: { ...next, enabled: next.opacity > 0 } })
  }

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
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.titleTitle}</DialogTitle>
            <DialogDescription>{t.titleHint}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3">
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

            {/* Тот же выключатель, что в наложении: одинаково во всех
                форматах или каждый сам по себе. */}
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Switch checked={sync} onCheckedChange={onSyncChange} />
              {t.overlaySync}
            </label>
          </div>

          {/* В строку — только когда превью 480 px и колонке настроек ещё
              остаётся место: на 640 px в ряд помещалось прежнее превью 300 px,
              а этому нужен экран от 1024. */}
          <div className="flex flex-col gap-5 lg:flex-row">
            <div className="shrink-0 space-y-2">
              <Stage
                // Пересоздаём при смене формата: зум и сдвиг привязаны к
                // координатам старого кадра и на новом не значат ничего.
                key={format}
                value={current}
                format={format}
                sample={brokenSample}
                backdrop={backdrop}
                onEditSample={() => {
                  const next = window.prompt(t.titleSamplePrompt, sample)
                  if (next !== null) setSample(next || TITLE_SAMPLE_TEXT)
                }}
              />

              {/* Подложка под кадром — для глаз, в файл не уходит. Белый титр
                  на светлом ролике теряется, и увидеть это надо здесь, а не в
                  готовом файле; шашечки показывают, что кадра под титром может
                  не быть вовсе. */}
              <div className="flex items-center gap-1.5">
                {TITLE_BACKDROPS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-label={t[BACKDROP_LABEL[item]]}
                    title={t[BACKDROP_LABEL[item]]}
                    onClick={() => setBackdrop(item)}
                    style={{
                      ...BACKDROP_STYLE[item],
                      // Клетка мельче, чем в кадре: на кружке 24 px шашки по
                      // 16 px читались бы как две половинки, а не как метка.
                      ...(item === "transparent"
                        ? { backgroundSize: "8px 8px" }
                        : null),
                    }}
                    className={cn(
                      "h-6 w-6 rounded-full border",
                      item === backdrop
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border/60",
                    )}
                  />
                ))}
              </div>
              {/* Каких символов в шрифте нет — под самим образцом, где их и
                  недосчитались. Это не предупреждение «на всякий случай»:
                  ответ прочитан из таблицы `cmap` того же файла. */}
              {missing.length > 0 ? (
                <p className="max-w-[480px] text-[11px] leading-snug text-destructive">
                  {t.fontMissing}{" "}
                  <span className="font-medium">
                    {missing.slice(0, 12).join(" ")}
                    {missing.length > 12 ? " …" : ""}
                  </span>
                </p>
              ) : null}
              {fontState === "loading" ? (
                <p className="max-w-[480px] text-[11px] leading-snug text-muted-foreground">
                  {t.fontLoading}
                </p>
              ) : null}
              {fontState === "failed" ? (
                <p className="max-w-[480px] text-[11px] leading-snug text-destructive">
                  {t.fontFailed}
                </p>
              ) : null}
              {/* Честно про приближение — на экране, а не в подсказке. */}
              <p className="max-w-[480px] text-[11px] leading-snug text-muted-foreground">
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
                    value={current.font}
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
                          color === current.color
                            ? "border-primary ring-2 ring-primary/40"
                            : "border-border/60",
                        )}
                      />
                    ))}
                    <input
                      type="color"
                      value={current.color}
                      onChange={(event) => set({ color: event.target.value })}
                      className="h-6 w-8 cursor-pointer rounded border border-border/60 bg-transparent"
                    />
                  </div>
                </div>

                <SliderField
                  label={t.titleSize}
                  value={current.size}
                  min={TITLE_LIMITS.size.min}
                  max={TITLE_LIMITS.size.max}
                  step={TITLE_LIMITS.size.step}
                  onChange={(size) => set({ size })}
                />

                {/* Число строк — НЕ заготовка, а выбор, но кнопки те же:
                    «две строки» понятнее ползунка, а значений мало. Чужое
                    число автора (четыре, пять) показываем как есть — как
                    «своё» у качества конвертации. */}
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {t.titleLines}
                  </Label>
                  <ChoiceRow<number>
                    options={
                      TITLE_LINES.some((n) => n === current.lines)
                        ? TITLE_LINES
                        : [current.lines, ...TITLE_LINES]
                    }
                    value={current.lines}
                    labels={lineLabels(current.lines, [
                      t.titleLinesOne,
                      t.titleLinesTwo,
                      t.titleLinesThree,
                    ])}
                    onChange={(lines) => set({ lines })}
                  />
                </div>

                <div className="space-y-1.5">
                  <SliderField
                    label={t.titleOutline}
                    value={current.outlineWidth}
                    min={TITLE_LIMITS.outline.min}
                    max={TITLE_LIMITS.outline.max}
                    step={TITLE_LIMITS.outline.step}
                    onChange={(outlineWidth) => set({ outlineWidth })}
                  />
                  {/* Цвет обводки виден ВСЕГДА, при нулевой толщине — неактивен.
                      Прятать его нельзя: ползунок проходит ноль на каждом
                      выключении, и исчезающий ряд менял высоту окна — вся
                      модалка скакала. */}
                  <ColorField
                    label={t.titleOutlineColor}
                    value={current.outlineColor}
                    disabled={current.outlineWidth === 0}
                    onChange={(outlineColor) => set({ outlineColor })}
                  />
                </div>
              </FieldGroup>

              {/* Ширина строки — своей группой, а не полем в «Тексте»: вместе
                  с числом строк она решает, во сколько строк ляжет фраза, и
                  правят её, глядя в превью, а не в список полей. */}
              <FieldGroup
                title={t.titleWrap}
                action={
                  <TunePopover label={t.titleTune} {...tuneProps("wrap")}>
                    <SliderField
                      label={t.titleWrap}
                      value={current.wrapWidth}
                      min={TITLE_LIMITS.wrap.min}
                      max={TITLE_LIMITS.wrap.max}
                      step={TITLE_LIMITS.wrap.step}
                      format={(v) => `${Math.round(v)} %`}
                      onChange={(wrapWidth) => set({ wrapWidth })}
                    />
                  </TunePopover>
                }
              >
                {/* Кнопок ровно три, и чужое число автора СВОЕЙ кнопки не
                    получает — в отличие от числа строк, где четвёртая строка
                    осмысленный вариант. Проценты непрерывны: ползунок
                    дорисовывал бы новую кнопку на каждое движение, и она же
                    всегда была бы подсвечена. Не совпало с тремя — не
                    подсвечено ничего, само значение видно в шестерёнке. */}
                <ChoiceRow<number>
                  options={TITLE_WRAPS}
                  value={
                    TITLE_WRAPS.some((n) => n === current.wrapWidth)
                      ? current.wrapWidth
                      : null
                  }
                  labels={wrapLabels()}
                  onChange={(wrapWidth) => set({ wrapWidth })}
                />
              </FieldGroup>

              <FieldGroup
                title={t.titlePosition}
                action={
                  <TunePopover label={t.titleTune} {...tuneProps("position")}>
                    {/* Оба якоря рядом: «слева-справа» и «сверху-снизу» — одна
                        настройка в две оси, и разводить их по разным окнам
                        значило бы заставлять целиться дважды.

                        Вертикаль первой — в том же порядке, что ряды кнопок
                        под заголовком. Разный порядок в двух списках одного и
                        того же заставляет читать подписи там, где хватило бы
                        места. */}
                    <SliderField
                      label={t.titleAnchorY}
                      value={current.y}
                      min={TITLE_LIMITS.anchor.min}
                      max={TITLE_LIMITS.anchor.max}
                      step={TITLE_LIMITS.anchor.step}
                      format={(v) => `${Math.round(v)} %`}
                      onChange={(y) => set({ y })}
                    />
                    <SliderField
                      label={t.titleAnchorX}
                      value={current.x}
                      min={TITLE_LIMITS.anchor.min}
                      max={TITLE_LIMITS.anchor.max}
                      step={TITLE_LIMITS.anchor.step}
                      format={(v) => `${Math.round(v)} %`}
                      onChange={(x) => set({ x })}
                    />
                  </TunePopover>
                }
              >
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {t.titlePosVertical}
                  </Label>
                  <ChoiceRow<TitlePosition>
                    options={["top", "middle", "bottom"]}
                    value={
                      current.y === TITLE_POSITIONS[current.position].y
                        ? current.position
                        : null
                    }
                    labels={{
                      top: t.titlePosTop,
                      middle: t.titlePosMiddle,
                      bottom: t.titlePosBottom,
                    }}
                    onChange={(position) =>
                      set({ position, y: TITLE_POSITIONS[position].y })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">
                    {t.titlePosHorizontal}
                  </Label>
                  {/* Кнопка подсвечена, только если якорь стоит на ЕЁ месте:
                      у автора графа могло быть своё `x`, и тогда не подсвечена
                      ни одна — то же правило, что у тени и плашки. */}
                  <ChoiceRow<TitleHAlign>
                    options={["left", "center", "right"]}
                    value={
                      current.x === TITLE_ANCHOR_X[current.hAlign]
                        ? current.hAlign
                        : null
                    }
                    labels={{
                      left: t.titleAlignLeft,
                      center: t.titleAlignCenter,
                      right: t.titleAlignRight,
                    }}
                    onChange={(hAlign) =>
                      set({ hAlign, x: TITLE_ANCHOR_X[hAlign] })
                    }
                  />
                </div>
              </FieldGroup>

              <FieldGroup
                title={t.titleShadow}
                action={
                  <TunePopover label={t.titleTune} {...tuneProps("shadow")}>
                    <SliderField
                      label={t.titleOffsetX}
                      value={current.shadow.offsetX}
                      min={TITLE_LIMITS.shadowOffset.min}
                      max={TITLE_LIMITS.shadowOffset.max}
                      step={TITLE_LIMITS.shadowOffset.step}
                      onChange={(offsetX) => setShadow({ offsetX })}
                    />
                    <SliderField
                      label={t.titleOffsetY}
                      value={current.shadow.offsetY}
                      min={TITLE_LIMITS.shadowOffset.min}
                      max={TITLE_LIMITS.shadowOffset.max}
                      step={TITLE_LIMITS.shadowOffset.step}
                      onChange={(offsetY) => setShadow({ offsetY })}
                    />
                    <SliderField
                      label={t.titleBlur}
                      value={current.shadow.blur}
                      min={TITLE_LIMITS.shadowBlur.min}
                      max={TITLE_LIMITS.shadowBlur.max}
                      step={TITLE_LIMITS.shadowBlur.step}
                      onChange={(blur) => setShadow({ blur })}
                    />
                    <ColorField
                      label={t.titleColor}
                      value={current.shadow.color}
                      disabled={!current.shadow.enabled}
                      onChange={(color) => setShadow({ color })}
                    />
                  </TunePopover>
                }
              >
                {/* Подсвечена та заготовка, чьи значения совпали ТОЧНО. Правка
                    ползунком подсветку снимает: числа больше не её. */}
                <ChoiceRow<TitleShadowPreset>
                  options={["none", "soft", "hard", "glow", "lift"]}
                  value={
                    matchTitlePreset(
                      TITLE_SHADOWS,
                      current.shadow,
                    ) as TitleShadowPreset | null
                  }
                  compact={["none"]}
                  labels={{
                    none: t.titleNone,
                    soft: t.titleShadowSoft,
                    hard: t.titleShadowHard,
                    glow: t.titleShadowGlow,
                    lift: t.titleShadowLift,
                  }}
                  // Кнопка кладёт КОПИЮ заготовки: сама она — общая константа
                  // модуля, и правка ползунком поверх испортила бы её всем.
                  onChange={(name) => set({ shadow: { ...TITLE_SHADOWS[name] } })}
                />
              </FieldGroup>

              <FieldGroup
                title={t.titleBox}
                action={
                  <TunePopover label={t.titleTune} {...tuneProps("box")}>
                    <SliderField
                      label={t.titleOpacity}
                      value={current.box.opacity}
                      min={TITLE_LIMITS.boxOpacity.min}
                      max={TITLE_LIMITS.boxOpacity.max}
                      step={TITLE_LIMITS.boxOpacity.step}
                      // Доля, а не проценты: так её хранит программа, и
                      // округление до целого показало бы 0.45 как ноль.
                      format={(v) => v.toFixed(2)}
                      onChange={(opacity) => setBox({ opacity })}
                    />
                    <SliderField
                      label={t.titlePadX}
                      value={current.box.paddingX}
                      min={TITLE_LIMITS.boxPadding.min}
                      max={TITLE_LIMITS.boxPadding.max}
                      step={TITLE_LIMITS.boxPadding.step}
                      onChange={(paddingX) => setBox({ paddingX })}
                    />
                    <SliderField
                      label={t.titlePadY}
                      value={current.box.paddingY}
                      min={TITLE_LIMITS.boxPadding.min}
                      max={TITLE_LIMITS.boxPadding.max}
                      step={TITLE_LIMITS.boxPadding.step}
                      onChange={(paddingY) => setBox({ paddingY })}
                    />
                    <SliderField
                      label={t.titleRadius}
                      value={current.box.borderRadius}
                      min={TITLE_LIMITS.boxRadius.min}
                      max={TITLE_LIMITS.boxRadius.max}
                      step={TITLE_LIMITS.boxRadius.step}
                      onChange={(borderRadius) => setBox({ borderRadius })}
                    />
                    <ColorField
                      label={t.titleColor}
                      value={current.box.color}
                      disabled={!current.box.enabled}
                      onChange={(color) => setBox({ color })}
                    />
                  </TunePopover>
                }
              >
                <ChoiceRow<TitleBoxPreset>
                  options={["none", "translucent", "solid", "rounded"]}
                  value={
                    matchTitlePreset(
                      TITLE_BOXES,
                      current.box,
                    ) as TitleBoxPreset | null
                  }
                  compact={["none"]}
                  labels={{
                    none: t.titleNone,
                    translucent: t.titleBoxTranslucent,
                    solid: t.titleBoxSolid,
                    rounded: t.titleBoxRounded,
                  }}
                  onChange={(name) => set({ box: { ...TITLE_BOXES[name] } })}
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
                // Каждый формат сливается со своим блоком: со снятой
                // синхронизацией они разные. Сервер сольёт ещё раз, со своей
                // копией файла, — тем же поформатным слиянием.
                let merged = value
                for (const item of TITLE_FORMATS) {
                  merged = mergeTitleValue(merged, draft[item], item)
                }
                onChange(merged)
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
