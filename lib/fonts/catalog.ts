/**
 * Витрина шрифтов — docs/FONTS_PLAN.md §8.
 *
 * Чистый модуль без обращений к хранилищу: тем же кодом читает страница, пишет
 * сервер и проверяет приёмка — как у lib/options/title.ts.
 *
 * Список отобран вручную и живёт в коде, а не в базе: это решение о вкусе, оно
 * меняется правкой с обсуждением, а не из интерфейса. Письменности (`scripts`)
 * не выдуманы — они взяты из `subsets` метаданных Google Fonts
 * (https://fonts.google.com/metadata/fonts, снимок 2026-09-17).
 */

export const FONT_SCRIPTS = [
  "latin",
  "cyrillic",
  "greek",
  "vietnamese",
  "japanese",
  "korean",
  "chineseSimplified",
  "chineseTraditional",
  "thai",
  "arabic",
  "hebrew",
  "devanagari",
] as const
export type FontScript = (typeof FONT_SCRIPTS)[number]

/** Раскладка витрины — по назначению, а не по алфавиту. */
export const FONT_GROUPS = [
  "sans",
  "narrow",
  "serif",
  "display",
  "handwriting",
  "mono",
] as const
export type FontGroup = (typeof FONT_GROUPS)[number]

/** Лица, которые мы вообще умеем забирать с Google (оси запроса css2). */
export const FONT_FACES = ["regular", "bold", "italic", "boldItalic"] as const
export type FontFaceId = (typeof FONT_FACES)[number]

export type FontEntry = {
  family: string
  group: FontGroup
  scripts: FontScript[]
  /** Есть ли у семейства жирное лицо и курсив — из метаданных Google. */
  bold: boolean
  italic: boolean
  /**
   * Системный шрифт, который это семейство закрывает (§5 плана).
   *
   * Нужно не для красоты: в старых проектах в настройках стоит «Arial», а
   * положить его файл в библиотеку мы не вправе — это шрифт Monotype. Подпись
   * «вместо Arial» — единственный способ объяснить клиенту, что выбрать.
   */
  replaces?: string
}

/**
 * Иероглифические письменности: у такого семейства одно лицо весит мегабайты
 * (Noto Sans JP — 5,3 МБ, Noto Sans KR — 6,2 МБ, измерено 2026-09-17), поэтому
 * берём два лица вместо четырёх — см. §4 плана.
 */
const HEAVY_SCRIPTS: readonly FontScript[] = [
  "japanese",
  "korean",
  "chineseSimplified",
  "chineseTraditional",
]

