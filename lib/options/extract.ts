import {
  isExposedControl,
  type ExposedOption,
  type ExposedOptionControl,
  type ExposedOptionValue,
} from "./types"
import {
  normalizeNumeric,
  sliderConfig,
  valueRangeConfig,
  type NumericConfig,
} from "./numeric-format"
import { socialTokenInfo } from "@/lib/social/types"

/**
 * `options.json` → список настроек для вкладки клиента.
 *
 * Свойство в графе выглядит так:
 *
 *     { id: "duration", controlType: "slider", exposedToSite: true,
 *       controlProps: { label, tooltip, value: 30, minValue: 5, maxValue: 120 } }
 *
 * Флаг стоит на свойстве, значение — уровнем ниже, в `controlProps`, и путь в
 * DTO ведёт именно туда: запись потом идёт по нему же. Иначе рядом с
 * `controlProps` появилось бы второе поле `value`, которого программа не
 * читает, и правка клиента молча пропадала бы.
 *
 * Отбор — по `controlType` из белого списка, а не по типу значения: у
 * `valueRange` и `autocomplete` значение и так массив, и «примитив ли это»
 * больше не отличает простой контрол от тяжёлого (`convertSettings` и
 * подобные держат в `value` объект и на сайте не рисуются).
 */

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw : null
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
}

/**
 * Подсказка автора графа → простой текст.
 *
 * В программе tooltip рендерится как HTML либо как markdown
 * (`NODE_WIN/nodes/properties/CustomTooltip.tsx`), поэтому в файле встречается
 * и `<div>…<br>`, и `- пункт`. Markdown-библиотеки на сайте нет, а вставлять
 * чужой HTML в страницу мы не будем — теги снимаем, переносы сохраняем.
 */
export function tooltipToText(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let text = raw
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/(div|p|li|ul|ol|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  }
  text = text.replace(
    /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g,
    (entity) => ENTITIES[entity] ?? entity,
  )
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/**
 * Пункты списка, которые в программе не значения, а действия: открыть диалог
 * выбора папки, войти в аккаунт, вставить токен. Клиенту их показывать нельзя —
 * выбрав такой пункт, он записал бы в граф строку «Add Bot».
 */
const ACTION_OPTIONS = new Set([
  "Custom Folder...",
  "CustomFolder...",
  "Custom File...",
  "CustomFile...",
  "Add New Account",
  "Login as another account",
  "Add Bot",
  "Вставить токен вручную",
])

/** История введённых значений — подсказка, а не источник вариантов. */
function isHistoryToken(option: string): boolean {
  return /^#historyValue(\(.+\))?$/.test(option)
}

function splitOptions(raw: unknown): {
  options: string[]
  dynamicOptions: string[]
} {
  if (!Array.isArray(raw)) return { options: [], dynamicOptions: [] }
  const options: string[] = []
  const dynamicOptions: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    if (item === "---" || ACTION_OPTIONS.has(item)) continue
    if (item.startsWith("#")) dynamicOptions.push(item)
    else options.push(item)
  }
  return { options, dynamicOptions }
}

function stringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string")
  }
  return typeof raw === "string" && raw ? [raw] : []
}

function readValue(
  control: ExposedOptionControl,
  cp: Record<string, unknown>,
  numeric: NumericConfig | null,
): ExposedOptionValue {
  switch (control) {
    case "checkbox":
      return cp.value === true
    case "slider": {
      const cfg = numeric!
      return normalizeNumeric(num(cp.value ?? cp.initValue, cfg.min), cfg)
    }
    case "timecode":
      // Хранится в секундах; отрицательного таймкода у свойства не бывает.
      return Math.max(0, Math.round(num(cp.value, 0)))
    case "valueRange": {
      const cfg = numeric!
      const raw = Array.isArray(cp.value) ? (cp.value as unknown[]) : []
      const lo = normalizeNumeric(num(raw[0], cfg.min), cfg)
      const hi = normalizeNumeric(num(raw[1], cfg.max), cfg)
      return [Math.min(lo, hi), Math.max(lo, hi)]
    }
    case "autocomplete":
      return stringList(cp.value)
    case "ddm":
      // Обычная строка, но у ddm бывает и массив: программа в этом случае
      // берёт первый элемент (`DDMonly`), и расходиться с ней здесь незачем.
      return typeof cp.value === "string" ? cp.value : (stringList(cp.value)[0] ?? "")
    case "vendorAccount":
      // Метка учётки. Пусто — «не выбрана»; такой параметр покажем, но задача
      // по нему не соберётся: гейт увидит, что учётки нет.
      return typeof cp.value === "string" ? cp.value : ""
    default:
      // textedit — просто текст.
      return typeof cp.value === "string" ? cp.value : ""
  }
}

