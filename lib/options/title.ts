/**
 * Титры: разбор значения `titleSettings` — docs/TITLE_CONTROL_PLAN.md.
 *
 * Чистый модуль, как overlay.ts и video-adjust.ts: тем же кодом читает страница,
 * пишет сервер и проверяет приёмка.
 *
 * Значение — СТРОКА с JSON, три формата (`landscape`, `portrait`, `square`), в
 * каждом около тридцати пяти полей. Сайт правит девять из них; остальное
 * (анимация, типографика, `encode`, размеры кадра) принадлежит программе и
 * возвращается нетронутым.
 */

export const TITLE_FORMATS = ["landscape", "portrait", "square"] as const
export type TitleFormat = (typeof TITLE_FORMATS)[number]

/** Размер кадра формата — та же система координат, что у титров в программе. */
export const TITLE_FRAME: Record<TitleFormat, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
}

/**
 * Шрифты — только системные (§2.1 плана).
 *
 * Шрифт ищется ПО ИМЕНИ на машине, которая рендерит: не нашла — libass молча
 * подставит другой, и клиент узнает об этом по готовому ролику. Поэтому список
 * закрытый и состоит из тех, что есть на любой системе, а браузер рисует их без
 * подгрузки веб-шрифта — превью и ролик показывают одно лицо.
 *
 * Impact сюда не входит намеренно: у него на разных системах разное покрытие
 * кириллицы, и русский текст местами подменяется другим шрифтом.
 */
export const TITLE_FONTS = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
] as const
export type TitleFont = (typeof TITLE_FONTS)[number]

/** Цвета текста: белый, чёрный и несколько ярких. Свой задаётся пипеткой. */
export const TITLE_COLORS = [
  "#ffffff",
  "#000000",
  "#ffd400",
  "#ff4d4d",
  "#4dd2ff",
  "#7cff6b",
] as const

export type TitlePosition = "top" | "middle" | "bottom"

/**
 * Положение — две связанные величины (`y` и `vAlign`) с тремя осмысленными
 * сочетаниями, поэтому кнопки, а не ползунок.
 *
 * Отступ от края в 10 % не случаен: у площадок там своя разметка — таймлайн,
 * подписи, кнопки, — и титр, прижатый вплотную, окажется под ней.
 */
export const TITLE_POSITIONS: Record<
  TitlePosition,
  { y: number; vAlign: "top" | "middle" | "bottom" }
> = {
  top: { y: 10, vAlign: "top" },
  middle: { y: 50, vAlign: "middle" },
  bottom: { y: 90, vAlign: "bottom" },
}

export type TitleShadowPreset = "none" | "soft" | "hard" | "glow" | "lift"
export type TitleBoxPreset = "none" | "translucent" | "solid" | "rounded"

/**
 * Заготовки — это НЕ режимы, а просто несколько значений под одним именем.
 *
 * Выбрал «мягкая» — записались конкретные смещение, размытие и цвет. Дальше всё
 * правится поверх, и заготовка ни на что больше не влияет: в сохранённом
 * значении её имени нет.
 *
 * Ползунок там, где число одно (обводка, размер); заготовка там, где значений
 * несколько и по отдельности они бессмысленны.
 */
export const TITLE_SHADOWS: Record<
  TitleShadowPreset,
  { enabled: boolean; color: string; offsetX: number; offsetY: number; blur: number }
> = {
  none: { enabled: false, color: "#000000", offsetX: 0, offsetY: 0, blur: 0 },
  soft: { enabled: true, color: "#000000", offsetX: 0, offsetY: 4, blur: 12 },
  hard: { enabled: true, color: "#000000", offsetX: 4, offsetY: 4, blur: 0 },
  // Свечение: тень без смещения и с большим размытием — читается на пёстром кадре.
  glow: { enabled: true, color: "#000000", offsetX: 0, offsetY: 0, blur: 24 },
  lift: { enabled: true, color: "#000000", offsetX: 0, offsetY: 10, blur: 20 },
}

export const TITLE_BOXES: Record<
  TitleBoxPreset,
  {
    enabled: boolean
    color: string
    opacity: number
    paddingX: number
    paddingY: number
    borderRadius: number
  }
> = {
  none: { enabled: false, color: "#000000", opacity: 0, paddingX: 0, paddingY: 0, borderRadius: 0 },
  translucent: { enabled: true, color: "#000000", opacity: 0.45, paddingX: 24, paddingY: 12, borderRadius: 0 },
  solid: { enabled: true, color: "#000000", opacity: 1, paddingX: 24, paddingY: 12, borderRadius: 0 },
  rounded: { enabled: true, color: "#000000", opacity: 0.75, paddingX: 28, paddingY: 14, borderRadius: 16 },
}

export const TITLE_LIMITS = {
  /** Размер шрифта в пикселях кадра 1920×1080; в другие форматы едет долей. */
  size: { min: 24, max: 160, step: 2 },
  outline: { min: 0, max: 12, step: 1 },
} as const

