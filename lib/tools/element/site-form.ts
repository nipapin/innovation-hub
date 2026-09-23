/**
 * Разбор `options/onSiteFolderCheckForm.json` — готовой формы сборки элемента.
 *
 * Файл пишет программа при сохранении графа, если в нём есть нода `checkFolder`
 * (`src/NODE_WIN/utils/syncSiteFormSidecar.ts` в fs.manager.tauri), и читается он
 * через `GET /api/storage/v1/sidecars?name=on-site-folder-check-form`.
 *
 * `options.json` сайт для этого НЕ разбирает. `options.json` — это граф: ноды,
 * рёбра, координаты, свойства всех плагинов. Доставать оттуда форму значило бы
 * знать внутреннее устройство редактора нод и завести второго читателя модели
 * нод, который ломается молча при любой правке редактора.
 *
 * ⚠️ Это НЕ то же самое, что `postSources.json` у автопостинга, хотя оба файла
 * программа компилирует при сохранении графа. Тот сайдкар в облако не уезжает —
 * он локальный build-артефакт, — и потому сайт читает там САМ ГРАФ
 * (`lib/posting/routes.ts`). Здесь наоборот: форма синхронизируется в проект
 * как обычный файл, и читать её надо именно из файла. Путать эти два случая
 * дорого: разница решает, где источник истины.
 *
 * Разбор строгий и поштучный: файл приходит из другой программы, и собрать по
 * нему форму «как получится» значит показать человеку слоты, которых граф не
 * ждёт, — а имена файлов в этой папке и есть способ найти их в After Effects.
 *
 * Чистый модуль: ни React, ни сети. Подробно — docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §4.
 */

/**
 * Версия формата, которую умеет читать этот код.
 *
 * Чужую версию НЕ читаем и не угадываем: несовпадение значит, что проект
 * сохранён другой версией программы, и молча собранная по догадкам форма
 * положила бы файлы под именами, которых граф не ждёт.
 */
export const SITE_FORM_VERSION = 1

/**
 * `data.pluginId` ноды, которая эту форму и порождает.
 *
 * Нужен не разбору формы, а панели «Настройки» проекта: свойства этой ноды
 * (шаблон имени папки, требования к содержимому) рисует диалог сборки элемента,
 * и общим списком настроек они показываться не должны. Одно и то же в двух
 * местах — это разъезжающиеся правки и вопрос «какое из полей главнее».
 */
export const CHECK_FOLDER_PLUGIN = "checkFolder"

/** Сколько штук нужно: `">="` — не меньше, `"="` — ровно столько. */
export type RequirementOp = ">=" | "="

/** Имя типа `folder` занято подпапкой, остальные приходят из словаря типов. */
export const FOLDER_TYPE = "folder"

export type ElementRow = {
  /** Уникален внутри дерева. */
  id: string
  /** Имя поля формы — оно же попадает в имя файла (names.ts). */
  label: string
  /** Подсказка в Markdown; пустая строка — подсказки нет. */
  tooltip: string
  /** Имя типа файла из словаря либо `folder`. */
  type: string
  op: RequirementOp
  /** Всегда ≥ 1. */
  count: number
  /** Требования к содержимому подпапки; пусто у всего, кроме `folder`. */
  children: ElementRow[]
}

export type SiteForm = {
  version: number
  /** Шаблон имени папки; пустой — берём `nodeLabel`. */
  folderNameTemplate: string
  /** Запасное имя, когда шаблон пуст. */
  nodeLabel: string
  rows: ElementRow[]
  /** Тип → расширения без точки, в нижнем регистре. */
  fileTypes: Record<string, string[]>
}

/**
 * Почему форму не показали.
 *
 * Причины разделены, потому что человеку они говорят разное и лечатся в разных
 * местах: `version` — обновить программу, `duplicate-label` — починить граф,
 * `shape` — файл битый. Одно «не удалось открыть» отправило бы человека искать
 * причину по симптомам.
 */
export type SiteFormError =
  | { reason: "shape"; detail: string }
  | { reason: "version"; version: number }
  | { reason: "duplicate-label"; label: string; path: string }

export type SiteFormResult =
  | { ok: true; form: SiteForm }
  | { ok: false; error: SiteFormError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Расширения нормализуем: `.MP4` и `mp4` в графе — один и тот же тип. */
function parseFileTypes(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [type, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue
    const extensions = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean)
    if (extensions.length > 0) out[type] = extensions
  }
  return out
}

function parseRow(raw: unknown, path: string): ElementRow | { error: SiteFormError } {
  if (!isRecord(raw)) {
    return { error: { reason: "shape", detail: `${path}: строка требования не объект` } }
  }

  const id = asString(raw.id).trim()
  const label = asString(raw.label).trim()
  const type = asString(raw.type).trim()
  if (!id) return { error: { reason: "shape", detail: `${path}: нет id` } }
  if (!label) return { error: { reason: "shape", detail: `${path}: нет label` } }
  if (!type) return { error: { reason: "shape", detail: `${path}: нет type` } }

  const op: RequirementOp = raw.op === "=" ? "=" : ">="
  // Ноль слотов — это не требование, а его отсутствие: такую строку в форме не
  // нарисовать, и приводим её к одному слоту, а не отбрасываем молча.
  const rawCount = Number(raw.count)
  const count = Number.isFinite(rawCount) && rawCount >= 1 ? Math.floor(rawCount) : 1

  const children: ElementRow[] = []
  if (type === FOLDER_TYPE && Array.isArray(raw.children)) {
    const nested = parseRows(raw.children, `${path}/${label}`)
    if ("error" in nested) return nested
    children.push(...nested.rows)
  }

  return { id, label, tooltip: asString(raw.tooltip), type, op, count, children }
}

