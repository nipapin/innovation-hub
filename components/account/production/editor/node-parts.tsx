"use client"

import { useEffect, useRef, useState } from "react"
import { Handle, NodeResizeControl, Position } from "@xyflow/react"
import { Folder, FolderPlus, X } from "lucide-react"

import { useI18n, type DictKey } from "@/components/account/i18n"
import { IN_HANDLE, OUT_HANDLE, type NodeKind } from "@/lib/production/graph"
import { PRODUCTION_MASKS, unknownMasks, type MaskScope } from "@/lib/production/masks"
import { cn } from "@/lib/utils"
import { useEditor } from "./editor-context"

/**
 * Части нод редактора — docs/PRODUCTION_PLAN.md §3.0, эскизы и правки 2026-10-01.
 *
 * Вход слева и выход справа — по одному, связей в каждом сколько угодно (§3.3).
 * Цвет шапки — по типу, как в программе: «Старт» зелёный, «Инструмент» голубой,
 * «Форма» фиолетовая, «Автоматика» жёлтая, «Действие» серое.
 */
export function InHandle() {
  return (
    <Handle
      id={IN_HANDLE}
      type="target"
      position={Position.Left}
      className="!h-3.5 !w-3.5 !border-2 !border-background !bg-ws-accent"
    />
  )
}

export function OutHandle() {
  return (
    <Handle
      id={OUT_HANDLE}
      type="source"
      position={Position.Right}
      className="!h-3.5 !w-3.5 !border-2 !border-background !bg-success"
    />
  )
}

const HEADER: Record<NodeKind, string> = {
  start: "bg-success/20 border-success/30",
  tool: "bg-info/20 border-info/30",
  form: "bg-violet/20 border-violet/30",
  auto: "bg-warning/20 border-warning/30",
  action: "bg-foreground/10 border-foreground/15",
}

/** Ширина по умолчанию — пока ноду не растянули. */
export const DEFAULT_WIDTH: Record<NodeKind, number> = {
  start: 380,
  tool: 420,
  form: 460,
  auto: 420,
  action: 360,
}

/**
 * Рамка ноды: цветная шапка с названием (правится; по умолчанию — тип ноды),
 * вход и выход, красная рамка при ошибке проверки. Ширина — у обёртки xyflow:
 * ноду тянут за уголок справа внизу.
 */
export function NodeFrame({
  id,
  kind,
  kindLabel,
  name,
  onRename,
  removable,
  input = true,
  output = true,
  children,
}: {
  id: string
  kind: NodeKind
  kindLabel: string
  name: string
  onRename: (name: string) => void
  removable: boolean
  input?: boolean
  output?: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const { readOnly, removeNode, nodeHasError } = useEditor()

  return (
    <div
      className={cn(
        "relative h-full w-full rounded-xl border bg-ws-panel shadow-ws-panel",
        nodeHasError(id) ? "border-destructive/60" : "border-foreground/15",
      )}
    >
      {readOnly ? null : (
        // Уголок справа внизу, а не полоса во всю высоту: полоса у края ноды
        // спорила с выходом и выглядела как сбой отрисовки.
        <NodeResizeControl
          position="bottom-right"
          resizeDirection="horizontal"
          minWidth={280}
          maxWidth={1600}
          className="group/resize !h-4 !w-4 !-translate-x-full !-translate-y-full !border-0 !bg-transparent"
          style={{ cursor: "ew-resize" }}
        >
          <span className="absolute bottom-1 right-1 h-2 w-2 rounded-br-[3px] border-b-2 border-r-2 border-foreground/25 group-hover/resize:border-ws-accent" />
        </NodeResizeControl>
      )}
      {input ? <InHandle /> : null}
      {output ? <OutHandle /> : null}
      <div className={cn("flex items-center gap-2 rounded-t-xl border-b px-3 py-2", HEADER[kind])}>
        <input
          value={name}
          disabled={readOnly}
          onChange={(event) => onRename(event.target.value)}
          aria-label={t.productionEdStageName}
          className="nodrag min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ws-1 outline-none"
        />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[1.2px] text-ws-3">{kindLabel}</span>
        {removable && !readOnly ? (
          <button
            type="button"
            aria-label={t.productionEdRemoveNode}
            title={t.productionEdRemoveNode}
            onClick={() => removeNode(id)}
            className="nodrag flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-semibold uppercase tracking-[1px] text-ws-4">{children}</div>
}

/** Тонкий разделитель между частями ноды: люди · папки · настройки типа. */
export function Divider() {
  return <div className="-mx-3 border-t border-foreground/10" />
}

// ─── Автокомплит ──────────────────────────────────────────────────────────

/**
 * История ввода — как `userInputHistory_store` программы: по ключу поля,
 * новые сверху, без повторов, у каждой записи крестик. Живёт в браузере.
 */
const HISTORY_KEY = "ffworks-production-input-history"

function readHistory(key: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, string[]>
    return Array.isArray(all[key]) ? all[key] : []
  } catch {
    return []
  }
}

function writeHistory(key: string, fn: (list: string[]) => string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, string[]>
    all[key] = fn(Array.isArray(all[key]) ? all[key] : []).slice(0, 50)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all))
  } catch {
    // Хранилище браузера недоступно — история просто не пишется.
  }
}

