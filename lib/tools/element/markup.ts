/**
 * Разметка текста элемента: `<фрагмент>[Bold, #FF3B30, x1.5, "тег"]`.
 *
 * ⚠️ ЭТО ПОЛОВИНА КОНТРАКТА. Вторая половина — скрипт в After Effects
 * (`jsx/` в репозитории программы). Канонический текст грамматики —
 * docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §8.2, и менять что-то здесь = менять
 * контракт.
 *
 * Файл — обычный `.txt` в UTF-8, не HTML и не markdown: переносы строк и любые
 * символы допустимы как есть.
 *
 * Свойства распознаются ПО ФОРМЕ, без ключей — так парсеру в ES3 (язык
 * экспрешенов After Effects) не нужен JSON:
 *
 *     зарезервированное слово   начертание        Bold, Italic
 *     начинается с `#`          цвет              #FF3B30
 *     начинается с `x`          множитель кегля   x1.5
 *     в двойных кавычках        комментарий-тег   "произносить медленно"
 *
 * Размер — МНОЖИТЕЛЬ, а не кегль: какой кегль окажется в композиции, заранее
 * неизвестно, и `x1.5` значит «в полтора раза больше того, что есть».
 *
 * Разбор отдаёт ЧИСТЫЙ текст и список диапазонов, потому что в After Effects
 * стилизация вешается на диапазон символов (`setFillColor(value, startIndex,
 * numOfCharacters)` и рядом). Отсюда же запрет вложенности: диапазоны не
 * пересекаются и ложатся в вызовы сеттеров один к одному.
 *
 * Чистый модуль: ни React, ни DOM.
 */

/** Символы, которые в тексте обязаны быть экранированы обратным слешем. */
const SPECIAL = new Set(["<", ">", "[", "]", "\\"])

export type MarkupProps = {
  bold?: true
  italic?: true
  /** `#RRGGBB` как в файле — в верхнем регистре. */
  color?: string
  /** Множитель кегля: 1.5 для `x1.5`. */
  scale?: number
  /** Комментарий-тег: подсказка диктору, в кадр не попадает. */
  note?: string
}

export type MarkupRange = {
  /** Смещение в ЧИСТОМ тексте, от нуля. */
  start: number
  /** Длина в символах. */
  length: number
  props: MarkupProps
}

export type ParsedMarkup = {
  /** Текст без разметки — именно он попадает в композицию. */
  text: string
  /** Оформленные куски, по возрастанию `start`, без пересечений. */
  ranges: MarkupRange[]
}

/** Есть ли у фрагмента хоть одно распознанное свойство. */
function hasProps(props: MarkupProps): boolean {
  return Object.keys(props).length > 0
}

/**
 * Разбор одного свойства из `[…]`.
 *
 * Неизвестное свойство возвращает `null`, и вызывающий его молча пропускает:
 * формат будет расширяться (плашка под текстом — первый кандидат, план §13), и
 * старый парсер не должен терять содержимое из-за свойства, о котором не знает.
 */
function parseProp(raw: string, into: MarkupProps): void {
  const value = raw.trim()
  if (!value) return

  const lower = value.toLowerCase()
  if (lower === "bold") {
    into.bold = true
    return
  }
  if (lower === "italic") {
    into.italic = true
    return
  }
  if (value.startsWith("#")) {
    // Только `#RRGGBB`: короткая запись `#f00` в контракте не объявлена, а
    // догадываться о ней значило бы разойтись со скриптом, который её не ждёт.
    if (/^#[0-9a-f]{6}$/i.test(value)) into.color = value.toUpperCase()
    return
  }
  if (value.startsWith("x") || value.startsWith("X")) {
    const scale = Number.parseFloat(value.slice(1))
    // Ноль и отрицательный множитель — не оформление, а исчезнувший текст.
    if (Number.isFinite(scale) && scale > 0) into.scale = scale
    return
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    into.note = unescapeNote(value.slice(1, -1))
  }
}

/**
 * Разбор списка свойств.
 *
 * Запятая внутри кавычек не разделитель: комментарий-тег пишет человек, и
 * «произносить медленно, с нажимом» — обычный текст, а не два свойства.
 */
function parseProps(body: string): MarkupProps {
  const props: MarkupProps = {}
  let current = ""
  let inQuotes = false
  let escaped = false

  for (const char of body) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      current += char
      escaped = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (char === "," && !inQuotes) {
      parseProp(current, props)
      current = ""
      continue
    }
    current += char
  }
  parseProp(current, props)
  return props
}