/**
 * Строки одного уровня.
 *
 * Здесь же проверка уникальности `label`: имена файлов собираются из них, и два
 * одинаковых означают два файла с одним именем — разобрать такую папку обратно
 * нечем (names.ts#parseSlotName). Поэтому это отказ, а не предупреждение:
 * чинить надо в графе, а не в диалоге.
 */
function parseRows(
  raw: unknown,
  path: string,
): { rows: ElementRow[] } | { error: SiteFormError } {
  if (!Array.isArray(raw)) {
    return { error: { reason: "shape", detail: `${path}: rows не массив` } }
  }

  const rows: ElementRow[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    const row = parseRow(item, path)
    if ("error" in row) return row

    const key = row.label.toLowerCase()
    if (seen.has(key)) {
      return { error: { reason: "duplicate-label", label: row.label, path } }
    }
    seen.add(key)
    rows.push(row)
  }

  return { rows }
}

/** Разбор уже прочитанного JSON. */
export function parseSiteForm(raw: unknown): SiteFormResult {
  if (!isRecord(raw)) {
    return { ok: false, error: { reason: "shape", detail: "файл не объект" } }
  }

  const version = Number(raw.version)
  if (!Number.isFinite(version)) {
    return { ok: false, error: { reason: "shape", detail: "нет version" } }
  }
  if (version !== SITE_FORM_VERSION) {
    return { ok: false, error: { reason: "version", version } }
  }

  const element = raw.element
  if (!isRecord(element)) {
    return { ok: false, error: { reason: "shape", detail: "нет element" } }
  }

  const rows = parseRows(element.rows, "element.rows")
  if ("error" in rows) return { ok: false, error: rows.error }

  return {
    ok: true,
    form: {
      version,
      folderNameTemplate: asString(element.folderNameTemplate),
      nodeLabel: asString(element.nodeLabel),
      rows: rows.rows,
      fileTypes: parseFileTypes(raw.fileTypes),
    },
  }
}

/** Разбор тела сайдкара. Битый JSON — та же `shape`, что и битая структура. */
export function parseSiteFormBody(body: string): SiteFormResult {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return { ok: false, error: { reason: "shape", detail: "не JSON" } }
  }
  return parseSiteForm(raw)
}

/** Подходит ли файл слоту по расширению. Тип неизвестен — не ограничиваем. */
export function extensionFits(
  form: SiteForm,
  type: string,
  fileName: string,
): boolean {
  const allowed = form.fileTypes[type]
  if (!allowed || allowed.length === 0) return true
  const dot = fileName.lastIndexOf(".")
  if (dot < 0) return false
  return allowed.includes(fileName.slice(dot + 1).toLowerCase())
}

/** Семейства MIME, которые браузер называет одинаково и надёжно. */
const KNOWN_MIME_FAMILIES = ["video/", "image/", "audio/", "text/"]

/**
 * Ожидаемое семейство MIME для типа слота — ТОЛЬКО для подсказки при
 * перетаскивании.
 *
 * Во время перетаскивания браузер намеренно скрывает файл: `getAsFile()`
 * возвращает `null` до того, как его отпустят, и проверить расширение нечем.
 * Доступен только MIME, поэтому зона красится по семейству, а окончательную
 * проверку делает `extensionFits` уже по имени, при броске.
 *
 * `null` — у типа нет надёжного семейства (`aep`, `psd`, `scripts`, `xlsx`).
 */
export function expectedMimePrefix(type: string): string | null {
  if (type === "video") return "video/"
  if (type === "image") return "image/"
  if (type === "audio") return "audio/"
  if (type === "text") return "text/"
  return null
}

/**
 * Похож ли перетаскиваемый файл на то, что ждёт слот.
 *
 * Красим красным, только когда СЕМЕЙСТВО ЧУЖОЕ И ИЗВЕСТНОЕ: видео в картинки —
 * это точно не сюда. Всё остальное — `true`, и это не мягкость, а честность:
 * `image` принимает и `pdf`, и `svg`, у которых семейство другое или неизвестное,
 * и красная зона на правильном файле пугала бы зря. Ошибку в таком случае
 * поймает проверка расширения при броске.
 */
export function mimeFits(type: string, mime: string): boolean {
  const expected = expectedMimePrefix(type)
  if (!expected || !mime) return true
  if (!KNOWN_MIME_FAMILIES.some((family) => mime.startsWith(family))) return true
  return mime.startsWith(expected)
}

/** Имя папки при создании: шаблон, а если он пуст — подпись ноды (план §7.1). */
export function nameTemplateOf(form: SiteForm): string {
  return form.folderNameTemplate.trim() || form.nodeLabel.trim()
}
