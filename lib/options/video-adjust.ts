/**
 * Смена формата кадра: разбор значения `videoAdjustSettings` —
 * docs/VIDEO_ADJUST_CONTROL_PLAN.md.
 *
 * Чистый модуль без обращений к хранилищу, как lib/options/overlay.ts: тем же
 * кодом читает страница, пишет сервер и проверяет приёмка.
 *
 * Значение — СТРОКА с JSON. Сайт правит шесть полей и блок тени; всё остальное
 * (`encode`, `finalFormat`, `copies`, `bgColor`, пути превью) принадлежит
 * программе и возвращается нетронутым.
 */

/** Границы — те же, что в программе (VideoAdjustEdit/types.ts). */
export const VIDEO_ADJUST_LIMITS = {
  fitPercent: { min: 0, max: 100, step: 1 },
  blur: { min: 0, max: 50, step: 0.5 },
  brightness: { min: -1, max: 1, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  saturation: { min: 0, max: 3, step: 0.01 },
  shadowBlur: { min: 0, max: 60, step: 1 },
  shadowSpread: { min: 0, max: 200, step: 1 },
  shadowOffset: { min: -100, max: 100, step: 1 },
  shadowOpacity: { min: 0, max: 1, step: 0.05 },
} as const

export type BgAdjust = {
  /** px, 0–50 */
  blur: number
  /** −1…+1, 0 — без изменений */
  brightness: number
  /** 0…3, 1 — без изменений */
  contrast: number
  /** 0…3, 1 — без изменений */
  saturation: number
  hFlip: boolean
}

export type FgShadow = {
  enabled: boolean
  blur: number
  /** Раздувание прямоугольника тени. При blur = 0 и нулевом смещении — рамка. */
  spread: number
  offsetX: number
  offsetY: number
  opacity: number
  /** hex, `#000000`. */
  color: string
}

/** Только то, что правит сайт. Остальное живёт в файле и сюда не попадает. */
export type VideoAdjustValue = {
  useFgAsBg: boolean
  /** 0 — вписать целиком, 100 — заполнить с обрезкой. */
  fitPercent: number
  shadow: FgShadow
  bg: BgAdjust
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

/** Умолчания программы (`defaultVideoAdjustSettings`). */
export function defaultVideoAdjust(): VideoAdjustValue {
  return {
    useFgAsBg: true,
    fitPercent: 0,
    shadow: {
      enabled: false,
      blur: 20,
      spread: 0,
      offsetX: 10,
      offsetY: 20,
      opacity: 0.6,
      color: "#000000",
    },
    bg: { blur: 0, brightness: 0, contrast: 1, saturation: 1, hFlip: false },
  }
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * Строка значения → то, что правит сайт.
 *
 * Мусор и пустая строка дают умолчания, а не ошибку: свойство могло ни разу не
 * открываться, и отказ закрыл бы клиенту настройку, которую он пришёл задать.
 */
export function parseVideoAdjustValue(raw: unknown): VideoAdjustValue {
  const fallback = defaultVideoAdjust()
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

  const fg = asRecord(obj.fg) ?? {}
  const shadow = asRecord(fg.shadow) ?? {}
  const bg = asRecord(obj.bg) ?? {}
  const adjust = asRecord(bg.adjust) ?? {}
  const L = VIDEO_ADJUST_LIMITS

  return {
    useFgAsBg: obj.useFgAsBg !== false,
    fitPercent: clamp(
      num(fg.fitPercent, fallback.fitPercent),
      L.fitPercent.min,
      L.fitPercent.max,
    ),
    shadow: {
      enabled: shadow.enabled === true,
      blur: clamp(num(shadow.blur, fallback.shadow.blur), L.shadowBlur.min, L.shadowBlur.max),
      spread: clamp(num(shadow.spread, fallback.shadow.spread), L.shadowSpread.min, L.shadowSpread.max),
      offsetX: clamp(num(shadow.offsetX, fallback.shadow.offsetX), L.shadowOffset.min, L.shadowOffset.max),
      offsetY: clamp(num(shadow.offsetY, fallback.shadow.offsetY), L.shadowOffset.min, L.shadowOffset.max),
      opacity: clamp(num(shadow.opacity, fallback.shadow.opacity), L.shadowOpacity.min, L.shadowOpacity.max),
      color:
        typeof shadow.color === "string" && HEX.test(shadow.color)
          ? shadow.color
          : fallback.shadow.color,
    },
    bg: {
      blur: clamp(num(adjust.blur, fallback.bg.blur), L.blur.min, L.blur.max),
      brightness: clamp(num(adjust.brightness, fallback.bg.brightness), L.brightness.min, L.brightness.max),
      contrast: clamp(num(adjust.contrast, fallback.bg.contrast), L.contrast.min, L.contrast.max),
      saturation: clamp(num(adjust.saturation, fallback.bg.saturation), L.saturation.min, L.saturation.max),
      hFlip: adjust.hFlip === true,
    },
  }
}

/**
 * Слияние правки клиента в ТЕКУЩЕЕ значение из файла.
 *
 * Правило то же, что у наложения: сайт правит перечисленные поля, всё прочее
 * берётся из файла. Слияние делает сервер, а не браузер: страница могла
 * открыться до того, как в программе добавили новое поле, и доверие клиенту
 * означало бы, что старая вкладка молча стирает то, чего она не видела.
 *
 * Вложенность сохраняется по-честному: у `fg` и `bg` есть свои `copies`,
 * которые сайту не видны и обязаны пережить запись.
 */
export function mergeVideoAdjustValue(
  currentRaw: unknown,
  incoming: VideoAdjustValue,
): string {
  let root: Record<string, unknown> = {}
  if (typeof currentRaw === "string" && currentRaw.trim()) {
    try {
      const parsed = JSON.parse(currentRaw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>
      }
    } catch {
      // Значение в файле испорчено — пишем поверх, сохранять нечего.
    }
  }

  const fg = asRecord(root.fg) ?? {}
  const bg = asRecord(root.bg) ?? {}
  const shadow = asRecord(fg.shadow) ?? {}
  const adjust = asRecord(bg.adjust) ?? {}

  root.useFgAsBg = incoming.useFgAsBg
  root.fg = {
    ...fg,
    fitPercent: Math.round(incoming.fitPercent),
    shadow: { ...shadow, ...incoming.shadow },
  }
  root.bg = { ...bg, adjust: { ...adjust, ...incoming.bg } }
  return JSON.stringify(root)
}

/**
 * CSS-фильтр фона — порт `buildCanvasFilter` из программы.
 *
 * Дублирование осознанное и того же класса, что numeric-format.ts: разойдись
 * здесь формула — на сайте показывалось бы одно, а в ролик уходило другое.
 * Пустая строка означает «фильтра нет».
 */
export function buildBgFilter(bg: BgAdjust): string {
  const parts: string[] = []
  if (bg.blur > 0) parts.push(`blur(${bg.blur}px)`)
  if (Math.abs(bg.brightness) > 0.001) {
    parts.push(`brightness(${Math.max(0, 1 + bg.brightness).toFixed(3)})`)
  }
  if (Math.abs(bg.contrast - 1) > 0.001) {
    parts.push(`contrast(${bg.contrast.toFixed(3)})`)
  }
  if (Math.abs(bg.saturation - 1) > 0.001) {
    parts.push(`saturate(${bg.saturation.toFixed(3)})`)
  }
  return parts.join(" ")
}

export type FrameOrientation = "landscape" | "portrait" | "square"

/**
 * Формат выхода — порт `oppositeFormat`. В этом и смысл ноды: вертикальный
 * ролик из горизонтального и наоборот.
 */
export function oppositeFormat(orientation: FrameOrientation): [number, number] {
  return orientation === "portrait" ? [1920, 1080] : [1080, 1920]
}

/** Пропорции образца на входе. Только для превью — в значение не идут. */
export function sampleAspect(orientation: FrameOrientation): [number, number] {
  if (orientation === "landscape") return [1920, 1080]
  if (orientation === "portrait") return [1080, 1920]
  return [1080, 1080]
}
