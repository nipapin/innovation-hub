/**
 * Переходник между деревом кабинета и разбором папки элемента.
 *
 * `lib/tools/element/` живёт без React и без знания о кабинете — он принимает
 * плоский список записей (`FolderEntry`). Дерево же приходит из каталога
 * узлами `DriveFile` с детьми. Перевод стоит здесь, на стороне компонентов:
 * тащить клиентский тип в `lib/` значило бы привязать переносимую логику к
 * рабочей области (TOOLS_DEV_GUIDE §5.4).
 */

import { readElement, type FolderEntry } from "@/lib/tools/element/slots"
import type { ElementRow } from "@/lib/tools/element/site-form"
import type { DriveFile } from "../types"

/**
 * Содержимое папки одним плоским списком, с путями ОТ неё самой.
 *
 * Рекурсивно: подпапки слотов — часть той же формы, и разбирать их отдельным
 * запросом незачем, дерево проекта уже загружено целиком.
 */
export function entriesOf(folder: DriveFile | null): FolderEntry[] {
  if (!folder) return []
  const out: FolderEntry[] = []
  const walk = (nodes: readonly DriveFile[], dir: string) => {
    for (const node of nodes) {
      out.push({ dir, name: node.name, isFolder: node.isFolder })
      if (node.isFolder) {
        walk(node.children ?? [], dir ? `${dir}/${node.name}` : node.name)
      }
    }
  }
  walk(folder.children ?? [], "")
  return out
}

/** Узел дерева по пути от папки элемента; null — такой папки ещё нет. */
export function nodeAtPath(
  folder: DriveFile | null,
  dir: string,
): DriveFile | null {
  if (!folder) return null
  let current: DriveFile = folder
  for (const segment of dir.split("/").filter(Boolean)) {
    const next = (current.children ?? []).find(
      (child) => child.isFolder && child.name === segment,
    )
    if (!next) return null
    current = next
  }
  return current
}

/**
 * Похожа ли папка в `IN` на элемент.
 *
 * Отдельной метки в хранилище нет намеренно — она стала бы вторым источником
 * правды и разъехалась бы с содержимым при первой же правке из десктопа
 * (план §3). Поэтому признак один: содержимое разбирается грамматикой §6.
 *
 * Пустая папка тоже считается элементом: её только что создали, и предлагать
 * «править» надо именно ей. А вот обычная папка с чужими файлами — нет: у неё
 * в слоты не легло ничего, и форма показала бы человеку пустой бланк поверх
 * файлов, которых он в нём не увидит.
 */
export function looksLikeElement(
  rows: readonly ElementRow[],
  folder: DriveFile,
): boolean {
  const entries = entriesOf(folder)
  if (entries.length === 0) return true
  const state = readElement(rows, entries)
  return entries.length > state.extras.length
}
