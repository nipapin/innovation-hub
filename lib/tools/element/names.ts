/**
 * Грамматика имён внутри папки элемента.
 *
 * ⚠️ ЭТО ПОЛОВИНА КОНТРАКТА. Вторая половина — нода `checkFolder` в программе:
 * она читает ту же папку, чтобы проверить её перед обработкой. Канонический
 * текст грамматики — docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §6, и менять что-то
 * здесь = менять контракт.
 *
 *     папка элемента   -<имя>                        «-Ролик 2026-09-23 14.05»
 *     файл в слоте     NN <label> - <исходное имя>   «01 Ведущий - clip.mp4»
 *     файл без имени   NN <label>                    «01 Ведущий.txt»
 *     подпапка         NN <label>                    «01 Сцена»
 *
 * Имя — ЕДИНСТВЕННАЯ связь между слотом формы и файлом на диске. Манифеста в
 * папке нет намеренно: он стал бы вторым источником правды, а правки из
 * десктопа его не обновляют.
 *
 * Чистый модуль: ни React, ни обращений к хранилищу.
 */

/** Дефис в начале: папка недособрана либо забракована — обе линии её пропускают. */
export const DASH = "-"

/** Разделитель между именем компонента и исходным именем файла. */
export const NAME_SEPARATOR = " - "

/** Номер слота: два знака с ведущим нулём, нумерация с единицы. */
export function slotNumber(index: number): string {
  return String(index).padStart(2, "0")
}

/** Имя папки элемента: дефис держит инструмент, человек его не пишет. */
export function elementFolderName(displayName: string): string {
  const clean = displayName.replace(/^-+/, "").trim()
  return `${DASH}${clean}`
}

/** Имя папки без дефиса — то, что показываем человеку в шапке диалога. */
export function elementDisplayName(folderName: string): string {
  return folderName.replace(/^-+/, "").trim()
}

/**
 * Помечена ли папка дефисом.
 *
 * Внимание: это НЕ признак «папка собирается». Тем же дефисом помечается брак —
 * и десктоп (`markSkippedWithDash`), и сайт (`quarantineTaskSource`) так метят
 * исходник упавшей задачи, и по имени эти состояния не различаются вообще.
 * Различитель — задача по этой папке (план §10).
 */
export function isDashed(folderName: string): boolean {
  return folderName.startsWith(DASH)
}

/** Имя подпапки слота: `01 Сцена`. Дефиса нет — им помечается только элемент. */
export function subfolderName(index: number, label: string): string {
  return `${slotNumber(index)} ${label}`
}

/**
 * Имя файла в слоте.
 *
 * Исходное имя сохраняется как есть: человек принёс `clip.mp4`, и узнать свой
 * файл в папке он должен по этому имени, а не по номеру слота. Нет исходного
 * имени (текст, написанный прямо на сайте) — остаётся `NN <label>` плюс
 * расширение, которое добавляет вызывающий.
 */
export function slotFileName(
  index: number,
  label: string,
  originalName?: string | null,
): string {
  const head = `${slotNumber(index)} ${label}`
  const tail = originalName?.trim()
  return tail ? `${head}${NAME_SEPARATOR}${tail}` : head
}

export type ParsedSlotName = {
  /** Порядковый номер слота, с единицы. */
  index: number
  /** Имя компонента — оно же `label` строки требования. */
  label: string
  /** Исходное имя файла; null — его не было. */
  originalName: string | null
}

const NUMBER_PREFIX_RE = /^(\d{2}) (.+)$/

/**
 * Разбор имени обратно в слот.
 *
 * НЕ регуляркой «до первого ` - `»: `label` сам может содержать дефис, и такой
 * разбор разрезал бы «01 Ведущий - слева - clip.mp4» не там, где нужно. Порядок
 * другой: отрезать `NN `, затем найти среди `label` этого уровня тот, с которого
 * имя начинается, и остаток после ` - ` считать исходным именем.
 *
 * При нескольких совпадениях берётся САМЫЙ ДЛИННЫЙ: из «Текст» и «Текст ролика»
 * имя «01 Текст ролика - a.txt» принадлежит второму, иначе исходным именем
 * оказалось бы «ролика - a.txt». Ровно поэтому же `label` внутри одного уровня
 * обязаны быть уникальны (план §5) — инструмент это проверяет при открытии.
 *
 * `null` — имя не разобралось ни в один слот: такой файл показываем в группе
 * «лишние». Молча прятать его нельзя, нода его посчитает.
 */
export function parseSlotName(
  name: string,
  labels: readonly string[],
): ParsedSlotName | null {
  const head = NUMBER_PREFIX_RE.exec(name)
  if (!head) return null

  const index = Number.parseInt(head[1]!, 10)
  // `00` номером слота не бывает: нумерация идёт с единицы (план §6.1).
  if (index < 1) return null
  const rest = head[2]!

  const label = [...labels]
    .filter((candidate) => {
      if (rest === candidate) return true
      if (rest.startsWith(`${candidate}${NAME_SEPARATOR}`)) return true
      // Файл без исходного имени приезжает с расширением: `01 Ведущий.txt`.
      return rest.startsWith(`${candidate}.`)
    })
    .sort((a, b) => b.length - a.length)[0]

  if (label === undefined) return null

  const tail = rest.slice(label.length)
  if (tail.startsWith(NAME_SEPARATOR)) {
    const originalName = tail.slice(NAME_SEPARATOR.length)
    return { index, label, originalName: originalName || null }
  }
  return { index, label, originalName: null }
}

/**
 * Свободное имя папки элемента: шаблон дал ту же дату дважды — дописываем « (2)».
 *
 * Сравнение без учёта регистра, как в каталоге
 * (`project_files_unique_name_idx` держит имя через `lower()`), иначе
 * предложенное имя отбил бы сервер.
 */
export function freeElementName(taken: readonly string[], name: string): string {
  const busy = new Set(taken.map((item) => item.toLowerCase()))
  if (!busy.has(name.toLowerCase())) return name
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} (${n})`
    if (!busy.has(candidate.toLowerCase())) return candidate
  }
  return `${name} (${Date.now()})`
}

export type Renumber = {
  /** Что переименовать. */
  from: string
  /** Во что. */
  to: string
}

/**
 * Что переименовать, чтобы номера снова шли подряд с `01`.
 *
 * Номер — это позиция в списке, а не идентификатор, поэтому дыр не бывает:
 * удалили второй из трёх — третий становится вторым. Иначе после `01`, `03`
 * следующее добавление снова просится в `03` и упирается в занятое имя.
 *
 * Меняется ТОЛЬКО номер: имя компонента и исходное имя остаются как были —
 * перенумерация не повод трогать остальное.
 *
 * На вход — имена в желаемом порядке (после удаления или перетаскивания). На
 * выходе только те, у кого имя действительно меняется: каждое переименование
 * это `move`-событие в журнале, и лишних выдавать незачем.
 */
export function renumber(
  namesInOrder: readonly string[],
  labels: readonly string[],
): Renumber[] {
  const out: Renumber[] = []
  namesInOrder.forEach((name, position) => {
    const parsed = parseSlotName(name, labels)
    if (!parsed) return
    const index = position + 1
    if (parsed.index === index) return
    const suffix = name.slice(`${slotNumber(parsed.index)} `.length)
    out.push({ from: name, to: `${slotNumber(index)} ${suffix}` })
  })
  return out
}
