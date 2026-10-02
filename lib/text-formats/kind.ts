/**
 * Вид текстового файла по имени — docs/TEXT_FORMATS_PLAN.md §1, §3.
 *
 * Своего списка расширений здесь нет: решает `previewKind`, единственный
 * источник вида файла на сайте. Этот модуль только сужает его до того, что
 * нужно просмотрщику текста, и добавляет правило скачивания.
 *
 * Чистый модуль: ни React, ни DOM.
 */

import { fileExt, isTextual, previewKind } from "@/components/account/workspace/preview-kind"

export type TextKind =
  /** txt — текст с разметкой оформления. */
  | "markup"
  /** csv, tsv — таблица; ячейка — та же разметка, что у txt. */
  | "table"
  | "json"
  | "markdown"
  | "subtitles"
  /** Прочий текст: показ с номерами строк, правка простым полем. */
  | "plain"
  /** xlsx: формат знаем, показать не можем. */
  | "unsupported"

/** Вид текста или `null`, если файл не текстовый вовсе (картинка, видео, архив). */
export function textKind(name: string, mimeType = ""): TextKind | null {
  const kind = previewKind({ name, mimeType })
  if (kind === "unsupported") return "unsupported"
  if (!isTextual(kind)) return null
  switch (kind) {
    case "markup":
    case "table":
    case "json":
    case "markdown":
    case "subtitles":
      return kind
    default:
      return "plain"
  }
}

/**
 * Спрашивать ли перед скачиванием «только текст / как есть».
 *
 * По расширению, а не по типу: вопрос про разметку имеет смысл только у
 * форматов, где она живёт (txt и ячейки csv/tsv).
 */
export function needsDownloadChoice(name: string): boolean {
  const ext = fileExt(name)
  return ext === "txt" || ext === "csv" || ext === "tsv"
}
