import { readElement, isComplete, missingLabels, subfolderName, type ElementState, type FolderEntry, type Group } from "../tools/element/slots"
import { isFolderRow, type ElementRow } from "../tools/element/site-form"
import { parseSlotName, slotNumber } from "../tools/element/names"
import type { FormRow } from "./graph"

/**
 * Форма этапа — docs/PRODUCTION_PLAN.md §3.0.
 *
 * Та же схема, что у сбора элемента на сайте (lib/tools/element) и `checkFolder`
 * в программе: строки с названием, типом, `>=`/`=` и числом; подпапка — такие
 * же строки внутри. Файл узнаётся по имени — `01 Титры - clip.srt`, подпапка —
 * `01 Сцена`. Поэтому разбор папки и полнота — функции сбора элемента, а не
 * свои: две реализации одного правила разошлись бы при первой правке.
 *
 * Чистый модуль: его читают и сервер при приёмке, и интерфейс.
 */

export function toElementRows(rows: readonly FormRow[]): ElementRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    tooltip: "",
    types: row.types,
    op: row.op,
    count: row.count,
    children: toElementRows(row.children),
  }))
}

/**
 * Файлы рабочей папки → записи от её корня. Папки выводятся из путей файлов:
 * пустая заведённая подпапка слот не заполняет, так что её отсутствие в
 * списке ничего не меняет.
 */
export function entriesOf(work: string, files: readonly { name: string; folderPath: string }[]): FolderEntry[] {
  const out = new Map<string, FolderEntry>()
  for (const file of files) {
    if (file.folderPath !== work && !file.folderPath.startsWith(`${work}/`)) continue
    const dir = file.folderPath === work ? "" : file.folderPath.slice(work.length + 1)
    out.set(`${dir}/${file.name}`, { dir, name: file.name, isFolder: false })
    const parts = dir ? dir.split("/") : []
    for (let i = 0; i < parts.length; i += 1) {
      const parent = parts.slice(0, i).join("/")
      out.set(`${parent}/${parts[i]}/`, { dir: parent, name: parts[i], isFolder: true })
    }
  }
  return [...out.values()]
}

export type FormState = { state: ElementState; complete: boolean; missing: string[] }

export function formStatus(
  rows: readonly FormRow[],
  work: string,
  files: readonly { name: string; folderPath: string }[],
): FormState {
  const state = readElement(toElementRows(rows), entriesOf(work, files))
  return { state, complete: rows.length > 0 && isComplete(state), missing: missingLabels(state) }
}

/** Найти строку по id в дереве. */
export function findRow(rows: readonly FormRow[], id: string): FormRow | null {
  for (const row of rows) {
    if (row.id === id) return row
    const inner = findRow(row.children, id)
    if (inner) return inner
  }
  return null
}

// ─── Имена: на диске с приставкой, на экране — исходное ─────────────────────

/** Все названия строк формы, со вложенными. */
export function formLabels(rows: readonly FormRow[]): string[] {
  return rows.flatMap((row) => [row.label, ...formLabels(row.children)])
}

/** Названия строк всех форм пайплайна — приставку любой из них узнаём и снимаем. */
export function graphFormLabels(nodes: readonly { kind: string; data: unknown }[]): string[] {
  const out = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== "form") continue
    for (const label of formLabels((node.data as { rows?: FormRow[] }).rows ?? [])) out.add(label)
  }
  return [...out]
}

/**
 * Имя без приставки слота: `01 Титры - clip.srt` → `clip.srt`. Снимается, пока
 * приставка узнаётся, — так файл, переставленный несколько раз, не копит
 * `02 Б - 01 А - clip.srt`. Файл без исходного имени (`01 Титры.txt`)
 * становится `Титры.txt`: другого имени у него нет.
 */
export function stripSlotPrefix(name: string, labels: readonly string[], ownLabel?: string): string {
  let current = name
  for (let i = 0; i < 20; i += 1) {
    // Метка своего места известна — она первая: самая длинная из общих меток
    // (`A - B` другой формы) иначе съела бы часть исходного имени `01 A - B.txt`.
    const parsed = (i === 0 && ownLabel ? parseSlotName(current, [ownLabel]) : null) ?? parseSlotName(current, labels)
    if (!parsed) break
    if (parsed.originalName) {
      current = parsed.originalName
      continue
    }
    current = current.slice(3) || current
    break
  }
  return current
}

/** Что показать человеку: исходное имя и приставку бледной меткой (null — файл вне формы). */
export function displaySlotName(name: string, labels: readonly string[]): { tag: string | null; name: string } {
  const parsed = parseSlotName(name, labels)
  if (!parsed) return { tag: null, name }
  return { tag: `${slotNumber(parsed.index)} ${parsed.label}`, name: stripSlotPrefix(name, labels) }
}

/** Место формы: строка, номер, папка от корня рабочей и кто в нём лежит. */
export type FormPlace = {
  rowId: string
  label: string
  index: number
  /** Папка места от корня рабочей папки; "" — корень. */
  dir: string
  types: string[]
  /** Имя файла в месте; null — свободно. */
  fileName: string | null
  /** Пустое место сверх найденных у строки «≥» — всегда одно внизу. */
  trailing: boolean
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/**
 * Места формы по порядку, вглубь: у строки «≥» вниз добавляется пустое место,
 * если последнее занято. Строки-папки сами местами не считаются — их
 * содержимое да.
 */
export function formPlaces(groups: readonly Group[], dir = ""): FormPlace[] {
  const out: FormPlace[] = []
  for (const group of groups) {
    if (isFolderRow(group.row)) {
      for (const slot of group.slots) {
        out.push(...formPlaces(slot.groups, joinPath(dir, slot.folderName ?? subfolderName(slot.index, slot.label))))
      }
      continue
    }
    for (const slot of group.slots) {
      out.push({
        rowId: group.row.id,
        label: group.row.label,
        index: slot.index,
        dir,
        types: group.row.types,
        fileName: slot.file?.name ?? null,
        trailing: false,
      })
    }
    const last = group.slots[group.slots.length - 1]
    if (group.row.op === ">=" && (!last || last.file)) {
      out.push({
        rowId: group.row.id,
        label: group.row.label,
        index: group.slots.length + 1,
        dir,
        types: group.row.types,
        fileName: null,
        trailing: true,
      })
    }
  }
  return out
}

/** Свободное имя в папке: `a.txt` → `a (2).txt`. Сравнение без учёта регистра, как в каталоге. */
export function freeFileName(taken: readonly string[], name: string): string {
  const busy = new Set(taken.map((item) => item.toLowerCase()))
  if (!busy.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf(".")
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})${ext}`
    if (!busy.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}
