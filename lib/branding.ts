/**
 * Оформление компании — docs/THEMING_PLAN.md §6.
 *
 * Чистый модуль: без базы и без `next/headers`, потому что его импортируют и
 * серверный layout, и клиентские шапки. Одно определение наборов, а не по копии
 * на слой.
 *
 * Компания переопределяет ТОЛЬКО акцент — 3 токена из 56. Остальные наследуются
 * от темы. Полная палитра на компанию была бы копией темы в базе: новый токен,
 * заведённый на сайте, в чужую палитру не приехал бы, и разошлись бы они молча.
 */
import { isHslToken } from "@/lib/color-contrast"

/**
 * Готовые наборы — быстрый путь, а не единственный (§6.2).
 *
 * Свой цвет тоже можно, парой значений, но он проходит проверку контраста
 * (lib/color-contrast.ts): цвет свободный, читаемость нет. Наборы остаются
 * потому, что подобрать пару «светлый/тёмный» на глаз умеет не каждый, а
 * попасть в читаемую пару с первого раза — тем более.
 *
 * Каждый набор — ПАРА значений: подобранный на тёмном фоне цвет на светлом
 * оказывается нечитаемым, и наоборот. Тема выбирается человеком, акцент задаёт
 * компания; это независимые оси, и они перемножаются.
 *
 * Текст на акценте (`--primary-foreground`) в набор не входит намеренно: в
 * светлой теме он белый, в тёмной почти чёрный — и это свойство ТЕМЫ, одинаковое
 * для всех наборов. Задавать его на компанию значило бы дать ей возможность
 * сделать кнопки нечитаемыми, ровно то, ради чего здесь набор, а не пипетка.
 */
export const ACCENT_PRESETS = {
  blue: { light: "214 85% 48%", dark: "214 88% 66%" },
  violet: { light: "266 72% 48%", dark: "268 85% 74%" },
  teal: { light: "184 80% 28%", dark: "174 70% 52%" },
  amber: { light: "30 90% 40%", dark: "38 92% 60%" },
  rose: { light: "344 78% 46%", dark: "344 85% 68%" },
  green: { light: "150 70% 30%", dark: "150 66% 52%" },
} as const

export type AccentKey = keyof typeof ACCENT_PRESETS
export const ACCENT_KEYS = Object.keys(ACCENT_PRESETS) as AccentKey[]
/** Акцент установки: тот же синий, каким сайт работает сейчас. */
export const DEFAULT_ACCENT: AccentKey = "blue"

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && value in ACCENT_PRESETS
}

/**
 * Пара цветов акцента — то, чем компания отличается.
 *
 * Хранится либо ИМЕНЕМ набора, либо парой своих значений. Имя, а не разложенная
 * пара, у наборов намеренно: подправим оттенок в коде — и он приедет всем, кто
 * его выбрал. Разложи мы набор в базу при выборе, каждая компания унесла бы с
 * собой снимок и осталась со старым цветом навсегда.
 */
export type AccentPair = { light: string; dark: string }
export type AccentValue = AccentKey | AccentPair

export function isAccentPair(value: unknown): value is AccentPair {
  if (typeof value !== "object" || value === null) return false
  const pair = value as Record<string, unknown>
  return isHslToken(pair.light) && isHslToken(pair.dark)
}

/** Значения акцента для обеих тем — независимо от того, набор это или свой цвет. */
export function accentPair(accent: AccentValue): AccentPair {
  return isAccentKey(accent) ? ACCENT_PRESETS[accent] : accent
}

/** Что лежит в `companies.branding`. Форма свободная — поэтому JSONB (план §3). */
export type CompanyBranding = {
  accent: AccentValue
  /** Адрес логотипа для показа. NULL — рисуем монограмму. */
  logoUrl: string | null
  /**
   * Ключ объекта в хранилище — рядом с адресом, а не вместо него.
   *
   * По нему удаляется прежний файл при замене и снятии логотипа. Разбирать ключ
   * обратно из адреса было бы хрупко: адрес может быть и путём прокси, и ссылкой
   * на CDN, и меняется от настроек установки, а ключ — то, что нам вернул
   * presign, и другого толкования у него нет.
   *
   * NULL у логотипов, заданных адресом вручную: чужой файл мы не удаляем.
   */
  logoKey: string | null
  /** Буквы значка. NULL — считаем из названия. */
  monogram: string | null
}

export function readBranding(raw: unknown): CompanyBranding {
  const value = (raw ?? {}) as Record<string, unknown>
  const monogram =
    typeof value.monogram === "string" && value.monogram.trim()
      ? value.monogram.trim().slice(0, 2).toUpperCase()
      : null
  const accent: AccentValue = isAccentKey(value.accent)
    ? value.accent
    : isAccentPair(value.accent)
      ? { light: value.accent.light.trim(), dark: value.accent.dark.trim() }
      : DEFAULT_ACCENT
  return {
    accent,
    logoUrl: typeof value.logoUrl === "string" && value.logoUrl ? value.logoUrl : null,
    logoKey: typeof value.logoKey === "string" && value.logoKey ? value.logoKey : null,
    monogram,
  }
}

/**
 * Префикс хранилища компании. Один источник для presign и для удаления: если
 * они разойдутся, удаление либо промахнётся, либо дотянется не туда.
 */
export function companyObjectPrefix(slug: string): string {
  return `companies/${slug}/`
}

/**
 * Можно ли удалять этот объект как файл ЭТОЙ компании.
 *
 * Проверка обязательна, потому что ключ приходит из базы, а туда он мог попасть
 * когда угодно и каким угодно. Удаление — необратимо, и единственная защита от
 * «снесли не то» — сверка префикса перед вызовом.
 */
export function isOwnCompanyObject(key: string, slug: string): boolean {
  return key.startsWith(companyObjectPrefix(slug)) && !key.includes("..")
}

/**
 * Монограмма из названия: первые буквы слов, не больше двух.
 *
 * Та же логика, что у `SITE_MONOGRAM` в lib/site.ts, и по той же причине —
 * считается, а не задаётся: иначе это второе место, где название можно забыть
 * поменять, и значок ещё год показывал бы чужие буквы.
 */
export function monogramFrom(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "??"
  )
}

/**
 * CSS переопределения акцента.
 *
 * `scope` пустой — глобально, для компании ВОШЕДШЕГО: правила садятся на
 * `:root`, поэтому их подхватывает и градиент подложки (`--bg-glow-1`
 * объявлен через `var(--primary)`).
 *
 * `scope` задан — локально, для компании ПРОСМАТРИВАЕМОЙ: так суперадмин видит
 * оформление клиента внутри консоли, но своя админка вокруг остаётся нашей.
 * Красить ему весь сайт в цвета клиента значило бы лишить его признака, где он
 * сейчас находится.
 */
export function accentCss(accent: AccentValue, scope?: string): string {
  const { light, dark } = accentPair(accent)
  const sel = scope ? `${scope}` : ":root"
  const lightSel = scope ? `[data-theme="light"] ${scope}` : `[data-theme="light"]`
  const vars = (value: string) =>
    `--primary:${value};--accent:${value};--ring:${value};`
  return `${sel}{${vars(dark)}}${lightSel}{${vars(light)}}`
}
