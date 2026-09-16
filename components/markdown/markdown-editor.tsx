"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"

import { tf } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useMarkdownHistory } from "@/lib/hooks/use-markdown-history"
import { DESCRIPTION_SIZE_WARN } from "@/lib/markdown/description-format"
import { createTextApi } from "@/lib/markdown/editor-api"
import type { TextState } from "@/lib/markdown/markdown-commands"
import { markdownToEditorHtml } from "@/lib/markdown/markdown-to-html"
import { docToMarkdown, type DocNode } from "@/lib/markdown/markdown-serialize"
import { imageFromTransfer, prepareImage } from "@/lib/markdown/prepare-image"
import { createTiptapApi } from "@/lib/markdown/tiptap-api"
import { cn } from "@/lib/utils"
import { MarkdownView } from "./markdown-view"
import { MarkdownToolbar, type ViewMode } from "./markdown-toolbar"
import { useMdDict } from "./md-dict"
import {
  BlockAttrs,
  DescTableCell,
  DescTableHeader,
  DescTaskItem,
  DescTaskList,
  Details,
  DetailsSummary,
  TextColor,
} from "./tiptap-extensions"

/**
 * Редактор описания проекта: слева markdown, справа превью тем же рендерером,
 * что и показ (`MarkdownView`) — иначе «как вижу» и «как сохранится»
 * разъезжались бы.
 *
 * Два способа правки, одна панель кнопок — как в программе:
 *
 *   • `rich` (по умолчанию) — правка сразу в отрисованном виде (Tiptap);
 *   • `split` / `text` / `preview` — markdown-текст, с превью и без.
 *
 * Почему не `contentEditable` поверх превью: браузер на каждый Enter и вставку
 * рожает свои `div`/`br`/`span style`, и обратное превращение в markdown теряет
 * структуру. Поэтому правка стоит на модели документа, markdown получается
 * сериализацией (`markdown-serialize.ts`), а сам документ собирается из HTML
 * (`markdown-to-html.ts`).
 *
 * Второго сериализатора при этом не появилось: и он, и расширения перенесены из
 * программы файл в файл — расходиться им нельзя, иначе одно и то же описание
 * сохранялось бы двумя разными файлами.
 *
 * Источник истины — строка markdown. В текстовых режимах её ведёт
 * `useMarkdownHistory` (программная подмена значения обнуляет нативный стек
 * отмены у textarea), в `rich` — документ Tiptap, и на каждое изменение она
 * пересобирается. При переключении режима значение переносится через markdown,
 * а не через внутренние структуры: так видно, что формат ничего не потерял.
 */

const FONT_SIZE_KEY = "ffworks-md-font-size"

/** Кегль превью — настройка просмотра, в файл не попадает, но переживает F5. */
function useFontSize(): [number, (size: number) => void] {
  const [size, setSize] = useState(14)

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(FONT_SIZE_KEY))
    if (Number.isFinite(saved) && saved >= 10 && saved <= 28) setSize(saved)
  }, [])

  const update = useCallback((next: number) => {
    setSize(next)
    try {
      window.localStorage.setItem(FONT_SIZE_KEY, String(next))
    } catch {
      // приватный режим — просто не запомним
    }
  }, [])

  return [size, update]
}

/** Вес файла: описание едет целиком, поэтому он всегда на виду. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Меняется, когда содержимое пришло извне (перечитали файл) — сбрасывает историю. */
  loadKey?: number | string
  className?: string
}