export const FONT_CATALOG: readonly FontEntry[] = [
  // ── гротески ───────────────────────────────────────────────────────────────
  { family: "Roboto", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Open Sans", group: "sans", scripts: ["cyrillic", "greek", "hebrew", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Inter", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Montserrat", group: "sans", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "PT Sans", group: "sans", scripts: ["cyrillic", "latin"], bold: true, italic: true, replaces: "Verdana" },
  { family: "Fira Sans", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true, replaces: "Trebuchet MS" },
  { family: "Noto Sans", group: "sans", scripts: ["cyrillic", "devanagari", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Rubik", group: "sans", scripts: ["arabic", "cyrillic", "hebrew", "latin"], bold: true, italic: true },
  { family: "Nunito", group: "sans", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Manrope", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Golos Text", group: "sans", scripts: ["cyrillic", "latin"], bold: true, italic: false },
  { family: "Onest", group: "sans", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Raleway", group: "sans", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Jost", group: "sans", scripts: ["cyrillic", "latin"], bold: true, italic: true },
  { family: "Ubuntu", group: "sans", scripts: ["cyrillic", "greek", "latin"], bold: true, italic: true },
  { family: "Arimo", group: "sans", scripts: ["cyrillic", "greek", "hebrew", "latin", "vietnamese"], bold: true, italic: true, replaces: "Arial" },
  { family: "Source Sans 3", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "IBM Plex Sans", group: "sans", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },

  // ── узкие: длинная строка целиком в кадре ──────────────────────────────────
  { family: "Roboto Condensed", group: "narrow", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Oswald", group: "narrow", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Fira Sans Condensed", group: "narrow", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Cuprum", group: "narrow", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Exo 2", group: "narrow", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },

  // ── с засечками ────────────────────────────────────────────────────────────
  { family: "PT Serif", group: "serif", scripts: ["cyrillic", "latin"], bold: true, italic: true, replaces: "Georgia" },
  { family: "Lora", group: "serif", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Merriweather", group: "serif", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Noto Serif", group: "serif", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Roboto Slab", group: "serif", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: false },
  { family: "EB Garamond", group: "serif", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Alegreya", group: "serif", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Tinos", group: "serif", scripts: ["cyrillic", "greek", "hebrew", "latin", "vietnamese"], bold: true, italic: true, replaces: "Times New Roman" },
  { family: "Literata", group: "serif", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Spectral", group: "serif", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },

  // ── акцидентные: заголовок, а не текст ─────────────────────────────────────
  { family: "Russo One", group: "display", scripts: ["cyrillic", "latin"], bold: false, italic: false },
  { family: "Unbounded", group: "display", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Yeseva One", group: "display", scripts: ["cyrillic", "latin", "vietnamese"], bold: false, italic: false },
  { family: "Comfortaa", group: "display", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Tektur", group: "display", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Prosto One", group: "display", scripts: ["cyrillic", "latin"], bold: false, italic: false },

  // ── рукописные ─────────────────────────────────────────────────────────────
  { family: "Caveat", group: "handwriting", scripts: ["cyrillic", "latin"], bold: true, italic: false },
  { family: "Marck Script", group: "handwriting", scripts: ["cyrillic", "latin"], bold: false, italic: false },
  { family: "Amatic SC", group: "handwriting", scripts: ["cyrillic", "hebrew", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Pacifico", group: "handwriting", scripts: ["cyrillic", "latin", "vietnamese"], bold: false, italic: false },

  // ── моноширинные ───────────────────────────────────────────────────────────
  { family: "Roboto Mono", group: "mono", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "JetBrains Mono", group: "mono", scripts: ["cyrillic", "greek", "latin", "vietnamese"], bold: true, italic: true },
  { family: "IBM Plex Mono", group: "mono", scripts: ["cyrillic", "latin", "vietnamese"], bold: true, italic: true },
  { family: "Cousine", group: "mono", scripts: ["cyrillic", "greek", "hebrew", "latin", "vietnamese"], bold: true, italic: true, replaces: "Courier New" },

  // ── японская ───────────────────────────────────────────────────────────────
  { family: "Noto Sans JP", group: "sans", scripts: ["cyrillic", "japanese", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Noto Serif JP", group: "serif", scripts: ["cyrillic", "japanese", "latin", "vietnamese"], bold: true, italic: false },
  { family: "M PLUS Rounded 1c", group: "sans", scripts: ["cyrillic", "greek", "hebrew", "japanese", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Zen Maru Gothic", group: "display", scripts: ["cyrillic", "greek", "japanese", "latin"], bold: true, italic: false },

  // ── корейская ──────────────────────────────────────────────────────────────
  { family: "Noto Sans KR", group: "sans", scripts: ["cyrillic", "korean", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Nanum Gothic", group: "sans", scripts: ["korean", "latin"], bold: true, italic: false },
  { family: "Black Han Sans", group: "display", scripts: ["korean", "latin"], bold: false, italic: false },

  // ── китайская ──────────────────────────────────────────────────────────────
  { family: "Noto Sans SC", group: "sans", scripts: ["chineseSimplified", "cyrillic", "latin", "vietnamese"], bold: true, italic: false },
  { family: "Noto Sans TC", group: "sans", scripts: ["chineseTraditional", "cyrillic", "latin", "vietnamese"], bold: true, italic: false },

  // ── тайская ────────────────────────────────────────────────────────────────
  { family: "Noto Sans Thai", group: "sans", scripts: ["latin", "thai"], bold: true, italic: false },
  { family: "Noto Serif Thai", group: "serif", scripts: ["latin", "thai"], bold: true, italic: false },
  { family: "Kanit", group: "sans", scripts: ["latin", "thai", "vietnamese"], bold: true, italic: true },
  { family: "Prompt", group: "sans", scripts: ["latin", "thai", "vietnamese"], bold: true, italic: true },
  { family: "Sarabun", group: "sans", scripts: ["latin", "thai", "vietnamese"], bold: true, italic: true },
  { family: "IBM Plex Sans Thai", group: "sans", scripts: ["latin", "thai"], bold: true, italic: false },

  // ── арабская, иврит, деванагари ────────────────────────────────────────────
  { family: "Noto Sans Arabic", group: "sans", scripts: ["arabic", "latin"], bold: true, italic: false },
  { family: "Cairo", group: "sans", scripts: ["arabic", "latin"], bold: true, italic: false },
  { family: "Noto Sans Hebrew", group: "sans", scripts: ["hebrew", "latin"], bold: true, italic: false },
  { family: "Heebo", group: "sans", scripts: ["hebrew", "latin"], bold: true, italic: false },
  { family: "Noto Sans Devanagari", group: "sans", scripts: ["devanagari", "latin"], bold: true, italic: false },
]

const BY_FAMILY = new Map(FONT_CATALOG.map((entry) => [entry.family, entry]))

export function findFontEntry(family: string): FontEntry | null {
  return BY_FAMILY.get(family.trim()) ?? null
}

/** Иероглифическое семейство: мегабайты на лицо, поэтому лиц берём меньше. */
export function isHeavyFamily(entry: FontEntry): boolean {
  return entry.scripts.some((script) => HEAVY_SCRIPTS.includes(script))
}

/**
 * Какие лица забираем и как называются их файлы.
 *
 * Имена — РОВНО те, что даёт программа (`deps_download_font` в
 * deps_commands.rs): обычное лицо носит имя семейства, остальные добавляют
 * « Bold» и « Italic». Разойдись здесь именование — `ensureProjectFont` на
 * машине не нашёл бы шрифт, который сайт положил в проект.
 */
export function facesOf(entry: FontEntry): Array<{
  id: FontFaceId
  stem: string
  weight: 400 | 700
  italic: boolean
}> {
  const heavy = isHeavyFamily(entry)
  const faces: Array<{ id: FontFaceId; stem: string; weight: 400 | 700; italic: boolean }> = [
    { id: "regular", stem: entry.family, weight: 400, italic: false },
  ]
  if (entry.bold) {
    faces.push({ id: "bold", stem: `${entry.family} Bold`, weight: 700, italic: false })
  }
  // Курсив у тяжёлых не берём: у CJK-шрифтов он всё равно синтетический, а лицо
  // стоит пяти мегабайт в каждом проекте, который выбрал это семейство.
  if (entry.italic && !heavy) {
    faces.push({ id: "italic", stem: `${entry.family} Italic`, weight: 400, italic: true })
    if (entry.bold) {
      faces.push({
        id: "boldItalic",
        stem: `${entry.family} Bold Italic`,
        weight: 700,
        italic: true,
      })
    }
  }
  return faces
}

/**
 * Единый способ сравнить имена шрифтов — порт `normalizeFontName` из
 * projectFonts.ts программы. Дублирование осознанное, как у process-queue.ts:
 * разойдись это сравнение — сайт считал бы шрифт уже лежащим в проекте там, где
 * машина его не находит.
 */
export function normalizeFontName(name: string): string {
  return name.toLowerCase().replace(/[-_ ]/g, "")
}

/**
 * Имя шрифта приходит от клиента и становится частью URL, имени файла и строки
 * ASS. Проверка — та же, что в программе (`check_font_family`): латиница,
 * цифры, пробел и дефис, не длиннее 64.
 */
export function isValidFontName(name: string): boolean {
  const value = name.trim()
  return (
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9 -]+$/.test(value)
  )
}
