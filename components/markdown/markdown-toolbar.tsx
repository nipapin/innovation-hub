"use client"

import { useState } from "react"
import {
  ALargeSmall,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Columns2,
  Eye,
  Heading,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  Monitor,
  PenLine,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Smartphone,
  Smile,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
  Type,
  Underline,
  Undo2,
  Workflow,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { tf } from "@/components/account/i18n"
import {
  MARKDOWN_GRAYS,
  MARKDOWN_HUES,
  MARKDOWN_TONES,
  type AlignKind,
} from "@/lib/markdown/description-format"
import type { EditorApi } from "@/lib/markdown/editor-api"
import { cn } from "@/lib/utils"
import { useMdDict, type MdDict } from "./md-dict"

/**
 * Панель кнопок редактора описания — по образцу формы ответа на форуме.
 *
 * Набор повторяет панель в программе (`src/components/markdown/MarkdownToolbar.tsx`),
 * потому что автор описания работает в двух местах и не должен искать кнопки
 * заново. Размера и семейства шрифта здесь нет намеренно: формат их не
 * выражает, а жёсткие размеры — ровно то, из-за чего вёрстка рассыпается на
 * узком экране. Их работу делает «стиль абзаца».
 *
 * ⚠️ `ToolButton` и `ColorPalette` объявлены НА УРОВНЕ МОДУЛЯ, а не внутри
 * компонента панели. Когда они были внутри (в программе так и было), каждый
 * рендер создавал новый тип компонента → React размонтировал поддерево на любое
 * изменение состояния, и поповер терял свой триггер.
 *
 * `onMouseDown` + `preventDefault` вместо `onClick`: клик сначала уводит фокус
 * из поля ввода, и выделение теряется до того, как команда его прочитает.
 */

/**
 * Как правится описание.
 *
 * `rich` — правка сразу в отрисованном виде (документ Tiptap), остальные три —
 * markdown-текст: с превью рядом, без него или одно превью. Набор режимов шире,
 * чем в программе (`rich | md`): там нет отдельного окна под превью, а здесь
 * панель описания узкая, и разложить текст с превью рядом получается не всегда.
 */
export type ViewMode = "rich" | "split" | "text" | "preview"

interface ToolButtonProps {
  title: string
  icon: typeof Bold
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}

function ToolButton({ title, icon: Icon, onClick, disabled, active }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick?.()
      }}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors",
        "text-ws-3 hover:bg-foreground/[0.07] hover:text-ws-1",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-ws-select/[0.18] text-ws-1",
      )}
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
    </button>
  )
}

const Separator = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-foreground/[0.08]" />

const HUE_LABELS: Record<string, keyof MdDict> = {
  blue: "hueBlue",
  green: "hueGreen",
  orange: "hueOrange",
  red: "hueRed",
  yellow: "hueYellow",
  teal: "hueTeal",
  purple: "huePurple",
  cyan: "hueCyan",
  pink: "huePink",
  muted: "hueMuted",
}

const TONE_LABELS: Record<string, keyof MdDict> = {
  "": "toneStrong",
  "-2": "toneMedium",
  "-3": "toneSoft",
}

const GRAY_LABELS: Record<string, keyof MdDict> = {
  "gray-0": "gray0",
  "gray-1": "gray1",
  "gray-2": "gray2",
  "gray-3": "gray3",
  "gray-4": "gray4",
  "gray-5": "gray5",
}

/**
 * Сетка образцов: строка на ступень насыщенности, отдельная строка — серая
 * шкала. Цвет образца берётся из тех же классов палитры, что и цвет текста в
 * описании (`.md-palette` в globals.css) — поэтому кнопка и результат не могут
 * разъехаться, и ни одного кода цвета в коде панели нет.
 */
function ColorPalette({
  kind,
  onPick,
  t,
}: {
  kind: "fg" | "bg"
  onPick: (key: string | null) => void
  t: MdDict
}) {
  const swatch = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault()
        onPick(key)
      }}
      className="flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded-[5px] border border-foreground/10 bg-ws-control hover:border-foreground/40"
    >
      {kind === "fg" ? (
        <span className={cn("text-[13px] font-semibold leading-none", `fg-${key}`)}>A</span>
      ) : (
        <span className={cn("h-full w-full", `bg-${key}`)} />
      )}
    </button>
  )

  return (
    <div className="md-palette flex flex-col gap-1">
      {MARKDOWN_TONES.map((tone) => (
        <div key={tone || "base"} className="flex gap-1">
          {MARKDOWN_HUES.map((hue) =>
            swatch(`${hue}${tone}`, `${t[HUE_LABELS[hue]]}, ${t[TONE_LABELS[tone]]}`),
          )}
        </div>
      ))}

      <div className="my-1 h-px w-full bg-foreground/[0.08]" />

      <div className="flex gap-1">
        {MARKDOWN_GRAYS.map((gray) => swatch(gray, t[GRAY_LABELS[gray]]))}
      </div>

      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          onPick(null)
        }}
        className="mt-1 self-start text-[12px] text-ws-3 hover:text-destructive"
      >
        {kind === "fg" ? t.clearTextColor : t.clearFillColor}
      </button>
    </div>
  )
}

