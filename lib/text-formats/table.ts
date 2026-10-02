/**
 * Таблицы csv/tsv: разбор и запись (docs/TEXT_FORMATS_PLAN.md §3, §4).
 *
 * Края формата — кавычки, `""` внутри, переносы строк в ячейке, разделитель —
 * отдаём papaparse. Своё здесь только то, что нужно, чтобы файл после правки
 * отличался ровно правленными ячейками: тот же разделитель, тот же перевод
 * строк, тот же BOM и тот же хвостовой перевод строки (или его отсутствие).
 *
 * Значение ячейки — уже без кавычек csv; дальше оно разбирается как разметка
 * §8.2, как текст `.txt`.
 *
 * Чистый модуль: ни React, ни DOM.
 */

import Papa from "papaparse"

import { fileExt } from "@/components/account/workspace/preview-kind"

export type TableDelimiter = "," | ";" | "\t"

/** Всё, что нужно, чтобы записать таблицу так же, как она лежала в файле. */
export type TableFormat = {
  delimiter: TableDelimiter
  newline: "\n" | "\r\n" | "\r"
  /** Файл кончался переводом строки. */
  trailingNewline: boolean
  bom: boolean
}

export type ParsedTable = {
  /** Строки как в файле; длины строк могут различаться. */
  rows: string[][]
  format: TableFormat
  /** papaparse споткнулся (незакрытая кавычка и т. п.) — таблица по возможности. */
  broken: boolean
}

/** Перевод строк файла: первый встретившийся вне кавычек csv. */
function detectNewline(text: string): TableFormat["newline"] {
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch === "\r") return text[i + 1] === "\n" ? "\r\n" : "\r"
    else if (!quoted && ch === "\n") return "\n"
  }
  return "\n"
}

/**
 * Разобрать csv/tsv. `name` решает разделитель: tsv — таб, csv — запятая или
 * точка с запятой (угадывает papaparse по началу файла).
 */
export function parseTable(name: string, source: string): ParsedTable {
  const bom = source.startsWith("\uFEFF")
  let text = bom ? source.slice(1) : source
  const newline = detectNewline(text)
  const trailingNewline = /(\r\n|\r|\n)$/.test(text)
  // Хвостовой перевод строки — конец последней строки, а не начало новой
  // пустой: papaparse иначе добавил бы строку из одной пустой ячейки.
  if (trailingNewline) text = text.replace(/(\r\n|\r|\n)$/, "")

  const tsv = fileExt(name) === "tsv"
  if (text === "") {
    return {
      rows: [],
      format: { delimiter: tsv ? "\t" : ",", newline, trailingNewline, bom },
      broken: false,
    }
  }

  const result = Papa.parse<string[]>(text, {
    delimiter: tsv ? "\t" : "",
    delimitersToGuess: [",", ";"],
    newline,
    skipEmptyLines: false,
    header: false,
    dynamicTyping: false,
  })
  const guessed = result.meta.delimiter
  const delimiter: TableDelimiter = tsv ? "\t" : guessed === ";" ? ";" : ","
  return {
    rows: result.data.map((row) => row.map((cell) => String(cell ?? ""))),
    format: { delimiter, newline, trailingNewline, bom },
    broken: result.errors.some((e) => e.type === "Quotes"),
  }
}

/** Ячейку нужно взять в кавычки: в ней разделитель, кавычка или перевод строки. */
function quoteCell(cell: string, delimiter: TableDelimiter): string {
  if (cell.includes(delimiter) || /["\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
  return cell
}

/**
 * Записать таблицу в формате исходного файла. Пишем сами, а не Papa.unparse:
 * тот берёт в кавычки и ячейки с пробелом по краям, и нетронутое «a, b»
 * переписалось бы. Кавычки — только где без них файл не прочитать; лишние
 * кавычки исходника при записи пропадают (содержимое то же).
 */
export function writeTable(rows: string[][], format: TableFormat): string {
  const body = rows
    .map((row) => row.map((cell) => quoteCell(cell, format.delimiter)).join(format.delimiter))
    .join(format.newline)
  return (
    (format.bom ? "\uFEFF" : "") +
    body +
    (format.trailingNewline && rows.length > 0 ? format.newline : "")
  )
}

/** Число столбцов — по самой длинной строке. */
export function columnCount(rows: string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

/** Строки, добитые пустыми ячейками до общего числа столбцов. */
export function padRows(rows: string[][], columns = columnCount(rows)): string[][] {
  return rows.map((row) =>
    row.length >= columns ? row : [...row, ...Array<string>(columns - row.length).fill("")],
  )
}