export function MarkdownEditor({
  value,
  onChange,
  loadKey,
  className,
}: MarkdownEditorProps) {
  const t = useMdDict()
  const [view, setView] = useState<ViewMode>("rich")
  const [narrow, setNarrow] = useState(false)
  const [fontSize, setFontSize] = useFontSize()
  const [busy, setBusy] = useState(false)
  const [imageError, setImageError] = useState(false)
  const isRich = view === "rich"

  const history = useMarkdownHistory(value)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** Отложенная сериализация документа: см. `onUpdate` ниже. */
  const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Диалоги вставки
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkText, setLinkText] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [tableOpen, setTableOpen] = useState(false)
  const [cols, setCols] = useState(3)
  const [rows, setRows] = useState(2)
  const [header, setHeader] = useState(true)
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeLang, setCodeLang] = useState("ts")

  const [md, setMd] = useState(value)
  const mdRef = useRef(value)

  const setMarkdown = useCallback((next: string) => {
    mdRef.current = next
    setMd(next)
  }, [])

  const serializeLabels = useMemo(
    () => ({ detailsSummary: t.detailsSummary }),
    [t.detailsSummary],
  )

  const editor = useEditor({
    // Без этого кнопки не подсвечивались бы: React не узнал бы о смене выделения.
    shouldRerenderOnTransaction: true,
    // Рендер только в браузере: на сервере документа и DOM нет.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        codeBlock: { languageClassPrefix: "language-" },
      }),
      Highlight.configure({ multicolor: false }),
      Image.configure({ allowBase64: true }),
      TableKit.configure({
        table: { resizable: false },
        tableHeader: false,
        tableCell: false,
      }),
      DescTableHeader,
      DescTableCell,
      DescTaskList,
      DescTaskItem.configure({ nested: true }),
      TextColor,
      BlockAttrs,
      Details,
      DetailsSummary,
    ],
    content: "",
    onUpdate: ({ editor: ed }) => {
      // Пересборка markdown с задержкой: на большом описании с картинками
      // сериализовать документ на каждое нажатие клавиши дорого.
      if (serializeTimer.current) clearTimeout(serializeTimer.current)
      serializeTimer.current = setTimeout(() => {
        serializeTimer.current = null
        setMarkdown(docToMarkdown(ed.getJSON() as DocNode, serializeLabels))
      }, 250)
    },
  })

  /** Положить markdown в документ редактора, не вызывая `onUpdate`. */
  const loadIntoEditor = useCallback(
    (text: string) => {
      if (!editor) return
      editor.commands.setContent(markdownToEditorHtml(text), {
        emitUpdate: false,
      })
    },
    [editor],
  )

  // Содержимое пришло извне: новый текст без истории.
  useEffect(() => {
    setMarkdown(value)
    history.reset(value)
    if (isRich) loadIntoEditor(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, editor])

  /**
   * Переключение способа правки. Значение всегда переносится через markdown:
   * из текста документ собирается заново, из документа — дописывается
   * отложенная сериализация, иначе последние правки потерялись бы.
   */
  const switchView = useCallback(
    (next: ViewMode) => {
      if (next === view) return
      if (next === "rich") {
        loadIntoEditor(mdRef.current)
      } else if (isRich) {
        if (serializeTimer.current && editor) {
          clearTimeout(serializeTimer.current)
          serializeTimer.current = null
          const text = docToMarkdown(
            editor.getJSON() as DocNode,
            serializeLabels,
          )
          mdRef.current = text
          setMd(text)
          history.reset(text)
        } else {
          history.reset(mdRef.current)
        }
      }
      setView(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, isRich, editor, loadIntoEditor, serializeLabels],
  )

  // В текстовых режимах источник истины — история правок.
  useEffect(() => {
    if (!isRich) setMarkdown(history.state.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.state.value, isRich])

  // Наружу отдаём только markdown.
  useEffect(() => {
    onChange(md)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md])

  // После команды тулбара или отмены возвращаем выделение в поле ввода.
  useEffect(() => {
    if (isRich) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(history.state.selStart, history.state.selEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.syncKey])

  /**
   * Выделение читаем из DOM, а не из состояния: пока пользователь просто водит
   * каретку, React об этом не знает, а команде нужны актуальные границы.
   */
  const readState = useCallback((): TextState => {
    const ta = taRef.current
    return {
      value: history.state.value,
      selStart: ta ? ta.selectionStart : history.state.selStart,
      selEnd: ta ? ta.selectionEnd : history.state.selEnd,
    }
  }, [history.state])

  const applyText = useCallback(
    (fn: (s: TextState) => TextState) => {
      history.commit(fn(readState()))
    },
    [history, readState],
  )

  const api = useMemo(
    () =>
      isRich
        ? createTiptapApi(editor, { detailsSummary: t.detailsSummary })
        : createTextApi(applyText, readState, {
            detailsSummary: t.detailsSummary,
            tableColumn: (index) => tf(t.tableColumn, { index }),
          }),
    [isRich, editor, applyText, readState, t.detailsSummary, t.tableColumn],
  )

  // Отмена тоже своя у каждого способа правки: у документа свой стек.
  const undo = useCallback(() => {
    if (isRich) editor?.chain().focus().undo().run()
    else history.undo()
  }, [isRich, editor, history])

  const redo = useCallback(() => {
    if (isRich) editor?.chain().focus().redo().run()
    else history.redo()
  }, [isRich, editor, history])

  const canUndo = isRich ? Boolean(editor?.can().undo()) : history.canUndo
  const canRedo = isRich ? Boolean(editor?.can().redo()) : history.canRedo

  // ── Картинки ──────────────────────────────────────────────────────────────

  const insertBlob = useCallback(
    async (blob: Blob, alt: string) => {
      setBusy(true)
      setImageError(false)
      try {
        const image = await prepareImage(blob)
        api.image(alt, image.dataUrl)
      } catch {
        setImageError(true)
      } finally {
        setBusy(false)
      }
    },
    [api],
  )

  const handleTransfer = useCallback(
    (dt: DataTransfer | null): boolean => {
      const file = imageFromTransfer(dt)
      if (!file) return false
      void insertBlob(file, file.name.replace(/\.[^.]+$/, ""))
      return true
    },
    [insertBlob],
  )

  // В правке «как выглядит» события идут мимо textarea — вешаемся на само
  // полотно ProseMirror.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onPaste = (e: ClipboardEvent) => {
      if (handleTransfer(e.clipboardData)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (handleTransfer(e.dataTransfer)) e.preventDefault()
    }
    dom.addEventListener("paste", onPaste)
    dom.addEventListener("drop", onDrop)
    return () => {
      dom.removeEventListener("paste", onPaste)
      dom.removeEventListener("drop", onDrop)
    }
  }, [editor, handleTransfer])

  // ── Горячие клавиши ───────────────────────────────────────────────────────

  const openLink = useCallback(() => {
    setLinkText(api.selection())
    setLinkUrl("")
    setLinkOpen(true)
  }, [api])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) {
        if (e.key === "Tab") {
          e.preventDefault()
          api.indent(e.shiftKey ? -1 : 1)
        }
        return
      }
      const key = e.key.toLowerCase()
      if (key === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault()
        redo()
      } else if (key === "b") {
        e.preventDefault()
        api.bold()
      } else if (key === "i") {
        e.preventDefault()
        api.italic()
      } else if (key === "u") {
        e.preventDefault()
        api.underline()
      } else if (key === "e") {
        e.preventDefault()
        api.inlineCode()
      } else if (key === "k") {
        e.preventDefault()
        openLink()
      }
    },
    [api, undo, redo, openLink],
  )

  // ── Панель состояния ──────────────────────────────────────────────────────

  const bytes = useMemo(() => new TextEncoder().encode(md).length, [md])
  const sizeWarn = bytes > DESCRIPTION_SIZE_WARN
  const size = formatSize(bytes)
  const status = busy
    ? t.imageBusy
    : imageError
      ? t.imageFailed
      : sizeWarn
        ? `${size} — ${t.sizeWarn}`
        : size

  const measure = narrow ? 380 : 820

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-foreground/[0.07]",
        className,
      )}
    >
      <MarkdownToolbar
        api={api}
        onLink={openLink}
        onImage={() => fileRef.current?.click()}
        onTable={() => setTableOpen(true)}
        onCodeBlock={() => setCodeOpen(true)}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        view={view}
        setView={switchView}
        narrow={narrow}
        setNarrow={setNarrow}
        fontSize={fontSize}
        setFontSize={setFontSize}
        status={status}
        statusWarn={sizeWarn || busy || imageError}
      />

      <div className="flex min-h-0 flex-1">
        {isRich ? (
          // Полотно устроено как превью и носит те же классы: правка обязана
          // выглядеть так же, как готовое описание, иначе смысл режима теряется.
          // `.md-canvas` добавляет только служебное оформление самого редактора.
          <div
            className={cn(
              "md-canvas scrollbar-elegant min-w-0 flex-1 overflow-y-auto bg-ws-control p-3",
              narrow && "flex justify-center",
            )}
          >
            <div
              className="md-body md-palette"
              style={
                {
                  width: narrow ? measure : "100%",
                  maxWidth: "100%",
                  "--md-font-size": `${fontSize}px`,
                  "--md-measure": `${measure}px`,
                } as React.CSSProperties
              }
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        ) : null}

        {!isRich && view !== "preview" ? (
          <textarea
            ref={taRef}
            value={md}
            spellCheck={false}
            onChange={(e) =>
              history.type({
                value: e.target.value,
                selStart: e.target.selectionStart,
                selEnd: e.target.selectionEnd,
              })
            }
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              // Отменяем вставку только когда картинка действительно нашлась:
              // иначе обычная текстовая вставка перестала бы работать.
              if (handleTransfer(e.clipboardData)) e.preventDefault()
            }}
            onDrop={(e) => {
              if (handleTransfer(e.dataTransfer)) e.preventDefault()
            }}
            placeholder={t.editorPlaceholder}
            className={cn(
              "scrollbar-elegant min-w-0 flex-1 resize-none bg-ws-well p-3 font-mono leading-relaxed",
              "text-ws-2 outline-none placeholder:text-ws-5",
            )}
            style={{ fontSize: Math.max(12, fontSize - 2), tabSize: 2 }}
          />
        ) : null}

        {!isRich && view !== "text" ? (
          <div
            className={cn(
              "scrollbar-elegant min-w-0 flex-1 overflow-y-auto bg-ws-control p-3",
              view === "split" && "border-l border-foreground/[0.07]",
              narrow && "flex justify-center",
            )}
          >
            <div style={{ width: narrow ? measure : "100%", maxWidth: "100%" }}>
              <MarkdownView measure={measure} fontSize={fontSize}>
                {md}
              </MarkdownView>
            </div>
          </div>
        ) : null}
      </div>

      {/* Выбор файла картинки: скрытый input, кнопка живёт в тулбаре. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void insertBlob(file, file.name.replace(/\.[^.]+$/, ""))
          // Сбрасываем значение: иначе повторный выбор того же файла молча
          // не вызовет onChange.
          e.target.value = ""
        }}
      />

      {/* Ссылка */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="border-border/60 bg-ws-raised sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-[15px] text-ws-1">{t.linkTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="text-[12px] text-ws-3">
              {t.linkTextLabel}
              <Input
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="mt-1 border-foreground/10 bg-ws-control text-ws-1"
              />
            </label>
            <label className="text-[12px] text-ws-3">
              {t.linkUrlLabel}
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
                className="mt-1 border-foreground/10 bg-ws-control text-ws-1"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-ws-2" onClick={() => setLinkOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              disabled={!linkUrl.trim()}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
              onClick={() => {
                api.link(linkText.trim(), linkUrl.trim())
                setLinkOpen(false)
              }}
            >
              {t.insert}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Таблица */}
      <Dialog open={tableOpen} onOpenChange={setTableOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="border-border/60 bg-ws-raised sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-[15px] text-ws-1">{t.tableTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] text-ws-3">
              {t.tableCols}
              <Input
                type="number"
                min={1}
                max={12}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="mt-1 w-[92px] border-foreground/10 bg-ws-control text-ws-1"
              />
            </label>
            <label className="text-[12px] text-ws-3">
              {t.tableRows}
              <Input
                type="number"
                min={1}
                max={50}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="mt-1 w-[92px] border-foreground/10 bg-ws-control text-ws-1"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-[13px] text-ws-2">
              <input
                type="checkbox"
                checked={header}
                onChange={(e) => setHeader(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--ws-select))]"
              />
              {t.tableHeader}
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-ws-2" onClick={() => setTableOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              className="bg-ws-action text-white hover:bg-ws-action-hover"
              onClick={() => {
                api.table(cols, rows, header)
                setTableOpen(false)
              }}
            >
              {t.insert}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Блок кода */}
      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="border-border/60 bg-ws-raised sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle className="text-[15px] text-ws-1">{t.codeTitle}</DialogTitle>
          </DialogHeader>
          <label className="text-[12px] text-ws-3">
            {t.codeLangLabel}
            <Input
              value={codeLang}
              onChange={(e) => setCodeLang(e.target.value)}
              placeholder="ts, json, bash…"
              className="mt-1 border-foreground/10 bg-ws-control text-ws-1"
            />
          </label>
          <DialogFooter>
            <Button variant="ghost" className="text-ws-2" onClick={() => setCodeOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              className="bg-ws-action text-white hover:bg-ws-action-hover"
              onClick={() => {
                api.codeBlock(codeLang.trim())
                setCodeOpen(false)
              }}
            >
              {t.insert}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