/**
 * Разделители слов — как `WORD_SPLIT_REGEX` программы; `$` разделителем не
 * является, поэтому `D` находит `$DD` подстрокой.
 */
const WORD_SPLIT = /[\s[\]{}()"'`.,\-_/\\:;!?]+/

function activeWord(text: string): string {
  const parts = text.split(WORD_SPLIT)
  return parts[parts.length - 1] ?? ""
}

type Option = { value: string; hint?: string; history?: boolean; create?: boolean; id?: string }

/**
 * Список подсказок под полем: открывается при фокусе, фильтруется на каждый
 * символ подстрокой по слову под курсором. Стрелки только подсвечивают —
 * ничего не выбирая; Tab подставляет подсвеченное в поле, Enter фиксирует,
 * Escape закрывает (`ChipAutocompleteProperty` программы).
 */
function useSuggest(options: Option[], text: string) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const word = activeWord(text).toLowerCase()
  const shown = options.filter((o) => o.create || !word || o.value.toLowerCase().includes(word))
  useEffect(() => setActive(-1), [text])
  const move = (delta: number) => {
    if (shown.length === 0) return
    // Через -1: «ничего не подсвечено» — тоже положение.
    const n = shown.length + 1
    setActive((((active + 1 + delta) % n) + n) % n - 1)
  }
  return { open, setOpen, active, shown, move, current: active >= 0 ? shown[active] : null }
}

function replaceWord(text: string, value: string): string {
  const word = activeWord(text)
  return text.slice(0, text.length - word.length) + value
}

