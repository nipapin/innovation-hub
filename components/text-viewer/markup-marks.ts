/**
 * Марки Tiptap под формат разметки текста элемента.
 *
 * Своих три — цвет, множитель кегля и комментарий-тег; жирный и курсив берутся
 * у StarterKit, потому что это они и есть. Имена совпадают с теми, которые ждёт
 * перевод документа в файл (`lib/tools/element/editor-doc.ts`): разойдись они —
 * оформление молча перестало бы сохраняться при целом тексте.
 *
 * Почему не переиспользован `TextColor` из редактора описания: там цвет — ключ
 * палитры темы (`fg-blue-2`), потому что описание читают на сайте. Здесь цвет
 * уезжает в композицию и обязан быть `#RRGGBB`, а размер и комментарий в том
 * формате не выражаются вовсе.
 *
 * Оформление в редакторе рисуется инлайновым стилем — и это единственное место,
 * где так можно: значение приходит из файла, а не из дизайн-системы, и токена
 * для «цвет, который выбрал человек» не существует.
 */

import { Mark, mergeAttributes } from "@tiptap/core"

import {
  MARK_COLOR,
  MARK_NOTE,
  MARK_SCALE,
} from "@/lib/tools/element/editor-doc"
import { normalizeColor } from "@/lib/tools/element/palette"

export const ElementColor = Mark.create({
  name: MARK_COLOR,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          normalizeColor(el.getAttribute("data-color") ?? ""),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.color
            ? {
                "data-color": String(attrs.color),
                style: `color: ${String(attrs.color)}`,
              }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-color]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },
})

export const ElementScale = Mark.create({
  name: MARK_SCALE,

  addAttributes() {
    return {
      scale: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const value = Number.parseFloat(el.getAttribute("data-scale") ?? "")
          return Number.isFinite(value) && value > 0 ? value : null
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const scale = Number(attrs.scale)
          if (!Number.isFinite(scale) || scale <= 0) return {}
          // `em`, а не `px`: множитель тем и остаётся — и в редакторе он должен
          // читаться относительно окружающего текста, как потом в композиции.
          return { "data-scale": String(scale), style: `font-size: ${scale}em` }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-scale]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },
})

/**
 * Комментарий-тег: подсказка диктору, в кадр не попадает.
 *
 * В редакторе он показан подчёркиванием точками — не жирным и не цветом, потому
 * что и то и другое в этом формате означает оформление самого текста, и спутать
 * «выделено» с «есть примечание» нельзя. Само подчёркивание здесь законно: это
 * пометка редактора, а не свойство символа, и в файл уезжает только текст тега.
 */
export const ElementNote = Mark.create({
  name: MARK_NOTE,

  addAttributes() {
    return {
      note: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-note"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.note
            ? {
                "data-note": String(attrs.note),
                title: String(attrs.note),
                class: "underline decoration-dotted underline-offset-4",
              }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-note]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },
})
