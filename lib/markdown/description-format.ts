/**
 * Формат описания проекта: палитра и схема санитайза.
 *
 * ⚠️ ЭТО ПОЛОВИНА КОНТРАКТА. Вторая половина — редактор в программе
 * (`fs.manager.tauri`, `src/components/markdown/markdownFormat.ts`), и он
 * обязан повторять те же имена классов и ту же схему. Правила и обоснование —
 * docs/DESCRIPTION_FORMAT.md, зеркало документа лежит в репозитории программы.
 * Менять что-то здесь = менять контракт, а значит и клиента.
 *
 * Суть договорённости: файл `options/description.md` — это markdown
 * (CommonMark + GFM), а то, чего в markdown нет (цвет, заливка, подчёркивание,
 * выравнивание, красная строка), выражается закрытым списком HTML-тегов с
 * классами. Именно КЛАССАМИ, а не `style`: имя класса маппится в токен темы
 * (UI_TOKENS §2), а `#hex` в файле прибит навсегда и мимо дизайн-системы. Плюс
 * содержимое `style` санитайзером надёжно не отфильтровать — это разбор CSS,
 * тогда как список допустимых значений `class` проверяется точно.
 *
 * Цветов здесь нет намеренно: имя → токен превращается в CSS
 * (`app/globals.css`, область `.md-palette`), а не в TypeScript.
 */

import { defaultSchema } from "rehype-sanitize"
// `Options` у rehype-sanitize — это и есть `Schema` из hast-util-sanitize. Тип
// нужен явно: без него литерал выводится как `(string | (string | RegExp)[])[]`,
// а плагин ждёт кортежи `PropertyDefinition`, и unified схему не принимает.
import type { Options as SanitizeSchema } from "rehype-sanitize"

// ─── Палитра ────────────────────────────────────────────────────────────────

/** Оттенки: имя класса `fg-<key>` / `bg-<key>`. Порядок — как в контракте §3. */
export const MARKDOWN_HUES = [
  "blue",
  "green",
  "orange",
  "red",
  "yellow",
  "teal",
  "purple",
  "cyan",
  "pink",
  "muted",
] as const

export type MarkdownHue = (typeof MARKDOWN_HUES)[number]

/**
 * Ступени насыщенности: суффикс в имени класса. Сама ступень — прозрачность
 * того же токена (приём из UI_TOKENS §2.7), поэтому обе стороны получают
 * одинаковый результат из одного имени, а новых цветов не появляется.
 */
export const MARKDOWN_TONES = ["", "-2", "-3"] as const

/**
 * Серая шкала — отдельная, от белого до чёрного, без ступеней насыщенности.
 * Это «текст потише/поярче», а не цвет.
 */
export const MARKDOWN_GRAYS = [
  "gray-0",
  "gray-1",
  "gray-2",
  "gray-3",
  "gray-4",
  "gray-5",
] as const

/** Все имена цветов: 10 оттенков × 3 ступени + 6 серых. */
export const COLOR_KEYS: string[] = [
  ...MARKDOWN_HUES.flatMap((hue) => MARKDOWN_TONES.map((tone) => `${hue}${tone}`)),
  ...MARKDOWN_GRAYS,
]

export const FG_CLASSES = COLOR_KEYS.map((key) => `fg-${key}`)
export const BG_CLASSES = COLOR_KEYS.map((key) => `bg-${key}`)

export type AlignKind = "left" | "center" | "right" | "justify"

export const ALIGN_KINDS: AlignKind[] = ["left", "center", "right", "justify"]
export const ALIGN_CLASSES = ALIGN_KINDS.map((kind) => `align-${kind}`)

// ─── Санитайз ───────────────────────────────────────────────────────────────

/**
 * Допустимые схемы у картинки: обычная ссылка или встроенный base64. `data:`
 * нужен потому, что картинки лежат ВНУТРИ файла описания (контракт §4), но
 * пускать любой `data:` нельзя — отсюда проверка типа.
 */
