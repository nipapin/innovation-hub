/**
 * Наложение логотипа: разбор значения `overlaySettings` —
 * docs/OVERLAY_CONTROL_PLAN.md.
 *
 * Чистый модуль без обращений к хранилищу: тем же кодом читает страница, пишет
 * сервер и проверяет приёмка. Разойдись эти три разбора — расхождение вылезло бы
 * не ошибкой, а сдвинутым логотипом в готовом ролике.
 *
 * Значение свойства — СТРОКА с JSON. Внутри три блока геометрии и служебные
 * поля программы, которые сайт не показывает и не трогает.
 */

/** Три дизайн-пространства. Выбор при обработке — по ориентации кадра. */
export const OVERLAY_FORMATS = ["landscape", "portrait", "square"] as const
export type OverlayFormat = (typeof OVERLAY_FORMATS)[number]

/**
 * Размеры заготовок — те же, что в программе
 * (`defaultOverlaySettings()` в OverlayEdit/types.ts).
 *
 * Это не «настройки по умолчанию», а система координат: `posX`/`scaleW` внутри
 * блока измеряются в пикселях ЭТОЙ заготовки, а при обработке умножаются на
 * `реальный кадр / bgWidth`.
 */
export const OVERLAY_DESIGN_SIZE: Record<
  OverlayFormat,
  { width: number; height: number }
> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
}

export type OverlayGeometry = {
  bgWidth: number
  bgHeight: number
  posX: number
  posY: number
  scaleW: number
  scaleH: number
  /** Градусы. 0 — без поворота. */
  rotation: number
}

export type OverlayValue = Record<OverlayFormat, OverlayGeometry>

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Умолчание программы: логотип 60 % ширины по центру
 * (`makeCenteredFG` в OverlayEdit/types.ts). Повторено здесь, потому что блока
 * может не оказаться вовсе — у свойства, которое ни разу не открывали.
 */
export function defaultGeometry(format: OverlayFormat): OverlayGeometry {
  const { width, height } = OVERLAY_DESIGN_SIZE[format]
  const scaleW = Math.round(width * 0.6)
  const scaleH = Math.round(height * 0.6)
  return {
    bgWidth: width,
    bgHeight: height,
    posX: Math.round((width - scaleW) / 2),
    posY: Math.round((height - scaleH) / 2),
    scaleW,
    scaleH,
    rotation: 0,
  }
}

function readGeometry(raw: unknown, format: OverlayFormat): OverlayGeometry {
  const fallback = defaultGeometry(format)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback
  const obj = raw as Record<string, unknown>
  return {
    // Размер заготовки берём из файла, если он там есть: автор графа мог
    // завести своё пространство, и подменять его нашим значило бы сдвинуть всю
    // геометрию разом.
    bgWidth: num(obj.bgWidth, fallback.bgWidth),
    bgHeight: num(obj.bgHeight, fallback.bgHeight),
    posX: num(obj.posX, fallback.posX),
    posY: num(obj.posY, fallback.posY),
    scaleW: num(obj.scaleW, fallback.scaleW),
    scaleH: num(obj.scaleH, fallback.scaleH),
    rotation: num(obj.rotation, 0),
  }
}

/**
 * Строка значения → геометрия трёх форматов.
 *
 * Мусор и пустая строка дают умолчания, а не ошибку: свойство могло ни разу не
 * открываться, и отказ на этом месте закрыл бы клиенту настройку, которую он
 * как раз пришёл задать.
 */
export function parseOverlayValue(raw: unknown): OverlayValue {
  let root: unknown = null
  if (typeof raw === "string" && raw.trim()) {
    try {
      root = JSON.parse(raw)
    } catch {
      root = null
    }
  } else if (raw && typeof raw === "object") {
    // Программа хранит строку, но чужой инструмент мог положить объект.
    root = raw
  }
  const obj =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {}
  return {
    landscape: readGeometry(obj.landscape, "landscape"),
    portrait: readGeometry(obj.portrait, "portrait"),
    square: readGeometry(obj.square, "square"),
  }
}

/**
 * Слияние правки клиента в ТЕКУЩЕЕ значение из файла.
 *
 * Главное правило этапа: сайт правит три блока геометрии, а не переписывает
 * значение целиком. Всё, чего он не знает (`encode`, `fgFilePath`,
 * `bgFilePath`, любое будущее поле), берётся из файла и возвращается на место.
 *
 * Слияние делает СЕРВЕР, а не браузер, хотя браузер и получает значение
 * целиком: страница могла открыться до того, как в программе добавили новое
 * поле, и доверие клиенту означало бы, что старая вкладка молча стирает то,
 * чего она не видела.
 *
 * `bgWidth`/`bgHeight` тоже берутся из файла: это масштаб системы координат, а
 * не настройка. Клиент двигает логотип внутри заготовки, а не меняет заготовку.
 */
export function mergeOverlayValue(
  currentRaw: unknown,
  incoming: OverlayValue,
): string {
  let root: Record<string, unknown> = {}
  if (typeof currentRaw === "string" && currentRaw.trim()) {
    try {
      const parsed = JSON.parse(currentRaw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>
      }
    } catch {
      // Значение в файле испорчено — пишем поверх. Сохранять нечего.
    }
  }

  const current = parseOverlayValue(currentRaw)
  for (const format of OVERLAY_FORMATS) {
    const block = incoming[format]
    root[format] = {
      // Сохраняем и чужие поля внутри самого блока, если они там были.
      ...(root[format] && typeof root[format] === "object" && !Array.isArray(root[format])
        ? (root[format] as Record<string, unknown>)
        : {}),
      bgWidth: current[format].bgWidth,
      bgHeight: current[format].bgHeight,
      posX: Math.round(block.posX),
      posY: Math.round(block.posY),
      scaleW: Math.round(block.scaleW),
      scaleH: Math.round(block.scaleH),
      rotation: block.rotation,
    }
  }
  return JSON.stringify(root)
}
