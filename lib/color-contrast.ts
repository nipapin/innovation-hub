/**
 * Контраст цвета — то, что делает свободный выбор акцента безопасным.
 *
 * Чистый модуль: без базы и без React, потому что считать одно и то же должны
 * оба слоя. Экран показывает отношение живьём, сервер тем же кодом отказывает —
 * проверка, живущая только в интерфейсе, не проверка.
 *
 * Зачем вообще: акцент — это фон КНОПКИ. Текст на нём не задаётся ни темой, ни
 * компанией, а подбирается под сам фон (`readableOn`): на тёмном — светлый, на
 * светлом — тёмный. Так кнопка читается при любом цвете, какой бы ни выбрала
 * компания, и проверять её цвет на читаемость подписи больше не нужно.
 */

/**
 * Чернила темы — те же, что `--primary-foreground` в app/globals.css: белый и
 * почти чёрный. Чистый чёрный — запасной: с почти-чёрным на фоне средней
 * светлоты не дотягивает ни один из двух (худший случай ~4.24), а лучший из
 * белого и чистого чёрного даёт не меньше ~4.59 на любом фоне.
 */
const INK_LIGHT = "0 0% 100%"
const INK_DARK = "224 44% 11%"
const INK_BLACK = "0 0% 0%"

/** На сколько процентов светлоты кнопка меняется при наведении. */
const HOVER_STEP = 6

/**
 * Порог AA для обычного текста. Не 3:1 («крупный текст и элементы
 * интерфейса»): подпись на кнопке у нас 13–14px обычного начертания, и послабление
 * для крупного к ней не относится.
 */
export const MIN_CONTRAST = 4.5

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }

export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "")
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l: l * 100 }

  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4

  return { h: ((h * 60) % 360 + 360) % 360, s: s * 100, l: l * 100 }
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/**
 * Токены хранятся строкой «H S% L%» — в этом виде их ждёт CSS.
 *
 * Десятая доля, а не целое: на целых круг hex → HSL → hex промахивается на
 * единицу в канале (`#2563eb` возвращался как `#2463eb`). Глазу это незаметно,
 * но человек, вставивший фирменный код цвета, увидел бы в поле ДРУГОЙ код и
 * решил бы, что его правку не сохранили.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function hslToToken({ h, s, l }: Hsl): string {
  return `${round1(h)} ${round1(s)}% ${round1(l)}%`
}

export function tokenToHex(token: string): string {
  const [h, s, l] = token.split(/\s+/).map((part) => Number.parseFloat(part))
  const { r, g, b } = hslToRgb(h || 0, s || 0, l || 0)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

export function isHslToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/.test(value.trim())
  )
}

function channelLuminance(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function parseToken(token: string): Hsl {
  const [h, s, l] = token.split(/\s+/).map((part) => Number.parseFloat(part))
  return { h: h || 0, s: s || 0, l: l || 0 }
}

function tokenToRgb(token: string): Rgb {
  const { h, s, l } = parseToken(token)
  return hslToRgb(h, s, l)
}

/**
 * Цвет текста, читаемый на фоне `token`: тёмный фон — светлые буквы, светлый —
 * тёмные. Сначала пробуем чернила темы — так у готовых наборов подпись остаётся
 * привычной; если ни одно не даёт порога, берём лучшее из белого и чистого
 * чёрного, которое проходит всегда.
 */
export function readableOn(token: string): string {
  const bg = tokenToRgb(token)
  const onLight = contrastRatio(bg, tokenToRgb(INK_LIGHT))
  const onDark = contrastRatio(bg, tokenToRgb(INK_DARK))
  if (Math.max(onLight, onDark) >= MIN_CONTRAST) {
    return onLight >= onDark ? INK_LIGHT : INK_DARK
  }
  return onLight >= contrastRatio(bg, tokenToRgb(INK_BLACK)) ? INK_LIGHT : INK_BLACK
}

/**
 * Фон кнопки при наведении. Сдвигаем светлоту ОТ цвета текста: под светлыми
 * буквами кнопка темнеет, под тёмными — светлеет. Так при наведении контраст
 * подписи только растёт, и проверять второй цвет отдельно не нужно.
 */
export function hoverOf(token: string): string {
  const { h, s, l } = parseToken(token)
  const step = readableOn(token) === INK_LIGHT ? -HOVER_STEP : HOVER_STEP
  return hslToToken({ h, s, l: Math.min(100, Math.max(0, l + step)) })
}

/** Читаемость акцента: отношение к тексту, который на нём окажется. */
export function accentContrast(token: string): number {
  return contrastRatio(tokenToRgb(token), tokenToRgb(readableOn(token)))
}
