/**
 * Модель формы элемента: требования → слоты, и папка → заполненные слоты.
 *
 * Середина инструмента. Слева требования из формы графа (site-form.ts),
 * справа содержимое папки в хранилище; связывает их только имя файла
 * (names.ts), потому что манифеста в папке нет намеренно.
 *
 * Здесь нет ни React, ни сети: тот же разбор понадобится программе, если папку
 * начнут собирать и там. Правила — docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §5, §6, §10.
 */

import { FOLDER_TYPE, type ElementRow } from "./site-form"
import { parseSlotName, subfolderName } from "./names"
export { subfolderName }

/** Строка каталога: `dir` — путь ОТ папки элемента, пустой — её корень. */
export type FolderEntry = {
  dir: string
  name: string
  isFolder: boolean
}

export type SlotFile = {
  /** Имя в хранилище целиком: `01 Ведущий - clip.mp4`. */
  name: string
  /** Исходное имя, под которым файл принесли; null — его не было. */
  originalName: string | null
}

export type Slot = {
  rowId: string
  label: string
  /** Позиция в списке, с единицы. Она же номер в имени. */
  index: number
  /** Файл в слоте; null — слот пуст. У подпапки всегда null. */
  file: SlotFile | null
  /** Имя подпапки в хранилище; null — её ещё нет или это не подпапка. */
  folderName: string | null
  /** Содержимое подпапки: те же группы по `children` требования. */
  groups: Group[]
}

export type Group = {
  row: ElementRow
  slots: Slot[]
}

export type ElementState = {
  groups: Group[]
  /**
   * Файлы, не разобравшиеся ни в один слот. Показываем отдельной группой
   * «лишние»: молча прятать их нельзя — нода их посчитает, и условие `=`
   * из-за них не сойдётся.
   */
  extras: FolderEntry[]
}

/**
 * Сколько слотов рисовать при пустой папке.
 *
 * И при `=`, и при `>=` это `count`: разница не в стартовом числе, а в том,
 * можно ли добавить ещё (`canAdd`) и можно ли удалить (`canRemove`).
 */
function initialSlotCount(row: ElementRow): number {
  return row.count
}

/** Можно ли добавить ещё один такой же слот. */
export function canAdd(row: ElementRow): boolean {
  return row.op === ">="
}

/**
 * Можно ли удалить слот, когда их сейчас `current`.
 *
 * Ниже объявленного минимума удалять нельзя: при `=` их ровно столько, сколько
 * объявлено, при `>=` последние `count` не отдаются. Удаление, после которого
 * условие заведомо не сойдётся, — это не свобода, а ловушка: человек получил бы
 * форму, которую нельзя запустить, и без объяснения почему.
 */
export function canRemove(row: ElementRow, current: number): boolean {
  if (row.op === "=") return false
  return current > row.count
}

function entriesIn(entries: readonly FolderEntry[], dir: string): FolderEntry[] {
  return entries.filter((entry) => entry.dir === dir)
}

function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/**
 * Разбор одного уровня: строки требований + содержимое папки → группы слотов.
 *
 * Слоты нумеруются подряд с `01` ВСЕГДА, даже когда слот один: структура имён
 * должна быть единой, иначе у разбора появляется второй случай вместо одного.
 *
 * Слотов может оказаться больше объявленного — при `>=` человек добавлял ещё, и
 * файлы в папке об этом помнят. Меньше не бывает: недостающие показываем
 * пустыми, иначе собрать их будет негде.
 */
function readLevel(
  rows: readonly ElementRow[],
  entries: readonly FolderEntry[],
  dir: string,
  used: Set<string>,
): Group[] {
  const here = entriesIn(entries, dir)
  const labels = rows.map((row) => row.label)

  return rows.map((row) => {
    const isFolder = row.type === FOLDER_TYPE

    /** Что в папке принадлежит этой строке требования, по номеру слота. */
    const found = new Map<number, FolderEntry>()
    for (const entry of here) {
      if (entry.isFolder !== isFolder) continue
      const parsed = parseSlotName(entry.name, labels)
      if (!parsed || parsed.label !== row.label) continue
      // Номер занят — файл-двойник. Оставляем первого, второй уедет в «лишние»:
      // выбирать между ними нечем, а показать оба в одном слоте негде.
      if (found.has(parsed.index)) continue
      found.set(parsed.index, entry)
      used.add(joinDir(dir, entry.name))
    }

    const highest = found.size > 0 ? Math.max(...found.keys()) : 0
    const total = Math.max(initialSlotCount(row), highest)

    const slots: Slot[] = []
    for (let index = 1; index <= total; index += 1) {
      const entry = found.get(index) ?? null
      const parsed = entry ? parseSlotName(entry.name, labels) : null

      slots.push({
        rowId: row.id,
        label: row.label,
        index,
        file:
          entry && !isFolder
            ? { name: entry.name, originalName: parsed?.originalName ?? null }
            : null,
        folderName: entry && isFolder ? entry.name : null,
        groups: isFolder
          ? readLevel(
              row.children,
              entries,
              // Папки ещё нет — разбираем по имени, которое она получит: так
              // вложенная форма рисуется одинаково для новой и существующей.
              entry ? joinDir(dir, entry.name) : joinDir(dir, subfolderName(index, row.label)),
              used,
            )
          : [],
      })
    }

    return { row, slots }
  })
}

