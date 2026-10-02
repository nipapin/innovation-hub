"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Minus, Plus } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { columnCount, padRows, parseTable, writeTable } from "@/lib/text-formats/table"
import { cn } from "@/lib/utils"
import { MarkupEditor } from "./markup-editor"
import { MarkupView } from "./markup-view"
import { EditFooter } from "./plain-editor"

/**
 * Таблица csv/tsv (docs/TEXT_FORMATS_PLAN.md §1, шаг 3) — надстройка над
 * текстом: ячейка — та же разметка §8.2, что и `.txt`, показ — `MarkupView`,
 * правка — `MarkupEditor`. Сама таблица добавляет только строки, столбцы и их
 * размеры.
 *
 * Ширина столбцов и высота строк — настройка человека, а не файла: живут в
 * `localStorage` по ключу файла и в файл не пишутся никогда.
 *
 * Первая строка выделена как заголовок, но остаётся данными: у csv нет
 * признака «это шапка», и править её можно так же, как остальные.
 */

const DEFAULT_WIDTH = 160
const MIN_WIDTH = 48
const MIN_HEIGHT = 24
/** Все размеры — одной записью; свежие файлы в конце, старше MAX_FILES вытесняются. */
const STORAGE_KEY = "text-table-sizes"
const MAX_FILES = 200

type Sizes = { w: Record<number, number>; h: Record<number, number> }

function readAll(): Record<string, Sizes> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, Sizes>
  } catch {
    // Нет хранилища или мусор в нём — просто размеры по умолчанию.
  }
  return {}
}

function readSizes(key: string): Sizes {
  const parsed = readAll()[key] as Partial<Sizes> | undefined
  return { w: parsed?.w ?? {}, h: parsed?.h ?? {} }
}

function writeSizes(key: string, value: Sizes) {
  try {
    const all = readAll()
    delete all[key]
    all[key] = value
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) delete all[old]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Хранилище переполнено или запрещено — размер живёт до закрытия.
  }
}

/** Сдвинуть размеры за вставленной (+1) или удалённой (-1) строкой/столбцом. */
function shiftSizes(map: Record<number, number>, index: number, delta: 1 | -1) {
  const next: Record<number, number> = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (i < index) next[i] = v
    else if (delta === 1) next[i + 1] = v
    else if (i > index) next[i - 1] = v
  }
  return next
}

type SizeState = { sizes: Sizes; update: (next: (prev: Sizes) => Sizes) => void }

/**
 * Размеры таблицы. `persist` — писать ли каждое изменение в браузер сразу; в
 * редакторе после вставки/удаления строки или столбца размеры становятся
 * черновиком и пишутся только с сохранением файла (иначе «Отмена» оставила бы
 * неизменённому файлу сдвинутые размеры).
 */
