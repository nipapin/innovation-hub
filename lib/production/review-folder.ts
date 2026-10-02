/**
 * Служебная папка пометок ревью — docs/PRODUCTION_PLAN.md §8, решение 2026-10-02.
 *
 * Пометки к файлу лежат json-ом в `<рабочая папка этапа>/.review/<id файла>.json`:
 * рядом с вариантами, через штатный путь записи (каталог, журнал), и уходят
 * вместе с рабочей папкой по сроку хранения. Как файл они не показываются нигде:
 * ни в списках этапа, ни в форме, ни в «Из чата», ни в финале, ни во входах
 * следующих этапов. Проверка одна — здесь; модуль без серверных зависимостей,
 * его зовут и сервер, и клиент.
 */
export const REVIEW_FOLDER = ".review"

/** Путь папки лежит в служебной папке пометок (сама она или глубже). */
export function isReviewPath(folderPath: string): boolean {
  return folderPath.split("/").some((part) => part === REVIEW_FOLDER)
}

/** Строка каталога — служебная: файл внутри `.review` или сама папка `.review`. */
export function isReviewRow(row: { folderPath: string; name?: string; isFolder?: boolean }): boolean {
  return isReviewPath(row.folderPath) || (row.isFolder === true && row.name === REVIEW_FOLDER)
}
