/**
 * Документ редактора ⇄ разметка текста (markup.ts).
 *
 * Редактор работает на модели документа (Tiptap), а файл — плоский текст с
 * диапазонами оформления. Перевод между ними стоит здесь, а не в компоненте, по
 * требованию переносимости: `lib/` не знает ни про React, ни про Tiptap, и
 * принимает документ как обычные данные.
 *
 * Абзац документа — строка файла. Отдельного «переноса строки» в формате нет:
 * `.txt` и так хранит переносы как есть, и вводить для них разметку значило бы
 * заводить второй способ записать то же самое.
 */

import { parseMarkup, serializeMarkup, type MarkupProps, type MarkupRange } from "./markup"

/** Минимальная форма документа: ровно то, что отдаёт `editor.getJSON()`. */
export type EditorMark = {
  type: string
  attrs?: Record<string, unknown> | null
}

export type EditorNode = {
  type?: string
  text?: string
  marks?: EditorMark[] | null
  content?: EditorNode[] | null
}

/**
 * Имена марок редактора. Совпадать с именами свойств формата они не обязаны, но
 * перечислены в одном месте: разойдись они — оформление молча перестало бы
 * сохраняться, а текст остался бы целым, и заметить это можно было бы только
 * глазами.
 */
export const MARK_BOLD = "bold"
export const MARK_ITALIC = "italic"
export const MARK_COLOR = "elementColor"
export const MARK_SCALE = "elementScale"
export const MARK_NOTE = "elementNote"

/** Свойства формата из марок одного куска текста. */
function propsFromMarks(marks: readonly EditorMark[] | null | undefined): MarkupProps {
  const props: MarkupProps = {}
  for (const mark of marks ?? []) {
    if (mark.type === MARK_BOLD) props.bold = true
    if (mark.type === MARK_ITALIC) props.italic = true
    if (mark.type === MARK_COLOR) {
      const color = mark.attrs?.color
      if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
        props.color = color.toUpperCase()
      }
    }
    if (mark.type === MARK_SCALE) {
      const scale = Number(mark.attrs?.scale)
      if (Number.isFinite(scale) && scale > 0) props.scale = scale
    }
    if (mark.type === MARK_NOTE) {
      const note = mark.attrs?.note
      if (typeof note === "string" && note.trim()) props.note = note.trim()
    }
  }
  return props
}

function sameProps(a: MarkupProps, b: MarkupProps): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.scale === b.scale &&
    a.note === b.note
  )
}

function hasProps(props: MarkupProps): boolean {
  return Object.keys(props).length > 0
}

/**
 * Документ → файл.
 *
 * Соседние куски с одинаковым оформлением склеиваются в один диапазон: Tiptap
 * режет текст на узлы по своим причинам (курсор, история правок), и без склейки
 * одно и то же слово уехало бы в файл двумя фрагментами подряд.
 */
export function docToMarkup(doc: EditorNode): string {
  let text = ""
  const ranges: MarkupRange[] = []

  const pushText = (value: string, props: MarkupProps) => {
    if (!value) return
    const last = ranges[ranges.length - 1]
    if (hasProps(props)) {
      if (last && last.start + last.length === text.length && sameProps(last.props, props)) {
        last.length += value.length
      } else {
        ranges.push({ start: text.length, length: value.length, props })
      }
    }
    text += value
  }

  const walkInline = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (node.type === "hardBreak") {
        text += "\n"
        continue
      }
      if (typeof node.text === "string") {
        pushText(node.text, propsFromMarks(node.marks))
        continue
      }
      if (node.content) walkInline(node.content)
    }
  }

  const blocks = doc.content ?? []
  blocks.forEach((block, index) => {
    // Пустая строка между абзацами не теряется: человек её поставил намеренно,
    // а в титрах пауза между репликами и есть пустая строка.
    if (index > 0) text += "\n"
    if (block.content) walkInline(block.content)
  })

  return serializeMarkup(text, ranges)
}

/**
 * Файл → документ.
 *
 * Обратная сторона той же дороги: текст режется на куски по границам
 * диапазонов, каждому куску выдаются марки. Строки файла становятся абзацами.
 */
export function markupToDoc(source: string): EditorNode {
  const { text, ranges } = parseMarkup(source)

  /** Марки для позиции: диапазоны не пересекаются, поэтому подходит не больше одного. */
  const marksAt = (index: number): EditorMark[] => {
    const range = ranges.find(
      (item) => index >= item.start && index < item.start + item.length,
    )
    if (!range) return []
    const marks: EditorMark[] = []
    if (range.props.bold) marks.push({ type: MARK_BOLD })
    if (range.props.italic) marks.push({ type: MARK_ITALIC })
    if (range.props.color) marks.push({ type: MARK_COLOR, attrs: { color: range.props.color } })
    if (range.props.scale !== undefined) {
      marks.push({ type: MARK_SCALE, attrs: { scale: range.props.scale } })
    }
    if (range.props.note) marks.push({ type: MARK_NOTE, attrs: { note: range.props.note } })
    return marks
  }

  const paragraphs: EditorNode[] = []
  let lineStart = 0

  const pushLine = (from: number, to: number) => {
    const content: EditorNode[] = []
    let chunkStart = from
    let chunkMarks = marksAt(from)

    const flush = (end: number) => {
      const value = text.slice(chunkStart, end)
      if (value) {
        content.push({
          type: "text",
          text: value,
          ...(chunkMarks.length > 0 ? { marks: chunkMarks } : {}),
        })
      }
    }

    for (let i = from + 1; i < to; i += 1) {
      const marks = marksAt(i)
      const changed =
        marks.length !== chunkMarks.length ||
        marks.some((mark, index) => {
          const previous = chunkMarks[index]
          return (
            !previous ||
            previous.type !== mark.type ||
            JSON.stringify(previous.attrs ?? null) !== JSON.stringify(mark.attrs ?? null)
          )
        })
      if (!changed) continue
      flush(i)
      chunkStart = i
      chunkMarks = marks
    }
    flush(to)

    // Пустой абзац — законная строка документа, и узлов в нём нет: ProseMirror
    // именно так и хранит пустой параграф.
    paragraphs.push({ type: "paragraph", ...(content.length > 0 ? { content } : {}) })
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "\n") continue
    pushLine(lineStart, i)
    lineStart = i + 1
  }
  pushLine(lineStart, text.length)

  return { type: "doc", content: paragraphs }
}