function useTableSizes(key: string, persist: { current: boolean } = { current: true }): SizeState {
  const [sizes, setSizes] = useState<Sizes>({ w: {}, h: {} })
  // Читаем после монтирования: на сервере localStorage нет.
  useEffect(() => setSizes(readSizes(key)), [key])

  const update = useCallback(
    (next: (prev: Sizes) => Sizes) => {
      setSizes((prev) => {
        const value = next(prev)
        if (persist.current) writeSizes(key, value)
        return value
      })
    },
    // persist — ref, меняется без перерисовки
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return { sizes, update }
}

/** A, B, …, Z, AA, AB… — подпись столбца. */
function columnLabel(index: number): string {
  let n = index + 1
  let out = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Тянем границу мышью: от начального размера плюс сдвиг указателя. */
function startDrag(
  event: React.PointerEvent,
  axis: "x" | "y",
  from: number,
  min: number,
  apply: (size: number) => void,
) {
  event.preventDefault()
  event.stopPropagation()
  const origin = axis === "x" ? event.clientX : event.clientY
  const move = (e: PointerEvent) => {
    const pos = axis === "x" ? e.clientX : e.clientY
    apply(Math.max(min, Math.round(from + pos - origin)))
  }
  const up = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    document.body.style.cursor = ""
  }
  document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
}

type Cell = { row: number; col: number }

/**
 * Сетка: подписи столбцов сверху, номера строк слева — за них и тянут размеры
 * (данные под ними не задеваются). Прокрутка — у рамки снаружи.
 */
function TableGrid({
  rows,
  sizes,
  update,
  selected,
  onSelect,
}: SizeState & {
  rows: string[][]
  selected?: Cell | null
  onSelect?: (cell: Cell) => void
}) {
  const columns = Math.max(1, columnCount(rows))
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const widthOf = (col: number) => sizes.w[col] ?? DEFAULT_WIDTH
  const total = 40 + Array.from({ length: columns }, (_, c) => widthOf(c)).reduce((a, b) => a + b, 0)

  return (
    <table
      className="border-separate border-spacing-0 text-[12.5px]"
      style={{ tableLayout: "fixed", width: total }}
    >
      <colgroup>
        <col style={{ width: 40 }} />
        {Array.from({ length: columns }, (_, c) => (
          <col key={c} style={{ width: widthOf(c) }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-30 border-b border-r border-foreground/[0.07] bg-ws-well" />
          {Array.from({ length: columns }, (_, c) => (
            <th
              key={c}
              className="relative sticky top-0 z-20 select-none border-b border-r border-foreground/[0.07] bg-ws-well px-2 py-1 text-center text-[11px] font-normal text-ws-5"
            >
              {columnLabel(c)}
              <span
                aria-hidden
                onPointerDown={(e) =>
                  startDrag(e, "x", widthOf(c), MIN_WIDTH, (w) =>
                    update((prev) => ({ ...prev, w: { ...prev.w, [c]: w } })),
                  )
                }
                onDoubleClick={() =>
                  update((prev) => {
                    const w = { ...prev.w }
                    delete w[c]
                    return { ...prev, w }
                  })
                }
                className="absolute right-0 top-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize hover:bg-ws-select/50"
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {padRows(rows, columns).map((row, r) => {
          const height = sizes.h[r]
          return (
            <tr
              key={r}
              ref={(el) => {
                rowRefs.current[r] = el
              }}
              style={{ height }}
            >
              <td className="relative sticky left-0 z-10 select-none border-b border-r border-foreground/[0.07] bg-ws-well px-1 text-right align-top text-[11px] tabular-nums text-ws-5">
                <span className="block py-1">{r + 1}</span>
                <span
                  aria-hidden
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      "y",
                      rowRefs.current[r]?.offsetHeight ?? MIN_HEIGHT,
                      MIN_HEIGHT,
                      (h) => update((prev) => ({ ...prev, h: { ...prev.h, [r]: h } })),
                    )
                  }
                  onDoubleClick={() =>
                    update((prev) => {
                      const h = { ...prev.h }
                      delete h[r]
                      return { ...prev, h }
                    })
                  }
                  className="absolute bottom-0 left-0 z-10 h-1.5 w-full translate-y-1/2 cursor-row-resize hover:bg-ws-select/50"
                />
              </td>
              {row.map((cell, c) => {
                const isSelected = selected?.row === r && selected?.col === c
                return (
                  <td
                    key={c}
                    onClick={onSelect ? () => onSelect({ row: r, col: c }) : undefined}
                    className={cn(
                      "border-b border-r border-foreground/[0.07] p-0 align-top",
                      r === 0 && "bg-foreground/[0.04] font-medium",
                      onSelect && "cursor-pointer hover:bg-foreground/[0.03]",
                      isSelected && "outline outline-2 -outline-offset-2 outline-ws-select",
                    )}
                  >
                    <div
                      className="overflow-hidden px-2 py-1"
                      style={{ height: height ? height - 1 : undefined }}
                    >
                      <MarkupView source={cell} className="text-[12.5px] leading-snug" />
                    </div>
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Таблица только для чтения. `sizesKey` — устойчивый ключ файла для размеров. */
export function TableView({
  name,
  source,
  sizesKey,
  className,
}: {
  name: string
  source: string
  sizesKey: string
  className?: string
}) {
  const { t } = useI18n()
  const table = useMemo(() => parseTable(name, source), [name, source])
  const sizeState = useTableSizes(sizesKey)
  const note = table.broken
    ? t.textTableBroken
    : tf(t.textTableSize, { rows: table.rows.length, cols: columnCount(table.rows) })

  return (
    <div className={cn("flex h-full w-full min-h-0 flex-col overflow-hidden bg-ws-well", className)}>
      <p className="flex-none border-b border-foreground/[0.07] px-3 py-1.5 text-[11.5px] text-ws-4">
        {note}
      </p>
      <div className="scrollbar-elegant min-h-0 flex-1 overflow-auto">
        <TableGrid rows={table.rows} {...sizeState} />
      </div>
    </div>
  )
}

function ToolButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 items-center gap-1 rounded-[8px] border border-foreground/10 bg-ws-control px-2 text-[12px] text-ws-2 hover:bg-ws-hover disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * Правка таблицы: клик по ячейке открывает под таблицей редактор с
 * оформлением для неё; строки и столбцы добавляются рядом с выбранной ячейкой
 * и удаляются. Сохранение пишет таблицу тем же разделителем и переводом строк.
 */
export function TableFileEditor({
  name,
  initial,
  sizesKey,
  onSave,
  onCancel,
}: {
  name: string
  initial: string
  sizesKey: string
  /** `false` — не сохранилось (черновик размеров тогда откатывается). */
  onSave: (text: string) => Promise<boolean | void>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const parsed = useMemo(() => parseTable(name, initial), [name, initial])
  const [rows, setRows] = useState<string[][]>(() => {
    const padded = padRows(parsed.rows)
    return padded.length > 0 ? padded : [[""]]
  })
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<Cell | null>(null)
  /** Перезагрузить редактор ячейки, когда выбрали другую или её сдвинули. */
  const [editorKey, setEditorKey] = useState(0)
  /** До первой вставки/удаления размеры пишутся сразу, после — только с сохранением. */
  const persistRef = useRef(true)
  const sizeState = useTableSizes(sizesKey, persistRef)
  const shift = (next: (prev: Sizes) => Sizes) => {
    persistRef.current = false
    sizeState.update(next)
  }

  /** Сохранить файл и размеры вместе; размеры пишем до сохранения — просмотр после
   *  него читает их при монтировании, — и откатываем, если файл не сохранился. */
  const save = async () => {
    if (persistRef.current) {
      await onSave(writeTable(rows, parsed.format))
      return
    }
    const before = readSizes(sizesKey)
    writeSizes(sizesKey, sizeState.sizes)
    if ((await onSave(writeTable(rows, parsed.format))) === false) writeSizes(sizesKey, before)
  }

  const columns = Math.max(1, columnCount(rows))
  const cell = selected && rows[selected.row] ? selected : null

  const change = (next: string[][], nextSelected: Cell | null) => {
    setRows(next)
    setDirty(true)
    setSelected(nextSelected)
    setEditorKey((k) => k + 1)
  }

  const select = (next: Cell) => {
    setSelected(next)
    setEditorKey((k) => k + 1)
  }

  const setCell = (value: string) => {
    if (!cell) return
    setRows((prev) => {
      if (prev[cell.row]?.[cell.col] === value) return prev
      setDirty(true)
      return prev.map((row, r) =>
        r === cell.row ? row.map((v, c) => (c === cell.col ? value : v)) : row,
      )
    })
  }

  const at = cell ?? { row: rows.length - 1, col: columns - 1 }

  const addRow = () => {
    const index = at.row + 1
    const next = [...rows.slice(0, index), Array<string>(columns).fill(""), ...rows.slice(index)]
    change(next, { row: index, col: at.col })
    // Размеры хранятся по номеру — сдвигаем их вместе со строками.
    shift((prev) => ({ ...prev, h: shiftSizes(prev.h, index, 1) }))
  }
  const removeRow = () => {
    if (!cell || rows.length <= 1) return
    const next = rows.filter((_, r) => r !== cell.row)
    change(next, null)
    shift((prev) => ({ ...prev, h: shiftSizes(prev.h, cell.row, -1) }))
  }
  const addColumn = () => {
    const index = at.col + 1
    const next = rows.map((row) => [...row.slice(0, index), "", ...row.slice(index)])
    change(next, { row: at.row, col: index })
    shift((prev) => ({ ...prev, w: shiftSizes(prev.w, index, 1) }))
  }
  const removeColumn = () => {
    if (!cell || columns <= 1) return
    const next = rows.map((row) => row.filter((_, c) => c !== cell.col))
    change(next, null)
    shift((prev) => ({ ...prev, w: shiftSizes(prev.w, cell.col, -1) }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none flex-wrap items-center gap-1.5">
        <ToolButton title={t.textTableAddRow} onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          {t.textTableRow}
        </ToolButton>
        <ToolButton
          title={t.textTableRemoveRow}
          onClick={removeRow}
          disabled={!cell || rows.length <= 1}
        >
          <Minus className="h-3.5 w-3.5" />
          {t.textTableRow}
        </ToolButton>
        <ToolButton title={t.textTableAddColumn} onClick={addColumn}>
          <Plus className="h-3.5 w-3.5" />
          {t.textTableColumn}
        </ToolButton>
        <ToolButton
          title={t.textTableRemoveColumn}
          onClick={removeColumn}
          disabled={!cell || columns <= 1}
        >
          <Minus className="h-3.5 w-3.5" />
          {t.textTableColumn}
        </ToolButton>
        <span className="ml-auto text-[11.5px] text-ws-4">
          {cell
            ? tf(t.textTableCell, { cell: `${columnLabel(cell.col)}${cell.row + 1}` })
            : t.textTableClickHint}
        </span>
      </div>
      <div className="scrollbar-elegant min-h-0 flex-1 overflow-auto rounded-lg border border-foreground/10 bg-ws-well">
        <TableGrid rows={rows} {...sizeState} selected={cell} onSelect={select} />
      </div>
      {cell ? (
        <MarkupEditor
          value={rows[cell.row]?.[cell.col] ?? ""}
          onChange={setCell}
          loadKey={editorKey}
          className="max-h-[40%] min-h-[96px] flex-none"
        />
      ) : null}
      <EditFooter
        dirty={dirty}
        error={null}
        onSave={save}
        onCancel={onCancel}
      />
    </div>
  )
}