function unescapeNote(value: string): string {
  return value.replace(/\\(["\\])/g, "$1")
}

function escapeNote(value: string): string {
  return value.replace(/([\\"])/g, "\\$1")
}

/** Экранирование в тексте: обратный слеш перед `< > [ ] \`. */
export function escapeText(value: string): string {
  let out = ""
  for (const char of value) out += SPECIAL.has(char) ? `\\${char}` : char
  return out
}

/**
 * Ищет закрывающую `]` списка свойств, начиная с открывающей `[`.
 *
 * Кавычки учитываются: `]` внутри комментария-тега — обычный символ, и
 * остановиться на ней значило бы разрезать свойство пополам. `-1` — списка
 * свойств нет, и тогда `<…>` перед ним оказывается обычным текстом.
 */
function findPropsEnd(source: string, open: number): number {
  let inQuotes = false
  let escaped = false
  for (let i = open + 1; i < source.length; i += 1) {
    const char = source[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === "]" && !inQuotes) return i
  }
  return -1
}

/**
 * Конец фрагмента — первая неэкранированная `>`, за которой сразу идёт `[`.
 *
 * Вложенность запрещена, поэтому внутренние `<` здесь искать не нужно: всё до
 * `>` — плоский текст фрагмента.
 */
function findFragmentEnd(source: string, open: number): number {
  let escaped = false
  for (let i = open + 1; i < source.length; i += 1) {
    const char = source[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === ">" && source[i + 1] === "[") return i
  }
  return -1
}

/** Снимает экранирование с куска текста. */
function unescapeText(value: string): string {
  let out = ""
  let escaped = false
  for (const char of value) {
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    out += char
  }
  return out
}

/**
 * Файл → чистый текст и диапазоны оформления.
 *
 * Всё, что не разобралось как фрагмент, остаётся текстом. Это не
 * снисходительность к мусору, а требование формата: файл правят руками и
 * скриптами, и потерять при чтении хотя бы символ нельзя.
 */
export function parseMarkup(source: string): ParsedMarkup {
  let text = ""
  const ranges: MarkupRange[] = []
  let i = 0

  while (i < source.length) {
    const char = source[i]!

    if (char === "\\") {
      const next = source[i + 1]
      if (next !== undefined && SPECIAL.has(next)) {
        text += next
        i += 2
        continue
      }
      // Одинокий слеш — обычный символ: в тексте он встречается чаще, чем
      // ошибка экранирования, и съедать его было бы потерей содержимого.
      text += char
      i += 1
      continue
    }

    if (char === "<") {
      const close = findFragmentEnd(source, i)
      const propsEnd = close >= 0 ? findPropsEnd(source, close + 1) : -1
      if (close >= 0 && propsEnd >= 0) {
        const fragment = unescapeText(source.slice(i + 1, close))
        const props = parseProps(source.slice(close + 2, propsEnd))
        if (fragment) {
          // Диапазон только у фрагмента с распознанными свойствами: `<текст>[]`
          // и фрагмент с одним неизвестным свойством — это просто текст.
          if (hasProps(props)) {
            ranges.push({ start: text.length, length: fragment.length, props })
          }
          text += fragment
        }
        i = propsEnd + 1
        continue
      }
    }

    text += char
    i += 1
  }

  return { text, ranges }
}

/**
 * Чистый текст и диапазоны → файл.
 *
 * Диапазоны сортируются и пересечения отбрасываются: формат вложенности не
 * знает, а редактор при сохранении раскладывает пересекающееся оформление в
 * соседние фрагменты. Лучше потерять спорное оформление, чем записать файл,
 * который скрипт не разберёт.
 *
 * Порядок свойств внутри `[…]` фиксирован (начертание, цвет, множитель, тег) —
 * контракт разрешает любой, но одинаковый порядок делает файлы сравнимыми
 * глазами и в `git diff`.
 */
export function serializeMarkup(
  text: string,
  ranges: readonly MarkupRange[],
): string {
  const usable = [...ranges]
    .filter((range) => range.length > 0 && hasProps(range.props))
    .sort((a, b) => a.start - b.start)

  let out = ""
  let cursor = 0

  for (const range of usable) {
    if (range.start < cursor) continue
    const end = range.start + range.length
    if (end > text.length) continue

    out += escapeText(text.slice(cursor, range.start))

    const props: string[] = []
    if (range.props.bold) props.push("Bold")
    if (range.props.italic) props.push("Italic")
    if (range.props.color) props.push(range.props.color.toUpperCase())
    if (range.props.scale !== undefined) props.push(`x${range.props.scale}`)
    if (range.props.note) props.push(`"${escapeNote(range.props.note)}"`)

    out += `<${escapeText(text.slice(range.start, end))}>[${props.join(", ")}]`
    cursor = end
  }

  return out + escapeText(text.slice(cursor))
}