const IMG_SRC = [/^https?:\/\//, /^data:image\/(png|jpeg|webp|gif);base64,/]

/**
 * Общие атрибуты. Дефолтная (github-совместимая) схема разрешает `width`,
 * `height`, `align`, `color`, `size`, `border` в общем списке `'*'` — то есть
 * ровно те жёсткие размеры, из-за которых вёрстка рассыпается на узком экране.
 * Поэтому список задаётся заново, а не расширяется.
 */
const COMMON_ATTRS = [
  "alt",
  "title",
  "colSpan",
  "rowSpan",
  "scope",
  "dir",
  "lang",
  "start",
  "open",
  "checked",
  "disabled",
  "type",
  "ariaLabel",
  "ariaHidden",
  "ariaDescribedBy",
  "ariaLabelledBy",
]

/**
 * Схема санитайза — контракт §7, копируется дословно с обеих сторон.
 *
 * Форма `[['className', 'a', 'b']]` — «атрибут разрешён только с этими
 * значениями», то есть палитра закрыта на уровне санитайзера, а не на честном
 * слове редактора. Неизвестное имя вырезается: текст остаётся читаемым, просто
 * без цвета.
 */
export const descriptionSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u", "mark"],
  attributes: {
    ...defaultSchema.attributes,
    "*": COMMON_ATTRS,
    // Выравнивание колонок GFM-таблицы едет атрибутом `align` на th/td (не
    // через style) — его ставит сам конвейер markdown, а не автор описания.
    th: ["align"],
    td: ["align"],
    span: [["className", ...FG_CLASSES, ...BG_CLASSES]],
    div: [["className", ...ALIGN_CLASSES]],
    p: [["className", "indent"]],
    img: [["src", ...IMG_SRC], "alt", "title"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data"],
  },
}

/**
 * Схема для СВОЕГО текста — статей справки из `content/help/`.
 *
 * Отличие ровно одно: картинке разрешён путь от корня сайта (`/help/…`), чтобы
 * иллюстрации лежали в том же адресном пространстве, что и статья.
 *
 * Описанию проекта такое нельзя, и это не перестраховка: файл приходит из
 * программы и правится кем угодно, поэтому ссылка «на свой домен» внутри него —
 * всё равно чужая ссылка. Статью же пишем мы, и лежит она в репозитории.
 * `//host` при этом отсекается: это внешний адрес, только записанный коротко.
 *
 * Всё прочее совпадает намеренно. Две разошедшиеся схемы санитайза — это две
 * поверхности для аудита вместо одной.
 */
export const ownContentSanitizeSchema: SanitizeSchema = {
  ...descriptionSanitizeSchema,
  attributes: {
    ...descriptionSanitizeSchema.attributes,
    img: [["src", ...IMG_SRC, /^\/(?!\/)/], "alt", "title"],
  },
}

// ─── Прочие константы контракта ─────────────────────────────────────────────

/**
 * Мягкий предел размера (контракт §1): дальше предупреждаем автора. Файл едет
 * целиком на каждое сохранение, а base64-картинки добавляют к весу ещё треть.
 */
export const DESCRIPTION_SIZE_WARN = 2 * 1024 * 1024

/**
 * Жёсткий предел записи — его проверяет роут `PUT .../description`.
 *
 * Стоит выше предупреждения не просто так: одна картинка 1600 px в webp — это
 * ~150 КБ, а в base64 (контракт §4) ~200 КБ. Прежние 200 000 символов в
 * zod-схеме роута отбивали бы 400 на описании с одной-двумя картинками, то
 * есть на нормальном описании.
 */
export const DESCRIPTION_SIZE_MAX = 8 * 1024 * 1024

/** Картинки при вставке уменьшаются до этого размера по длинной стороне. */
export const IMAGE_MAX_SIDE = 1600
export const IMAGE_QUALITY = 0.8
