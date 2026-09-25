"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  Baseline,
  Bold,
  Italic,
  MessageSquare,
  Minus,
  Plus,
  RemoveFormatting,
  X,
} from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  MARK_COLOR,
  MARK_NOTE,
  MARK_SCALE,
  docToMarkup,
  markupToDoc,
  type EditorNode,
} from "@/lib/tools/element/editor-doc"
import {
  ELEMENT_COLORS,
  ELEMENT_SCALE_STEP,
  stepScale,
  normalizeColor,
} from "@/lib/tools/element/palette"
import { cn } from "@/lib/utils"
import { ElementColor, ElementNote, ElementScale } from "./text-marks"

/**
 * Редактор текста элемента — сильно урезанный Tiptap.
 *
 * Правило отбора жёсткое и взято из плана (§8.1): чего нельзя сделать скриптом в
 * After Effects, того в редакторе быть не должно. Поэтому здесь нет заголовков,
 * списков, таблиц, картинок, ссылок, цитат, кода — и НЕТ ПОДЧЁРКИВАНИЯ: в
 * `TextStyle` его не существует вовсе, и рисовать его линией значило бы завести
 * механизм, не имеющий отношения к «поставить свойство символа».
 *
 * Отдельный компонент, а не режим `markdown-editor.tsx`: у того свой формат и
 * свой сериализатор, и заводить рядом второй прямо запрещено комментарием в его
 * шапке. Общее у них только происхождение кнопок — набор здесь свой.
 *
 * Источник истины — строка файла (разметка §8.2). Документ редактора собирается
 * из неё и в неё же сериализуется: так видно, что формат ничего не потерял.
 */

/** Кнопка панели. На уровне модуля: внутри компонента React пересоздавал бы тип. */
function ToolButton({
  title,
  icon: Icon,
  active,
  onClick,
}: {
  title: string
  icon: typeof Bold
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // onMouseDown, а не onClick: клик сначала уводит фокус из полотна, и
      // выделение теряется до того, как команда его прочитает.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors",
        "text-ws-3 hover:bg-foreground/[0.07] hover:text-ws-1",
        active && "bg-ws-select/[0.18] text-ws-1",
      )}
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
    </button>
  )
}

