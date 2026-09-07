import { ProjectStorageError } from "./errors"
import { readExposedOption } from "./extract"
import { normalizeNumeric } from "./numeric-format"
import type { ExposedOption, ExposedOptionValue } from "./types"

/**
 * Применяет правки клиента к разобранному графу — на месте, без обращений к
 * хранилищу. Отдельно от `updateProjectExposedOptions`, потому что вся
 * содержательная часть (разрешение, тип, границы, списки) здесь, а без R2 её
 * иначе не проверить.
 *
 * Границы и списки проверяются на сервере, хотя контрол в браузере уже зажимает
 * ввод: страница могла открыться до того, как автор поменял граф в программе.
 *
 * Числа — **зажим**, а не отказ: значение вне диапазона почти всегда означает
 * устаревшую страницу, и отказ выглядел бы поломкой ползунка. Списки — наоборот
 * отказ: подставлять «ближайший вариант» вместо выбранного нельзя.
 */

export type ExposedOptionChange = {
  path: string[]
  value: ExposedOptionValue
}

function resolvePath(root: unknown, path: string[]): unknown {
  let node: unknown = root
  for (const segment of path) {
    if (!node || typeof node !== "object") return null
    node = Array.isArray(node)
      ? node[Number.parseInt(segment, 10)]
      : (node as Record<string, unknown>)[segment]
  }
  return node
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

function fail(path: string[], reason: string): never {
  throw new ProjectStorageError(`Parameter "${path.join(".")}" ${reason}`)
}

function coerce(
  option: ExposedOption,
  change: ExposedOptionChange,
): ExposedOptionValue {
  const { value } = change

  switch (option.control) {
    case "checkbox":
      if (typeof value !== "boolean") fail(change.path, "expects a boolean.")
      return value

    case "slider":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(change.path, "expects a number.")
      }
      return normalizeNumeric(value, option.numeric!)

    case "timecode":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(change.path, "expects a number of seconds.")
      }
      return Math.max(0, Math.round(value))

    case "valueRange": {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        value.some((v) => typeof v !== "number" || !Number.isFinite(v))
      ) {
        fail(change.path, "expects a pair of numbers.")
      }
      const cfg = option.numeric!
      const lo = normalizeNumeric(value[0] as number, cfg)
      const hi = normalizeNumeric(value[1] as number, cfg)
      return [Math.min(lo, hi), Math.max(lo, hi)]
    }

    case "textedit":
      if (typeof value !== "string") fail(change.path, "expects a string.")
      return value

    case "vendorAccount":
      // Метка, а не секрет. Существование учётки здесь НЕ проверяем: она могла
      // быть отозвана между открытием вкладки и сохранением, и ронять из-за
      // этого сохранение остальных параметров незачем — задачу всё равно не
      // соберёт гейт, и человек увидит причину на карточке проекта.
      if (typeof value !== "string") fail(change.path, "expects an account label.")
      return value

    case "ddm": {
      if (typeof value !== "string") fail(change.path, "expects a string.")
      // Аккаунт площадки и цель публикации в графе не перечислены — там стоит
      // токен (`#vkAccounts`, `#vkGroups`), а варианты знает сейф. Сверять их
      // со списком из графа значило бы отвергать любой реальный аккаунт.
      //
      // Существование самого аккаунта здесь НЕ проверяем — по той же причине,
      // что и у `vendorAccount`: его могли отозвать между открытием вкладки и
      // сохранением, и ронять из-за этого правку остальных параметров незачем.
      // Публикация всё равно не соберётся, и причина будет названа там.
      if (
        !option.social &&
        !option.freeInput &&
        value !== "" &&
        !option.options.includes(value)
      ) {
        fail(change.path, `does not accept the value "${value}".`)
      }
      return value
    }

    case "autocomplete": {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
      ) {
        fail(change.path, "expects a list of strings.")
      }
      const items = value as string[]
      if (!option.multiSelect && items.length > 1) {
        fail(change.path, "accepts a single value.")
      }
      // `optionsOnly` при токене площадки не проверяем — варианты там знает
      // сейф, а не граф (см. развёрнутое объяснение у `ddm`).
      if (option.optionsOnly && !option.social) {
        const unknown = items.find((item) => !option.options.includes(item))
        if (unknown !== undefined) {
          fail(change.path, `does not accept the value "${unknown}".`)
        }
      }
      // Дубликаты — не ошибка страницы, а её недосмотр: молча схлопываем.
      return option.allowDuplicates ? items : Array.from(new Set(items))
    }
  }
}

export function applyExposedOptionChanges(
  root: unknown,
  changes: ExposedOptionChange[],
): void {
  for (const change of changes) {
    // Путь ведёт в controlProps — туда, где лежит value. Флаг же стоит на
    // самом свойстве, то есть на родителе: разрешение проверяем там.
    const last = change.path[change.path.length - 1]
    if (last !== "controlProps") {
      fail(change.path, "is not a writable parameter path.")
    }

    const propertyPath = change.path.slice(0, -1)
    const property = asRecord(resolvePath(root, propertyPath))
    const controlProps = asRecord(resolvePath(root, change.path))
    if (!property || !controlProps) {
      fail(change.path, "was not found in options.json.")
    }
    if (property.exposedToSite !== true) {
      fail(change.path, "is not editable from the site.")
    }

    // Тот же разбор, что и на чтении: границы, списки и режим контрола сайт
    // берёт из графа, а не из запроса — клиент прислать их не может.
    const option = readExposedOption(property, propertyPath)
    if (!option) {
      fail(change.path, "has a control the site cannot edit.")
    }
    if (!option.editable) {
      fail(change.path, "is configured in the desktop app.")
    }

    controlProps.value = coerce(option, change)
  }
}