/** То, что правит сайт. Одно на все три формата — см. `applyToAll`. */
export type TitleValue = {
  font: TitleFont
  size: number
  color: string
  position: TitlePosition
  outlineWidth: number
  outlineColor: string
  shadow: TitleShadowPreset
  box: TitleBoxPreset
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const HEX = /^#[0-9a-f]{6}$/i

export function defaultTitleValue(): TitleValue {
  return {
    font: "Arial",
    size: 60,
    color: "#ffffff",
    position: "bottom",
    outlineWidth: 0,
    outlineColor: "#000000",
    shadow: "none",
    box: "none",
  }
}

/**
 * Какая заготовка похожа на то, что лежит в файле.
 *
 * Имя заготовки в значении НЕ хранится — там только числа, и автор графа мог
 * поставить любые. Поэтому при открытии подбираем ближайшую: точное совпадение
 * полей даёт её, иначе остаётся первая («нет»), и это честно — показывать
 * «мягкая тень» там, где значения другие, значило бы врать.
 */
function matchPreset<T extends Record<string, unknown>>(
  presets: Record<string, T>,
  current: Record<string, unknown> | null,
  fallback: string,
): string {
  if (!current) return fallback
  for (const [name, preset] of Object.entries(presets)) {
    const same = Object.entries(preset).every(([key, value]) => {
      const actual = current[key]
      return typeof value === "number"
        ? Math.abs(num(actual, NaN) - value) < 0.001
        : actual === value
    })
    if (same) return name
  }
  return fallback
}

/** Строка значения → то, что правит сайт. Берём горизонтальный формат за образец. */
export function parseTitleValue(raw: unknown): TitleValue {
  const fallback = defaultTitleValue()
  let root: unknown = null
  if (typeof raw === "string" && raw.trim()) {
    try {
      root = JSON.parse(raw)
    } catch {
      root = null
    }
  } else if (raw && typeof raw === "object") {
    root = raw
  }
  const obj = asRecord(root)
  if (!obj) return fallback

  const block = asRecord(obj.landscape) ?? asRecord(obj.portrait) ?? asRecord(obj.square)
  if (!block) return fallback

  const text = asRecord(block.text) ?? {}
  const position = asRecord(block.position) ?? {}
  const outline = asRecord(block.outline) ?? {}

  const font = TITLE_FONTS.find((item) => item === text.font) ?? fallback.font
  const vAlign = position.vAlign
  const place: TitlePosition =
    vAlign === "top" ? "top" : vAlign === "middle" ? "middle" : "bottom"

  return {
    font,
    size: Math.round(num(text.size, fallback.size)),
    color: typeof text.color === "string" && HEX.test(text.color) ? text.color : fallback.color,
    position: place,
    outlineWidth:
      outline.enabled === true
        ? Math.round(num(outline.width, fallback.outlineWidth))
        : 0,
    outlineColor:
      typeof outline.color === "string" && HEX.test(outline.color)
        ? outline.color
        : fallback.outlineColor,
    shadow: matchPreset(TITLE_SHADOWS, asRecord(block.shadow), "none") as TitleShadowPreset,
    box: matchPreset(TITLE_BOXES, asRecord(block.background), "none") as TitleBoxPreset,
  }
}

/**
 * Размер под формат: доля от ширины кадра, а не то же число.
 *
 * Шестьдесят пикселей в кадре 1920 — это 3,1 % ширины; те же шестьдесят в кадре
 * 1080 занимают уже 5,5 %, то есть титр в вертикальном ролике оказался бы заметно
 * крупнее. Настраивают один раз, а выглядеть должно одинаково.
 */
export function sizeForFormat(size: number, format: TitleFormat): number {
  const ratio = TITLE_FRAME[format].width / TITLE_FRAME.landscape.width
  return Math.round(size * ratio)
}

/**
 * Слияние правки клиента в ТЕКУЩЕЕ значение из файла.
 *
 * Правка ложится во ВСЕ ТРИ формата сразу: клиент настраивает один раз, а какой
 * ролик придёт на вход — заранее неизвестно. Всё, чего сайт не знает (анимация,
 * перенос строк, число строк, `encode`), берётся из файла и возвращается на
 * место — слияние на сервере, не доверие браузеру.
 */
export function mergeTitleValue(currentRaw: unknown, incoming: TitleValue): string {
  let root: Record<string, unknown> = {}
  if (typeof currentRaw === "string" && currentRaw.trim()) {
    try {
      const parsed = JSON.parse(currentRaw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>
      }
    } catch {
      // Значение испорчено — пишем поверх, сохранять нечего.
    }
  }

  const place = TITLE_POSITIONS[incoming.position]
  for (const format of TITLE_FORMATS) {
    const block = asRecord(root[format]) ?? {}
    const text = asRecord(block.text) ?? {}
    const position = asRecord(block.position) ?? {}

    root[format] = {
      ...block,
      videoWidth: num(block.videoWidth, TITLE_FRAME[format].width),
      videoHeight: num(block.videoHeight, TITLE_FRAME[format].height),
      text: {
        ...text,
        font: incoming.font,
        size: sizeForFormat(incoming.size, format),
        color: incoming.color,
      },
      position: {
        ...position,
        // `x` и горизонтальное выравнивание не трогаем: титр всегда по центру
        // ширины, и трогать это клиенту незачем.
        x: num(position.x, 50),
        hAlign: typeof position.hAlign === "string" ? position.hAlign : "center",
        y: place.y,
        vAlign: place.vAlign,
      },
      outline: {
        ...(asRecord(block.outline) ?? {}),
        enabled: incoming.outlineWidth > 0,
        width: incoming.outlineWidth,
        color: incoming.outlineColor,
      },
      shadow: { ...(asRecord(block.shadow) ?? {}), ...TITLE_SHADOWS[incoming.shadow] },
      background: { ...(asRecord(block.background) ?? {}), ...TITLE_BOXES[incoming.box] },
    }
  }
  return JSON.stringify(root)
}

/** Панграмма: в ней все буквы — сразу видно, как шрифт справляется с кириллицей. */
export const TITLE_SAMPLE_TEXT =
  "Съешь же ещё этих мягких французских булок"