export function ElementTextEditor({
  value,
  onChange,
  loadKey,
  className,
}: {
  /** Содержимое файла: текст с разметкой §8.2. */
  value: string
  onChange: (next: string) => void
  /** Меняется, когда текст пришёл извне (перечитали файл) — перезагружает документ. */
  loadKey?: string | number
  className?: string
}) {
  const { t } = useI18n()
  const [colorOpen, setColorOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [customColor, setCustomColor] = useState("")
  /**
   * Ряд «уже использованные» пополняется при выборе нового цвета.
   *
   * Живёт в состоянии компонента, а не в настройках: набор цветов у каждого
   * ролика свой, и переносить его между элементами незачем.
   */
  const [usedColors, setUsedColors] = useState<string[]>([])

  /**
   * Открыто нативное окно выбора цвета.
   *
   * Нужен, потому что это окно — не часть страницы: браузер рисует его средствами
   * системы, и при его открытии документ теряет фокус. Радикс видит ровно то же,
   * что при клике мимо попапа, и закрывает попап вместе с самим полем — выбрать
   * цвет становится нечем.
   *
   * Отличаем одно от другого по `document.hasFocus()`: пока крутят нативное окно,
   * фокуса у документа нет, а при настоящем клике мимо попапа — есть. Поэтому
   * закрытие подавляется только на время выбора и обычное поведение остаётся.
   */
  const nativePickRef = useRef(false)

  /** Уход наружу вызван открытым нативным окном, а не кликом мимо попапа. */
  const isNativePicking = () =>
    nativePickRef.current && typeof document !== "undefined" && !document.hasFocus()

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Всё, чего скрипт в After Effects не умеет, выключено здесь же, а не
        // просто не выведено в панель: иначе это приезжало бы вставкой из буфера.
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        link: false,
        underline: false,
      }),
      ElementColor,
      ElementScale,
      ElementNote,
    ],
    content: "",
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(docToMarkup(ed.getJSON() as EditorNode))
    },
    editorProps: {
      attributes: {
        class: "min-h-[140px] outline-none",
      },
    },
  })

  // Текст пришёл извне: собираем документ заново, не вызывая onUpdate.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(markupToDoc(value) as never, { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, editor])

  const pickColor = useCallback(
    (raw: string | null) => {
      if (!editor) return
      if (!raw) {
        editor.chain().focus().unsetMark(MARK_COLOR).run()
        return
      }
      const color = normalizeColor(raw)
      if (!color) return
      editor.chain().focus().setMark(MARK_COLOR, { color }).run()
      setUsedColors((prev) =>
        prev.includes(color) ? prev : [color, ...prev].slice(0, 12),
      )
    },
    [editor],
  )

  const swatches = useMemo(
    () => ELEMENT_COLORS.filter((color) => !usedColors.includes(color)),
    [usedColors],
  )

  if (!editor) {
    return (
      <div
        className={cn(
          "rounded-[10px] border border-foreground/[0.07] bg-ws-control p-3 text-[13px] text-ws-5",
          className,
        )}
      >
        {t.elementBusy}
      </div>
    )
  }

  /*
    Дальше — обычные функции, а не хуки: выше стоит ранний возврат «редактор
    ещё не готов», и хук после него менял бы их порядок между рендерами.
  */

  /**
   * Поставить цвет, не запоминая его: так ведёт себя нативный выбор, пока его крутят.
   *
   * БЕЗ `.focus()`, в отличие от `pickColor`. Здесь команда идёт на каждое
   * движение в нативном окне, а `.focus()` уводит фокус браузера в полотно —
   * наружу от попапа, который лежит в портале. Радикс видит уход наружу и
   * закрывает попап вместе с полем выбора, то есть каждая правка цвета убивала
   * бы сам инструмент правки. Выделению фокус не нужен: оно хранится в состоянии
   * редактора и переживает потерю фокуса, а вернуть каретку есть кому — это
   * делает `pickColor`, когда выбор завершают.
   */
  const applyColor = (raw: string) => {
    const color = normalizeColor(raw)
    if (!color) return
    editor.chain().setMark(MARK_COLOR, { color }).run()
  }

  /** Запомнить цвет в ряду «уже использованные» — по окончании выбора. */
  const rememberColor = (raw: string) => {
    const color = normalizeColor(raw)
    if (!color) return
    setUsedColors((prev) =>
      prev.includes(color) ? prev : [color, ...prev].slice(0, 12),
    )
  }

  /** Убрать цвет из ряда «уже использованные»: он больше не нужен. */
  const forgetColor = (color: string) => {
    setUsedColors((prev) => prev.filter((item) => item !== color))
  }

  /** Множитель выделенного куска. Свойства нет — значит «как есть», то есть 1. */
  const currentScale = Number(editor.getAttributes(MARK_SCALE).scale) || 1

  /** Шаг множителя. Вернулись к единице — свойство снимается совсем. */
  const bumpScale = (delta: number) => {
    const next = stepScale(currentScale, delta)
    const chain = editor.chain().focus()
    if (next === null) chain.unsetMark(MARK_SCALE).run()
    else chain.setMark(MARK_SCALE, { scale: next }).run()
  }

  /** Цвет выделенного куска — с него начинает нативный выбор. */
  const activeColor =
    normalizeColor(String(editor.getAttributes(MARK_COLOR).color ?? "")) ??
    "#FFFFFF"

  const swatchButton = (color: string, removable = false) => {
    const swatch = (
      <button
        type="button"
        title={color}
        aria-label={color}
        onMouseDown={(e) => {
          e.preventDefault()
          pickColor(color)
          setColorOpen(false)
        }}
        className="h-[22px] w-[22px] shrink-0 rounded-[5px] border border-foreground/20 hover:border-foreground/50"
        // Инлайновый стиль здесь законен: это значение из файла, а не токен темы.
        style={{ backgroundColor: color }}
      />
    )

    if (!removable) return <span key={color}>{swatch}</span>

    return (
      <span key={color} className="group relative inline-flex">
        {swatch}
        {/* Крестик СОСЕДОМ, а не внутри образца: кнопка внутри кнопки —
            недопустимая разметка, и браузеры разбирают её кто во что горазд. */}
        <button
          type="button"
          title={t.elementTextColorForget}
          aria-label={t.elementTextColorForget}
          onMouseDown={(e) => {
            e.preventDefault()
            forgetColor(color)
          }}
          className="absolute -right-1 -top-1 hidden h-[14px] w-[14px] items-center justify-center rounded-full border border-foreground/20 bg-ws-raised text-ws-3 hover:text-destructive group-hover:flex"
        >
          <X className="h-[9px] w-[9px]" />
        </button>
      </span>
    )
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-foreground/[0.07]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-[2px] border-b border-foreground/[0.07] bg-ws-panel px-2 py-1.5">
        <ToolButton
          title={t.elementTextBold}
          icon={Bold}
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          title={t.elementTextItalic}
          icon={Italic}
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />

        <Popover
          open={colorOpen}
          onOpenChange={(next) => {
            // Последний рубеж: любой путь к закрытию во время нативного выбора
            // игнорируем, каким бы событием радикс его ни вызвал.
            if (!next && isNativePicking()) return
            setColorOpen(next)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t.elementTextColor}
              aria-label={t.elementTextColor}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
            >
              <Baseline className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            onInteractOutside={(e) => {
              if (isNativePicking()) e.preventDefault()
            }}
            onFocusOutside={(e) => {
              if (isNativePicking()) e.preventDefault()
            }}
            className="w-[232px] border-border/60 bg-ws-raised p-2"
          >
            {usedColors.length > 0 ? (
              <>
                <p className="mb-1 text-[11px] text-ws-4">{t.elementTextColorUsed}</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {usedColors.map((color) => swatchButton(color, true))}
                </div>
              </>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {swatches.map((color) => swatchButton(color))}
            </div>

            {/*
              Произвольный цвет — НАТИВНЫМ полем, как в контроле титров и в
              настройке тени (`components/account/options/title-control.tsx`).
              Это единственный способ дать полный спектр, не заводя в проекте
              третий свой пикер; заодно человек получает привычную пипетку
              системы.

              Ставим цвет на `change` (его видно сразу, пока крутят), а
              запоминаем в «использованные» только на `blur` — иначе ряд
              зарос бы десятком промежуточных оттенков одного движения.
            */}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="color"
                value={activeColor}
                title={t.elementTextColorPick}
                aria-label={t.elementTextColorPick}
                onPointerDown={() => {
                  nativePickRef.current = true
                }}
                onChange={(e) => applyColor(e.target.value)}
                onBlur={(e) => {
                  rememberColor(e.target.value)
                  nativePickRef.current = false
                }}
                className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border/60 bg-transparent"
              />
              <Input
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                placeholder="#RRGGBB"
                className="h-7 border-foreground/10 bg-ws-control text-[12px] text-ws-1"
              />
              <Button
                type="button"
                size="sm"
                disabled={!normalizeColor(customColor)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickColor(customColor)
                  setCustomColor("")
                  setColorOpen(false)
                }}
                className="h-7 bg-ws-action text-white hover:bg-ws-action-hover"
              >
                {t.elementChoose}
              </Button>
            </div>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                pickColor(null)
                setColorOpen(false)
              }}
              className="mt-2 text-[12px] text-ws-3 hover:text-destructive"
            >
              {t.elementTextColorClear}
            </button>
          </PopoverContent>
        </Popover>

        {/*
          Размер — шагами, а не выбором из списка: «правильных» значений у
          множителя нет (план §8.2), есть «чуть больше» и «чуть меньше».
          Единица означает «как есть», и на ней свойство снимается совсем —
          писать в файл `x1` незачем.
        */}
        <div
          title={`${t.elementTextScale} — ${t.elementTextScaleHint}`}
          className="flex h-7 shrink-0 items-center rounded-[6px] border border-foreground/10"
        >
          <button
            type="button"
            aria-label={`${t.elementTextScale} −`}
            onMouseDown={(e) => {
              e.preventDefault()
              bumpScale(-ELEMENT_SCALE_STEP)
            }}
            className="flex h-full w-6 items-center justify-center rounded-l-[5px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Minus className="h-[13px] w-[13px]" />
          </button>

          <span className="w-9 text-center text-[12px] tabular-nums text-ws-2">
            {`×${currentScale}`}
          </span>

          <button
            type="button"
            aria-label={`${t.elementTextScale} +`}
            onMouseDown={(e) => {
              e.preventDefault()
              bumpScale(ELEMENT_SCALE_STEP)
            }}
            className="flex h-full w-6 items-center justify-center rounded-r-[5px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Plus className="h-[13px] w-[13px]" />
          </button>
        </div>

        <Popover
          open={noteOpen}
          onOpenChange={(open) => {
            setNoteOpen(open)
            if (open) {
              const current = editor.getAttributes(MARK_NOTE).note
              setNoteDraft(typeof current === "string" ? current : "")
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title={`${t.elementTextNote} — ${t.elementTextNoteHint}`}
              aria-label={t.elementTextNote}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors",
                "text-ws-3 hover:bg-foreground/[0.07] hover:text-ws-1",
                editor.isActive(MARK_NOTE) && "bg-ws-select/[0.18] text-ws-1",
              )}
            >
              <MessageSquare className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[260px] border-border/60 bg-ws-raised p-2"
          >
            <p className="mb-1.5 text-[11px] text-ws-4">{t.elementTextNoteHint}</p>
            <Input
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t.elementTextNoteAsk}
              className="h-8 border-foreground/10 bg-ws-control text-[13px] text-ws-1"
            />
            <div className="mt-2 flex justify-between gap-2">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  editor.chain().focus().unsetMark(MARK_NOTE).run()
                  setNoteOpen(false)
                }}
                className="text-[12px] text-ws-3 hover:text-destructive"
              >
                {t.elementTextClear}
              </button>
              <Button
                type="button"
                size="sm"
                disabled={!noteDraft.trim()}
                onMouseDown={(e) => {
                  e.preventDefault()
                  editor
                    .chain()
                    .focus()
                    .setMark(MARK_NOTE, { note: noteDraft.trim() })
                    .run()
                  setNoteOpen(false)
                }}
                className="h-7 bg-ws-action text-white hover:bg-ws-action-hover"
              >
                {t.elementChoose}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <ToolButton
          title={t.elementTextClear}
          icon={RemoveFormatting}
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        />
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto bg-ws-control p-3 text-[14px] leading-relaxed text-ws-1">
        <EditorContent editor={editor} />
        {editor.isEmpty ? (
          <p className="pointer-events-none -mt-[1.6em] text-[14px] text-ws-5">
            {tf("{text}", { text: t.elementTextPlaceholder })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