const EMOJI = [
  "✅","❌","⚠️","❗","❓","💡","🔥","⭐","🎯","📌",
  "📎","📁","📄","🎬","🎞️","🖼️","🎵","🎧","🔊","🕐",
  "⏱️","🚀","🔧","🔨","⚙️","🧩","📊","📈","📉","💰",
  "🤖","🧠","👍","👎","🙂","😀","😅","😐","😢","🎉",
  "✨","🔒","🔑","🌐","📝","🗑️","♻️","🆗",
]

export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20]

const HEADING_LEVELS: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4]

const ALIGNS: Array<{ kind: AlignKind; label: keyof MdDict; icon: typeof Bold }> = [
  { kind: "left", label: "alignLeft", icon: AlignLeft },
  { kind: "center", label: "alignCenter", icon: AlignCenter },
  { kind: "right", label: "alignRight", icon: AlignRight },
  { kind: "justify", label: "alignJustify", icon: AlignJustify },
]

const VIEWS: Array<{ mode: ViewMode; label: keyof MdDict; icon: typeof Bold }> = [
  { mode: "rich", label: "viewRich", icon: PenLine },
  { mode: "split", label: "viewSplit", icon: Columns2 },
  { mode: "text", label: "viewText", icon: Type },
  { mode: "preview", label: "viewPreview", icon: Eye },
]

export interface MarkdownToolbarProps {
  api: EditorApi
  onLink: () => void
  onImage: () => void
  onTable: () => void
  onCodeBlock: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  view: ViewMode
  setView: (mode: ViewMode) => void
  narrow: boolean
  setNarrow: (value: boolean) => void
  fontSize: number
  setFontSize: (size: number) => void
  /** Вес файла или «обработка картинки…» — правый край панели. */
  status: string
  statusWarn: boolean
}

