"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MessageSquareText, PanelRightClose } from "lucide-react"

import { useI18n } from "@/components/account/i18n"

import { parseMarkup, type MarkupProps } from "@/lib/tools/element/markup"
import { cn } from "@/lib/utils"

const NOTES_KEY = "text-viewer:notes-open"

/**
 * Текст с разметкой §8.2 только для чтения: цвет, размер, жирный, курсив,
 * комментарий.
 *
 * Рисует так же, как марки редактора (`markup-marks.ts`): размер — в `em`
 * относительно окружающего текста, цвет — инлайном, потому что это значение
 * из файла, а не токен темы. Так файл выглядит одинаково и в просмотре, и в
 * правке.
 *
 * Комментарии в тексте — только подчёркиванием точками; сами они в колонке
 * справа. Клик по комментарию подсвечивает его фрагмент, клик по фрагменту —
 * его комментарий (и раскрывает колонку). Свёрнута колонка или нет —
 * помнит браузер; без комментариев её нет вовсе.
 *
 * Копирование отсюда — только чистым текстом: без него браузер положил бы в
 * буфер и HTML с цветами и размерами, и вставка в почту или документ притащила
 * бы оформление.
 */
export function MarkupView({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  const { t } = useI18n()
  const parts = useMemo(() => {
    const { text, ranges } = parseMarkup(source)
    const out: { text: string; props?: MarkupProps }[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) out.push({ text: text.slice(cursor, range.start) })
      out.push({
        text: text.slice(range.start, range.start + range.length),
        props: range.props,
      })
      cursor = range.start + range.length
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) })
    return out
  }, [source])

  // Индекс части → комментарий; соседние части с тем же комментарием — один.
  const notes = useMemo(() => {
    const list: { note: string; parts: number[]; excerpt: string }[] = []
    parts.forEach((part, i) => {
      const note = part.props?.note
      if (!note) return
      const last = list[list.length - 1]
      if (last && last.note === note && last.parts[last.parts.length - 1] === i - 1) {
        last.parts.push(i)
        last.excerpt += part.text
      } else list.push({ note, parts: [i], excerpt: part.text })
    })
    return list
  }, [parts])
  const noteOfPart = useMemo(() => {
    const map = new Map<number, number>()
    notes.forEach((n, ni) => n.parts.forEach((p) => map.set(p, ni)))
    return map
  }, [notes])

  const [open, setOpen] = useState(true)
  const [active, setActive] = useState<number | null>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLDivElement>(null)

  // Читаем после монтирования: на сервере localStorage нет.
  useEffect(() => {
    if (window.localStorage.getItem(NOTES_KEY) === "0") setOpen(false)
  }, [])
  const toggle = (value: boolean) => {
    setOpen(value)
    window.localStorage.setItem(NOTES_KEY, value ? "1" : "0")
  }

  const focusNote = (ni: number, from: "text" | "aside") => {
    setActive(ni)
    if (from === "text") {
      if (!open) toggle(true)
      requestAnimationFrame(() =>
        asideRef.current?.querySelector(`[data-note-item="${ni}"]`)?.scrollIntoView({ block: "nearest" }),
      )
    } else {
      textRef.current
        ?.querySelector(`[data-note-part="${notes[ni].parts[0]}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="scrollbar-elegant relative min-w-0 flex-1 overflow-auto">
        {notes.length > 0 && !open ? (
          <button
            type="button"
            onClick={() => toggle(true)}
            className="absolute right-2 top-2 flex h-7 items-center gap-1.5 rounded-md border border-foreground/10 bg-ws-control px-2 text-[12px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            {t.textViewerShowNotes} · {notes.length}
          </button>
        ) : null}
        <div
          ref={textRef}
          onCopy={(event) => {
            const selection = window.getSelection()
            if (!selection || selection.isCollapsed) return
            event.preventDefault()
            event.clipboardData.setData("text/plain", selection.toString())
          }}
          className={cn(
            "whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ws-1",
            className,
          )}
        >
          {parts.map((part, i) => {
            const props = part.props
            if (!props) return <span key={i}>{part.text}</span>
            const ni = noteOfPart.get(i)
            return (
              <span
                key={i}
                data-note-part={ni !== undefined ? i : undefined}
                onClick={ni !== undefined ? () => focusNote(ni, "text") : undefined}
                className={cn(
                  props.bold && "font-bold",
                  props.italic && "italic",
                  ni !== undefined &&
                    "cursor-pointer rounded-sm underline decoration-dotted underline-offset-4 transition-colors hover:bg-ws-select/30",
                  ni !== undefined && ni === active && "bg-ws-select/50",
                )}
                style={{
                  color: props.color,
                  fontSize: props.scale ? `${props.scale}em` : undefined,
                }}
              >
                {part.text}
              </span>
            )
          })}
        </div>
      </div>

      {notes.length > 0 && open ? (
        <aside ref={asideRef} className="scrollbar-elegant flex w-64 shrink-0 flex-col overflow-auto border-l border-foreground/[0.07]">
          <div className="sticky top-0 flex h-9 shrink-0 items-center gap-2 border-b border-foreground/[0.07] bg-ws-well px-3">
            <span className="text-[11.5px] font-semibold uppercase tracking-[1px] text-ws-3">
              {t.textViewerNotes} · {notes.length}
            </span>
            <button
              type="button"
              onClick={() => toggle(false)}
              title={t.textViewerHideNotes}
              aria-label={t.textViewerHideNotes}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-ws-1"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-1 p-2">
            {notes.map((n, ni) => (
              <li key={ni}>
                <button
                  type="button"
                  data-note-item={ni}
                  onClick={() => focusNote(ni, "aside")}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left hover:bg-ws-hover",
                    ni === active && "bg-ws-select/35 hover:bg-ws-select/35",
                  )}
                >
                  <span className="line-clamp-1 text-[11.5px] text-ws-4">«{n.excerpt.trim()}»</span>
                  <span className="mt-0.5 block whitespace-pre-wrap break-words text-[12.5px] text-ws-1">{n.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  )
}
