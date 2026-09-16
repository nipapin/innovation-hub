import { buildProjectObjectKey, projectObjectPrefix } from "@/lib/s3-config"

export const CATALOG_FOLDER_NAME = "_catalog"
export const OPTIONS_FOLDER_NAME = "options"
export const FOLDER_STATE_FILE_NAME = "folderState.json"
export const OPTIONS_FILE_NAME = "options.json"
export const DESCRIPTION_FILE_NAME = "description.md"

/**
 * Папка, куда сайт кладёт файлы, выбранные клиентом в настройках проекта
 * (свойство `pathNavigator` с `exposedToSite`).
 *
 * Плоская намеренно. Подпапку «по назначению» вывести не из чего: `id` у
 * одинаковых нод совпадает (три ноды `selectFile` — три свойства с
 * `id: "pathNavigator"`), а `label` автор графа правит прямо в ноде, и папка
 * переезжала бы вслед за подписью. Различителем остаётся имя файла, а нода
 * адресует его полным путём — `Assets/logo.png`.
 *
 * Решение обратимо: значения хранят полный путь, поэтому уровень подпапок
 * можно добавить сверху, не трогая уже выданные проекты.
 */
export const ASSETS_FOLDER_NAME = "Assets"

/**
 * Три сайдкара, которые сайт читает по фиксированному ключу
 * (projectFolderStateKey и рядом в lib/project-storage.ts).
 *
 * В остальном это обычные файлы: их видно в дереве, можно скачать и перезалить.
 * Закреплены только имя и место — переименование или перенос уводит объект с
 * канонического ключа, и тумблер проекта вместе с настройками перестаёт
 * читаться при целом и на вид исправном файле.
 */
export const CANONICAL_SIDECAR_NAMES = [
  FOLDER_STATE_FILE_NAME,
  OPTIONS_FILE_NAME,
  DESCRIPTION_FILE_NAME,
] as const

function normalizeFolderPath(folderPath: string): string {
  return folderPath.replace(/^\/+|\/+$/g, "")
}

/** Лежит ли (folderPath, name) на каноническом ключе сайдкара. */
export function isCanonicalSidecar(folderPath: string, name: string): boolean {
  if (normalizeFolderPath(folderPath).toLowerCase() !== OPTIONS_FOLDER_NAME) {
    return false
  }
  const lower = name.toLowerCase()
  return CANONICAL_SIDECAR_NAMES.some((known) => known.toLowerCase() === lower)
}

/** Сама служебная папка проекта — её тоже нельзя переносить и удалять. */
export function isOptionsFolderRow(input: {
  folderPath: string
  name: string
  isFolder: boolean
}): boolean {
  return (
    input.isFolder &&
    normalizeFolderPath(input.folderPath) === "" &&
    input.name.toLowerCase() === OPTIONS_FOLDER_NAME
  )
}

/**
 * Строка каталога принадлежит служебной папке: сама `options` или что-то внутри.
 *
 * Нужно именно представлению, а не выборке. Кабинет пользователя эти файлы не
 * показывает: настройки автоматизации живут на отдельной вкладке, а в дереве
 * файлов и в списке материалов проекта они выглядели бы мусором. Админский
 * «Конвейер», наоборот, работает ровно с ними, поэтому фильтр включается на
 * стороне вида, а из каталога папка приезжает всегда — как любая другая.
 */
export function isServiceCatalogRow(row: {
  folderPath: string
  name: string
  isFolder: boolean
}): boolean {
  if (isOptionsFolderRow(row)) return true
  const folder = normalizeFolderPath(row.folderPath).toLowerCase()
  return (
    folder === OPTIONS_FOLDER_NAME ||
    folder.startsWith(`${OPTIONS_FOLDER_NAME}/`)
  )
}

/** MIME по логическому имени — сайдкары приходят без Content-Type от клиента. */
export function contentTypeForSidecar(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8"
  return "application/octet-stream"
}

const PROJECT_KEY_RE =
  /^projects\/([^/]+)\/([^/]+)\/(?:options\/(.+)|([^/]+)\/(.+)|([^/]+))$/

/**
 * Первым аргументом — `projects.storage_owner_id`, а не текущий владелец.
 * У переданного другому человеку проекта это разные люди, и ключи остаются под
 * тем, кто проект завёл (docs/ADMIN_WORKSPACE_PLAN.md §5).
 */
export function projectPrefix(
  storageOwnerId: string,
  projectId: string,
): string {
  return projectObjectPrefix(storageOwnerId, projectId)
}

export function isCatalogKey(
  key: string,
  storageOwnerId: string,
  projectId: string,
): boolean {
  return key.startsWith(
    `${projectPrefix(storageOwnerId, projectId)}${CATALOG_FOLDER_NAME}/`,
  )
}

export function parseProjectIdFromKey(key: string): string | null {
  const segments = key.split("/")
  return segments.length >= 4 && segments[0] === "projects"
    ? (segments[2] ?? null)
    : null
}

export function logicalKeyForFile(input: {
  storageOwnerId: string
  projectId: string
  folderPath: string
  name: string
}): string {
  const folder = input.folderPath.replace(/^\/+|\/+$/g, "")
  const relative = folder
    ? `${folder}/${input.name}`
    : input.name
  return buildProjectObjectKey(input.storageOwnerId, input.projectId, relative)
}

export function folderPathFromKey(
  storageOwnerId: string,
  projectId: string,
  key: string,
  fileName: string,
): string {
  const prefix = projectPrefix(storageOwnerId, projectId)
  if (!key.startsWith(prefix)) return ""
  const rest = key.slice(prefix.length)
  if (!rest || rest === fileName) return ""
  const withoutName = rest.endsWith(`/${fileName}`)
    ? rest.slice(0, -(fileName.length + 1))
    : rest.includes("/")
      ? rest.split("/").slice(0, -1).join("/")
      : ""
  return withoutName
}

export function isOptionsKey(
  key: string,
  storageOwnerId: string,
  projectId: string,
): boolean {
  return key.startsWith(
    `${projectPrefix(storageOwnerId, projectId)}${OPTIONS_FOLDER_NAME}/`,
  )
}

/** Physical object names are `{uuid}-{safeName}`. Strip the uuid for the catalog. */
const OBJECT_NAME_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i

export function logicalNameFromObjectKey(keyOrBasename: string): string {
  const basename = keyOrBasename.slice(keyOrBasename.lastIndexOf("/") + 1)
  const match = basename.match(OBJECT_NAME_UUID_RE)
  return match?.[1] && match[1].length > 0 ? match[1] : basename
}

export { PROJECT_KEY_RE }