export function MarkdownToolbar({
  api,
  onLink,
  onImage,
  onTable,
  onCodeBlock,
  undo,
  redo,
  canUndo,
  canRedo,
  view,
  setView,
  narrow,
  setNarrow,
  fontSize,
  setFontSize,
  status,
  statusWarn,
}: MarkdownToolbarProps) {
  const t = useMdDict()
  const [fgOpen, setFgOpen] = useState(false)
  const [bgOpen, setBgOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-[2px] border-b border-foreground/[0.07] bg-ws-panel px-2 py-1.5">
      {/* 1. История */}
      <ToolButton title={t.undo} icon={Undo2} onClick={undo} disabled={!canUndo} />
      <ToolButton title={t.redo} icon={Redo2} onClick={redo} disabled={!canRedo} />
      <Separator />

      {/* 2. Символ */}
      <ToolButton title={t.bold} icon={Bold} active={api.isActive("bold")} onClick={api.bold} />
      <ToolButton title={t.italic} icon={Italic} active={api.isActive("italic")} onClick={api.italic} />
      <ToolButton
        title={t.underline}
        icon={Underline}
        active={api.isActive("underline")}
        onClick={api.underline}
      />
      <ToolButton
        title={t.strike}
        icon={Strikethrough}
        active={api.isActive("strike")}
        onClick={api.strike}
      />

      <Popover open={fgOpen} onOpenChange={setFgOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t.textColor}
            aria-label={t.textColor}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Baseline className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-border/60 bg-ws-raised p-2">
          <ColorPalette
            kind="fg"
            t={t}
            onPick={(key) => {
              api.color("fg", key)
              setFgOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      <Popover open={bgOpen} onOpenChange={setBgOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t.fillColor}
            aria-label={t.fillColor}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Highlighter className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-border/60 bg-ws-raised p-2">
          <ColorPalette
            kind="bg"
            t={t}
            onPick={(key) => {
              api.color("bg", key)
              setBgOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      <ToolButton
        title={t.inlineCode}
        icon={Code}
        active={api.isActive("code")}
        onClick={api.inlineCode}
      />
      <ToolButton title={t.clearFormat} icon={RemoveFormatting} onClick={api.clearFormat} />
      <Separator />

      {/* 3. Абзац */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t.paragraphStyle}
            aria-label={t.paragraphStyle}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Heading className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-border/60 bg-ws-raised">
          {HEADING_LEVELS.map((level) => (
            <DropdownMenuItem
              key={level}
              onSelect={() => api.heading(level)}
              className="text-[13px] text-ws-2"
            >
              {level === 0 ? t.normalText : tf(t.heading, { level })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton title={t.indentParagraph} icon={Pilcrow} onClick={api.indentParagraph} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t.alignment}
            aria-label={t.alignment}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <AlignLeft className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-border/60 bg-ws-raised">
          {ALIGNS.map((item) => (
            <DropdownMenuItem
              key={item.kind}
              onSelect={() => api.align(item.kind)}
              className="gap-2 text-[13px] text-ws-2"
            >
              <item.icon className="h-3.5 w-3.5" />
              {t[item.label]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton
        title={t.quote}
        icon={TextQuote}
        active={api.isActive("blockquote")}
        onClick={api.quote}
      />
      <ToolButton title={t.hr} icon={Minus} onClick={api.hr} />
      <ToolButton
        title={t.details}
        icon={ListCollapse}
        active={api.isActive("details")}
        onClick={api.details}
      />
      <Separator />

      {/* 4. Списки */}
      <ToolButton
        title={t.bulletList}
        icon={List}
        active={api.isActive("bulletList")}
        onClick={() => api.list("ul")}
      />
      <ToolButton
        title={t.orderedList}
        icon={ListOrdered}
        active={api.isActive("orderedList")}
        onClick={() => api.list("ol")}
      />
      <ToolButton
        title={t.checkList}
        icon={ListTodo}
        active={api.isActive("taskList")}
        onClick={() => api.list("check")}
      />
      <ToolButton title={t.indentMore} icon={IndentIncrease} onClick={() => api.indent(1)} />
      <ToolButton title={t.indentLess} icon={IndentDecrease} onClick={() => api.indent(-1)} />
      <Separator />

      {/* 5. Вставка */}
      <ToolButton title={t.link} icon={LinkIcon} active={api.isActive("link")} onClick={onLink} />
      <ToolButton title={t.image} icon={ImageIcon} onClick={onImage} />
      <ToolButton title={t.table} icon={TableIcon} onClick={onTable} />
      <ToolButton
        title={t.codeBlock}
        icon={SquareCode}
        active={api.isActive("codeBlock")}
        onClick={onCodeBlock}
      />
      <ToolButton title={t.mermaid} icon={Workflow} onClick={api.mermaid} />

      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t.emoji}
            aria-label={t.emoji}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
          >
            <Smile className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[248px] border-border/60 bg-ws-raised p-2">
          <div className="flex flex-wrap gap-0.5">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  api.insert(emoji)
                  setEmojiOpen(false)
                }}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-[16px] hover:bg-foreground/[0.07]"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 6. Вид — настройки просмотра, в файл они не попадают */}
      <div className="ml-auto flex items-center gap-[2px]">
        <span
          className={cn(
            "mr-1 text-[11px] tabular-nums",
            statusWarn ? "text-warning" : "text-ws-4",
          )}
        >
          {status}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={tf(t.fontSizeTitle, { size: fontSize })}
              aria-label={tf(t.fontSizeTitle, { size: fontSize })}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ws-3 transition-colors hover:bg-foreground/[0.07] hover:text-ws-1"
            >
              <ALargeSmall className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-border/60 bg-ws-raised">
            {FONT_SIZES.map((size) => (
              <DropdownMenuItem
                key={size}
                onSelect={() => setFontSize(size)}
                className={cn("text-[13px]", size === fontSize ? "text-ws-1" : "text-ws-2")}
              >
                {size} px
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {VIEWS.map((item) => (
          <ToolButton
            key={item.mode}
            title={t[item.label]}
            icon={item.icon}
            active={view === item.mode}
            onClick={() => setView(item.mode)}
          />
        ))}
        <Separator />
        <ToolButton
          title={narrow ? t.narrowOn : t.narrowOff}
          icon={narrow ? Smartphone : Monitor}
          onClick={() => setNarrow(!narrow)}
        />
      </div>
    </div>
  )
}