function SuggestList({
  options,
  active,
  onPick,
  onForget,
}: {
  options: Option[]
  active: number
  onPick: (option: Option) => void
  onForget?: (value: string) => void
}) {
  const { t } = useI18n()
  if (options.length === 0) return null
  return (
    <div className="nowheel absolute left-0 top-full z-30 mt-1 max-h-60 w-full min-w-[220px] overflow-y-auto rounded-md border border-foreground/10 bg-popover p-1 shadow-ws-menu">
      {options.map((option, index) => (
        <div
          key={`${option.id ?? option.value}-${option.create ? "c" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(option)
          }}
          className={cn(
            "group flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12px]",
            index === active ? "bg-ws-select/35 text-ws-1" : "text-ws-2 hover:bg-ws-hover",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
            {option.create ? <FolderPlus className="h-3.5 w-3.5 shrink-0" /> : option.id ? <Folder className="h-3.5 w-3.5 shrink-0" /> : null}
            {option.create ? t.productionEdCreateFolder.replace("{name}", option.value) : option.value}
          </span>
          {option.hint ? <span className="truncate text-ws-4">{option.hint}</span> : null}
          {option.history && onForget ? (
            <button
              type="button"
              aria-label={t.productionEdForget}
              title={t.productionEdForget}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onForget(option.value)
              }}
              className="hidden text-ws-4 hover:text-ws-1 group-hover:block"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function maskOptions(scope: MaskScope, t: Record<string, string>): Option[] {
  return PRODUCTION_MASKS.filter((m) => m.scopes.includes(scope)).map((m) => ({
    value: m.token,
    hint: t[m.labelKey as DictKey],
  }))
}

/**
 * Путь масками — сегменты-фишки, как ввод пути в программе. Enter фиксирует
 * сегмент (и запоминает его в истории поля), Backspace в пустом поле снимает
 * последний, двойной клик по фишке — правка.
 */
export function PathInput({
  value,
  onChange,
  scope = "path",
  historyKey,
  placeholder,
}: {
  value: string[]
  onChange: (next: string[]) => void
  scope?: MaskScope
  historyKey: string
  placeholder?: string
}) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const [text, setText] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const key = `path:${historyKey}`
  useEffect(() => setHistory(readHistory(key)), [key])

  const masks = maskOptions(scope, t as unknown as Record<string, string>)
  const options: Option[] = [
    ...history.filter((h) => !masks.some((m) => m.value === h)).map((value) => ({ value, history: true })),
    ...masks,
  ]
  const suggest = useSuggest(options, text)

  const commit = (raw: string) => {
    const segment = raw.trim()
    if (!segment) return
    onChange([...value, segment])
    setText("")
    if (!masks.some((m) => m.value === segment)) {
      writeHistory(key, (list) => (list.includes(segment) ? list : [segment, ...list]))
      setHistory(readHistory(key))
    }
  }

  return (
    <div className="nodrag relative">
      <div
        onClick={(event) => (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
        className={cn(
          "flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-foreground/10 bg-ws-control px-1.5 py-1",
          readOnly && "opacity-60",
        )}
      >
        {value.map((segment, index) => {
          const bad = unknownMasks(segment, scope).length > 0
          return (
            <span
              key={`${segment}-${index}`}
              onDoubleClick={() => {
                if (readOnly) return
                setText(segment)
                onChange(value.filter((_, i) => i !== index))
              }}
              className={cn(
                "flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11.5px]",
                bad ? "bg-destructive/15 text-destructive" : "bg-ws-select/35 text-ws-1",
              )}
              title={bad ? t.productionEdUnknownMask : undefined}
            >
              {segment}
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={t.productionEdRemoveSegment}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className="text-ws-4 hover:text-ws-1"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {index < value.length - 1 ? <span className="pl-0.5 text-ws-5">/</span> : null}
            </span>
          )
        })}
        {readOnly ? null : (
          <input
            value={text}
            onFocus={() => suggest.setOpen(true)}
            onBlur={() => {
              suggest.setOpen(false)
              commit(text)
            }}
            onChange={(event) => {
              setText(event.target.value)
              suggest.setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                suggest.setOpen(true)
                suggest.move(event.key === "ArrowDown" ? 1 : -1)
              } else if (event.key === "Tab" && suggest.open && suggest.current) {
                event.preventDefault()
                setText(replaceWord(text, suggest.current.value))
              } else if (event.key === "Enter") {
                event.preventDefault()
                commit(suggest.open && suggest.current ? replaceWord(text, suggest.current.value) : text)
              } else if (event.key === "Escape") {
                suggest.setOpen(false)
              } else if (event.key === "Backspace" && !text && value.length > 0) {
                onChange(value.slice(0, -1))
              }
            }}
            placeholder={value.length === 0 ? (placeholder ?? t.productionEdPathPlaceholder) : ""}
            className="min-w-[60px] flex-1 bg-transparent text-[12px] text-ws-1 outline-none placeholder:text-ws-5"
          />
        )}
      </div>
      {suggest.open ? (
        <SuggestList
          options={suggest.shown}
          active={suggest.active}
          onPick={(option) => commit(replaceWord(text, option.value))}
          onForget={(v) => {
            writeHistory(key, (list) => list.filter((x) => x !== v))
            setHistory(readHistory(key))
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Основная папка этапа — проект владельца на верхнем уровне (§2.2): выбрать из
 * своих, ввести имя новой (она заведётся при активации) или, пока пайплайн
 * черновик, `$pipelineName`. Чужие папки не предлагаются: расшарить их
 * пайплайн не может.
 */
export function ProjectPicker({
  value,
  onChange,
}: {
  value: { id: string | null; name: string }
  onChange: (next: { id: string | null; name: string }) => void
}) {
  const { t } = useI18n()
  const { readOnly, projects, isDraft } = useEditor()
  const [text, setText] = useState<string | null>(null)
  const shownText = text ?? value.name
  const inputRef = useRef<HTMLInputElement>(null)

  const typed = (text ?? "").trim()
  const exact = projects.find((p) => p.name.toLowerCase() === typed.toLowerCase())
  const options: Option[] = [
    ...(isDraft ? [{ value: "$pipelineName", hint: t.productionMaskPipeline }] : []),
    ...projects.map((p) => ({ value: p.name, id: p.id })),
    ...(typed && !exact && typed !== "$pipelineName" ? [{ value: typed, create: true }] : []),
  ]
  const suggest = useSuggest(options, text ?? "")

  const pick = (option: Option) => {
    onChange(option.id ? { id: option.id, name: option.value } : { id: null, name: option.value })
    setText(null)
    suggest.setOpen(false)
    inputRef.current?.blur()
  }
  const commitTyped = () => {
    if (text === null) return
    if (!typed) setText(null)
    else pick(exact ? { value: exact.name, id: exact.id } : { value: typed })
  }
  const pending = !value.id

  return (
    <div className="nodrag relative">
      <div className="flex h-8 items-center gap-2 rounded-md border border-foreground/10 bg-ws-control px-2">
        {pending ? <FolderPlus className="h-4 w-4 shrink-0 text-warning" /> : <Folder className="h-4 w-4 shrink-0 text-ws-3" />}
        <input
          ref={inputRef}
          value={shownText}
          disabled={readOnly}
          onFocus={() => {
            setText("")
            suggest.setOpen(true)
          }}
          onBlur={() => {
            suggest.setOpen(false)
            commitTyped()
          }}
          onChange={(event) => {
            setText(event.target.value)
            suggest.setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              suggest.move(event.key === "ArrowDown" ? 1 : -1)
            } else if (event.key === "Tab" && suggest.current) {
              event.preventDefault()
              setText(suggest.current.value)
            } else if (event.key === "Enter") {
              event.preventDefault()
              if (suggest.current) pick(suggest.current)
              else commitTyped()
            } else if (event.key === "Escape") {
              setText(null)
              inputRef.current?.blur()
            }
          }}
          placeholder={value.name}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ws-1 outline-none placeholder:text-ws-4 disabled:opacity-60"
        />
        {pending ? <span className="shrink-0 text-[10.5px] text-warning">{t.productionEdFolderOnActivate}</span> : null}
      </div>
      {suggest.open ? <SuggestList options={suggest.shown} active={suggest.active} onPick={pick} /> : null}
    </div>
  )
}

/** Срок в днях: слайдер 0–30 и поле, куда можно вписать и больше. 0 — не удалять. */
export function DaysInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const clamp = (n: number) => Math.max(0, Math.min(3650, Math.round(Number.isFinite(n) ? n : 0)))
  return (
    <div className="nodrag space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={30}
          disabled={readOnly}
          value={Math.min(value, 30)}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          className="min-w-0 flex-1 accent-[hsl(var(--success))]"
        />
        <input
          type="number"
          min={0}
          max={3650}
          disabled={readOnly}
          value={value}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          className="h-6 w-14 rounded border border-foreground/10 bg-ws-control px-1.5 text-right text-[12px] tabular-nums text-ws-1 outline-none"
        />
        <span className="w-16 shrink-0 text-[11px] text-ws-4">
          {value === 0 ? t.productionEdKeepForever : t.productionEdDays}
        </span>
      </div>
    </div>
  )
}
