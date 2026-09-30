import { readElement, isComplete, missingLabels, type ElementState, type FolderEntry } from "../tools/element/slots"
import type { ElementRow } from "../tools/element/site-form"
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
    type: row.type,
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