/**
 * Содержимое папки элемента → состояние формы.
 *
 * Для пустой папки (создание нового элемента) передаётся пустой список записей
 * — получится та же форма, только со всеми пустыми слотами. Отдельной ветки
 * «создание» нет намеренно: две ветки разошлись бы при первой же правке.
 */
export function readElement(
  rows: readonly ElementRow[],
  entries: readonly FolderEntry[],
): ElementState {
  const used = new Set<string>()
  const groups = readLevel(rows, entries, "", used)

  /**
   * Лишнее — всё, что не разобралось в слот.
   *
   * Считается на каждом уровне, а не только в корне: файл, подброшенный внутрь
   * подпапки слота, нода тоже посчитает, и условие `=` из-за него не сойдётся.
   *
   * А вот содержимое папки, которая сама не разобралась, повторять не нужно:
   * она уже показана строкой «лишнее» целиком, и её файлы были бы тем же самым
   * во второй раз. Отсюда условие «родитель — корень либо разобранная папка».
   */
  const extras = entries.filter((entry) => {
    if (used.has(joinDir(entry.dir, entry.name))) return false
    return entry.dir === "" || used.has(entry.dir)
  })

  return { groups, extras }
}

/**
 * Чего не хватает для запуска: подписи незаполненных слотов.
 *
 * Список, а не флаг: кнопка «Запустить» неактивна, пока не собраны все слоты, и
 * рядом должно стоять, чего именно не хватает — человек должен видеть причину,
 * а не упираться в серую кнопку.
 */
export function missingLabels(state: ElementState): string[] {
  const out: string[] = []

  const walk = (groups: readonly Group[], prefix: string) => {
    for (const group of groups) {
      for (const slot of group.slots) {
        const where = prefix ? `${prefix} / ${slot.label}` : slot.label
        if (group.row.type === FOLDER_TYPE) {
          walk(slot.groups, `${where} ${slot.index}`)
          continue
        }
        if (!slot.file) out.push(where)
      }
    }
  }

  walk(state.groups, "")
  return out
}

/** Собрана ли папка целиком. */
export function isComplete(state: ElementState): boolean {
  return missingLabels(state).length === 0
}

/**
 * Сколько слотов занято из скольких — для полосы заполненности на папке.
 *
 * Считается по тем же правилам, что `missingLabels`, и обходом той же формы:
 * два разных ответа на вопрос «собрано ли» разошлись бы при первой же правке, и
 * полоса показывала бы полноту у папки, которую кнопка запускать отказывается.
 *
 * Слоты-папки сами по себе не считаются — засчитывается их содержимое, иначе
 * заведённая пустая подпапка давала бы долю там, где не положено ещё ничего.
 *
 * `total` — знаменатель доли: при `>=` он растёт вместе с добавленными слотами,
 * потому что незаполненный добавленный слот — такая же нехватка, как объявленный.
 */
export function slotFill(state: ElementState): { filled: number; total: number } {
  let filled = 0
  let total = 0

  const walk = (groups: readonly Group[]) => {
    for (const group of groups) {
      for (const slot of group.slots) {
        if (group.row.type === FOLDER_TYPE) {
          walk(slot.groups)
          continue
        }
        total += 1
        if (slot.file) filled += 1
      }
    }
  }

  walk(state.groups)
  return { filled, total }
}

/** Подпапка, которой в папке элемента ещё нет. */
export type MissingFolder = {
  /** Путь от папки элемента, куда её заводить. Пусто — корень элемента. */
  dir: string
  index: number
  label: string
}

/**
 * Каких подпапок не хватает, чтобы структура существовала целиком.
 *
 * Структура заводится СРАЗУ при открытии диалога, а не по мере того, как
 * человек доберётся до очередного слота: файлы кладутся в хранилище по одному,
 * и класть их некуда, пока папки нет. Заодно человек видит форму такой, какой
 * её ждёт граф, а не растущей под руками.
 *
 * Порядок ответа — сверху вниз: родителя надо завести раньше ребёнка, иначе
 * второй `mkdir` уйдёт в несуществующий путь.
 */
export function missingFolders(
  rows: readonly ElementRow[],
  entries: readonly FolderEntry[],
): MissingFolder[] {
  const out: MissingFolder[] = []

  const walk = (level: readonly ElementRow[], dir: string) => {
    const state = readLevel(level, entries, dir, new Set<string>())
    for (const group of state) {
      if (group.row.type !== FOLDER_TYPE) continue
      for (const slot of group.slots) {
        const name = slot.folderName ?? subfolderName(slot.index, slot.label)
        if (!slot.folderName) {
          out.push({ dir, index: slot.index, label: slot.label })
        }
        walk(group.row.children, joinDir(dir, name))
      }
    }
  }

  walk(rows, "")
  return out
}