/**
 * Разбор одного свойства. Экспортируется, потому что запись
 * ([apply.ts](./apply.ts)) обязана видеть контрол ровно так же, как чтение:
 * границы, списки и режим она берёт из графа, а не из запроса клиента.
 */
export function readExposedOption(
  property: Record<string, unknown>,
  path: string[],
): ExposedOption | null {
  const control = property.controlType
  if (!isExposedControl(control)) return null

  const cp =
    property.controlProps &&
    typeof property.controlProps === "object" &&
    !Array.isArray(property.controlProps)
      ? (property.controlProps as Record<string, unknown>)
      : null
  // Без controlProps свойство нечем ни назвать, ни отрисовать: у простых
  // контролов программа всегда пишет значение туда.
  if (!cp) return null

  const key = str(property.id) ?? path[path.length - 1] ?? "option"
  const numeric =
    control === "slider"
      ? sliderConfig(cp)
      : control === "valueRange"
        ? valueRangeConfig(cp)
        : null

  const { options, dynamicOptions } = splitOptions(cp.options)
  const listControl = control === "ddm" || control === "autocomplete"

  /**
   * Аккаунты площадок и цели публикации сайт теперь раскрывает сам: они лежат
   * в его сейфе (docs/SOCIAL_POSTING_PLAN.md §4), а не только у программы.
   *
   * Первый попавшийся токен, а не все: двух разных площадок в одном списке не
   * бывает — нода Poster принадлежит одной.
   */
  const social =
    listControl
      ? (dynamicOptions.map(socialTokenInfo).find(Boolean) ?? null)
      : null

  // Остальные токены (#folders, #typeOfFile, #whisperModels) знает только
  // программа: у неё локальные папки и словари машины. Пока их нечем
  // раскрыть, поле показываем, но менять с сайта не даём — иначе клиент
  // запишет туда что угодно.
  const blockedByTokens =
    listControl &&
    dynamicOptions.some(
      (token) => !isHistoryToken(token) && !socialTokenInfo(token),
    )

  return {
    path: [...path, "controlProps"],
    // Соседи по ноде — те, у кого совпадает путь до списка `properties`.
    siblingKey: path.slice(0, -1).join("."),
    key,
    label: str(cp.label) ?? str(property.label) ?? key,
    tooltip: tooltipToText(cp.tooltip),
    control,
    value: readValue(control, cp, numeric),
    options,
    dynamicOptions,
    editable: !blockedByTokens,
    numeric,
    showMinMax: cp.minMaxValueVisible !== false,
    // isTextInput главнее: у слайдера из примера он выключен явно, а
    // useValuesAsLabels включён — программа в этом случае поля не показывает.
    manualInput:
      typeof cp.isTextInput === "boolean"
        ? cp.isTextInput
        : cp.useValuesAsLabels === true,
    freeInput: cp.freeInput === true,
    multiSelect: cp.multiSelect === true,
    optionsOnly: cp.optionsOnly === true,
    allowDuplicates: cp.allowDuplicates === true,
    language: str(cp.language),
    // Слаг сервиса берём только у своего контрола: у остальных поле `service` в
    // controlProps означало бы что угодно, и подхватывать его вслепую нельзя.
    service: control === "vendorAccount" ? (str(cp.service) ?? "") : null,
    social,
  }
}

function collect(node: unknown, path: string[], out: ExposedOption[]): void {
  if (!node || typeof node !== "object") return

  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collect(child, [...path, String(index)], out),
    )
    return
  }

  const obj = node as Record<string, unknown>
  if (obj.exposedToSite === true) {
    const option = readExposedOption(obj, path)
    if (option) out.push(option)
    return
  }

  for (const [key, child] of Object.entries(obj)) {
    collect(child, [...path, key], out)
  }
}

export function extractExposedOptions(root: unknown): ExposedOption[] {
  const out: ExposedOption[] = []
  collect(root, [], out)
  return out
}
