/**
 * «Только текст» — содержимое файла без разметки оформления
 * (docs/TEXT_FORMATS_PLAN.md §3).
 *
 * Чистый модуль: ни React, ни DOM.
 */

import { parseMarkup } from "@/lib/tools/element/markup"
import { fileExt } from "@/components/account/workspace/preview-kind"
import { parseTable, writeTable } from "./table"

/** Текст без разметки: то, что попадает в композицию. */
export function stripMarkup(source: string): string {
  return parseMarkup(source).text
}

/**
 * Файл → он же без разметки, по виду файла.
 *
 * csv/tsv — «чистая таблица»: разметка снимается в каждой ячейке отдельно, а
 * таблица пишется обратно тем же разделителем. Целиком чистить нельзя: снятие
 * экранирования задело бы кавычки и разделители csv.
 */
export function plainTextOf(name: string, source: string): string {
  const ext = fileExt(name)
  if (ext === "txt") return stripMarkup(source)
  if (ext === "csv" || ext === "tsv") {
    const { rows, format } = parseTable(name, source)
    return writeTable(rows.map((row) => row.map(stripMarkup)), format)
  }
  return source
}
