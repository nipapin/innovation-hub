import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { listAllProjectFiles } from "@/lib/repositories/project-files"
import {
  appMediaProxyPathForKey,
  buildProjectObjectKey,
  getS3Bucket,
  userMetaObjectKey,
} from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  isServiceCatalogRow,
  OPTIONS_FILE_NAME,
  OPTIONS_FOLDER_NAME,
} from "@/lib/storage/keys"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import { findFontEntry } from "@/lib/fonts/catalog"
import { installFamilyIntoProject } from "@/lib/fonts/library"
import type { StorageActor } from "@/lib/storage/write-path"
import { applyExposedOptionChanges, type ExposedOptionChange } from "@/lib/options/apply"
import { titleFontNames } from "@/lib/options/title"
import { ProjectStorageError } from "@/lib/options/errors"
import {
  overlayReferencePath,
  overlaySettingsFilePath,
  resolveByTail,
} from "@/lib/options/overlay-reference"
import {
  extractExposedOptions,
  readExposedOptions,
  type SkippedOption,
} from "@/lib/options/extract"
import type { ExposedOption } from "@/lib/options/types"

/**
 * R2/S3 layout for a project (replaces the Google Drive tree):
 *
 *   projects/{storageOwnerId}/{projectId}/project-meta.json
 *   projects/{storageOwnerId}/{projectId}/options/folderState.json
 *   projects/{storageOwnerId}/{projectId}/options/options.json
 *   projects/{storageOwnerId}/{projectId}/{folderPath}/{uuid}-{name}   — user files
 *
 * Первый сегмент — `projects.storage_owner_id`, а не текущий владелец: проект
 * можно передать другому человеку, и тогда они расходятся, а ключи остаются на
 * месте (docs/ADMIN_WORKSPACE_PLAN.md §5).
 *
 * Структура папок для кабинета живёт в Postgres `project_files` — вместе со
 * служебной папкой `options`: она такая же папка каталога, как любая другая, и
 * показывается в дереве наравне с ними. Строки сайдкарам создаёт
 * `writeSidecarSync` (lib/storage/write-path.ts), потому что сами объекты
 * пишутся по фиксированному ключу, минуя presign/notify.
 */

/**
 * Имена служебных файлов и папки лежат в lib/storage/keys.ts: их читает путь
 * записи, а импорт оттуда в эту сторону замкнул бы цикл. Здесь только
 * реэкспорт — чтобы существующие импорты из `@/lib/project-storage` работали.
 *
 * `description.md` — развёрнутое описание проекта в markdown: картинки, схемы,
 * таблицы. Отдельный файл, а не поле в options.json: options.json принадлежит
 * редактору нод, его формат задаёт десктопное приложение. Короткая подпись
 * остаётся в projects.description — она нужна на карточке в списке, а ходить за
 * ней в объектное хранилище на каждый рендер списка нельзя.
 */
export {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  OPTIONS_FILE_NAME,
  OPTIONS_FOLDER_NAME,
}

export const PROJECT_META_FILE_NAME = "project-meta.json"

/**
 * Разбор `options.json` живёт в `lib/options/`: его читает и вкладка настроек в
 * браузере, и запись на сервере, а тянуть ради типов весь этот модуль (а с ним
 * и клиент S3) в клиентский компонент нельзя. Здесь реэкспорт — чтобы прежние
 * импорты из `@/lib/project-storage` продолжали работать.
 */
export {
  applyExposedOptionChanges,
  extractExposedOptions,
  ProjectStorageError,
}
export type { ExposedOptionChange } from "@/lib/options/apply"
export type {
  ExposedOption,
  ExposedOptionControl,
  ExposedOptionValue,
} from "@/lib/options/types"

export type ProjectStorageFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  s3Key: string | null
  folderPath: string
  /** Кто принёс файл; null — атрибуции нет (загрузка до её появления). */
  uploadedByName?: string | null
  children?: ProjectStorageFile[]
}

export type ProjectFolderState = {
  schemaVersion: number
  enabled: boolean
  disabledReason: string | null
  disabledAt: string | null
  lastActivityAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type ProjectStorageState = {
  files: ProjectStorageFile[]
  folderState: ProjectFolderState | null
  options: ExposedOption[]
  /**
   * Свойства, открытые клиенту, но сайту незнакомые. Нужны, чтобы о них можно
   * было сказать вслух: молча исчезнувшая галочка обходится вечером разбора
   * (docs/OVERLAY_CONTROL_PLAN.md §7).
   */
  skippedOptions: SkippedOption[]
  optionsFileExists: boolean
  /**
   * Версия options.json в хранилище. Приоритет у правки клиента — условной
   * записи с сайта нет, — но программе нужен признак «в облаке версия новее
   * моей», иначе Ctrl+S затрёт правку молча (docs/PROJECT_OPTIONS_PANEL.md §4).
   */
  optionsEtag: string | null
  /**
   * Словарь типов файлов конвейера — все расширения из его настроек
   * (`automation_settings`, домен `fileType`). Им контрол выбора файла
   * проверяет расширение ДО заливки.
   *
   * Едет вместе с настройками проекта, а не отдельным запросом, потому что оба
   * эндпоинта со словарями клиенту недоступны: админский требует права
   * `pipeline.operate`, машинный — токена `mch_…`.
   */
  fileTypes: Record<string, string[]>
  available: boolean
}

export function siteUpdatedBy(email: string): string {
  return `site:${email.toLowerCase()}`
}

/**
 * Ключи сайдкаров. Первым аргументом — `projects.storage_owner_id`, а не
 * текущий владелец: у переданного проекта они расходятся, и объекты остаются на
 * прежних ключах (docs/ADMIN_WORKSPACE_PLAN.md §5).
 */
export function projectMetaKey(
  storageOwnerId: string,
  projectId: string,
): string {
  return buildProjectObjectKey(storageOwnerId, projectId, PROJECT_META_FILE_NAME)
}

export function projectFolderStateKey(
  storageOwnerId: string,
  projectId: string,
): string {
  return buildProjectObjectKey(
    storageOwnerId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${FOLDER_STATE_FILE_NAME}`,
  )
}

export function projectOptionsKey(
  storageOwnerId: string,
  projectId: string,
): string {
  return buildProjectObjectKey(
    storageOwnerId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${OPTIONS_FILE_NAME}`,
  )
}

export function projectDescriptionKey(
  storageOwnerId: string,
  projectId: string,
): string {
  return buildProjectObjectKey(
    storageOwnerId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${DESCRIPTION_FILE_NAME}`,
  )
}

/**
 * Читает описание проекта. null — файла ещё нет, это нормальное состояние:
 * описание появляется, когда его напишут.
 */
export async function readProjectDescriptionMd(
  storageOwnerId: string,
  projectId: string,
): Promise<string | null> {
  return getObjectText(projectDescriptionKey(storageOwnerId, projectId))
}

export async function writeProjectDescriptionMd(input: {
  storageOwnerId: string
  projectId: string
  body: string
}): Promise<void> {
  await putObjectText(
    projectDescriptionKey(input.storageOwnerId, input.projectId),
    input.body,
    "text/markdown; charset=utf-8",
  )
}

/** Object key for a user upload under a logical folder path. */
export function projectUploadObjectKey(
  storageOwnerId: string,
  projectId: string,
  folderPath: string,
  fileName: string,
): string {
  const safe = fileName.replace(/^\/+/, "").replace(/\.\./g, "_")
  const folder = folderPath.replace(/^\/+|\/+$/g, "")
  const relative = folder
    ? `${folder}/${safe}`
    : safe
  return buildProjectObjectKey(storageOwnerId, projectId, relative)
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseFolderState(data: unknown): ProjectFolderState | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  return {
    schemaVersion: typeof d.schemaVersion === "number" ? d.schemaVersion : 1,
    enabled: d.enabled === true,
    disabledReason:
      typeof d.disabledReason === "string" ? d.disabledReason : null,
    disabledAt: typeof d.disabledAt === "string" ? d.disabledAt : null,
    lastActivityAt:
      typeof d.lastActivityAt === "string" ? d.lastActivityAt : null,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
  }
}

export type ObjectTextWithMeta = {
  body: string
  etag: string | null
  sizeBytes: number
  lastModified: string | null
}

/**
 * Читает текст объекта вместе с его версией.
 *
 * Версия нужна на чтении сайдкара: клиент сравнивает облачную копию с локальной,
 * а `etag` возвращает обратно в `ifMatch` при записи — иначе перезапись затрёт
 * правку, случившуюся между чтением и записью, и узнать об этом будет нечем.
 */
export async function getObjectTextWithMeta(
  key: string,
): Promise<ObjectTextWithMeta | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const body = response.Body
    if (!body) return null
    return {
      body: await body.transformToString(),
      etag: response.ETag?.replace(/"/g, "") ?? null,
      sizeBytes: Number(response.ContentLength ?? 0),
      lastModified: response.LastModified?.toISOString() ?? null,
    }
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "$metadata" in error &&
      typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === "number"
        ? (error as { $metadata: { httpStatusCode: number } }).$metadata
            .httpStatusCode
        : null
    if (status === 404) return null
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : ""
    if (name === "NoSuchKey" || name === "NotFound") return null
    throw error
  }
}

export async function getObjectText(key: string): Promise<string | null> {
  const object = await getObjectTextWithMeta(key)
  return object?.body ?? null
}

/** Пишет объект и отдаёт его новую версию — её сайт возвращает клиенту. */
async function putObjectText(
  key: string,
  content: string,
  contentType = "application/json",
): Promise<string | null> {
  if (!isS3Configured()) {
    throw new ProjectStorageError("Object storage is not configured.")
  }
  const response = await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: content,
      ContentType: contentType,
    }),
  )
  return response.ETag?.replace(/"/g, "") ?? null
}

export async function objectExists(key: string): Promise<boolean> {
  if (!isS3Configured()) return false
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    return true
  } catch {
    return false
  }
}

export async function writeProjectMeta(input: {
  /** Куда писать объект — `projects.storage_owner_id`. */
  storageOwnerId: string
  /** Чей проект сейчас — уезжает в тело `project-meta.json`. */
  ownerId: string
  projectId: string
  name: string
  description: string
  ownerEmail: string
  isArchived?: boolean
  createdAt?: string
  updatedAt?: string
}): Promise<void> {
  const now = new Date().toISOString()
  const payload = {
    schema: 1,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    isArchived: input.isArchived ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  }
  await putObjectText(
    projectMetaKey(input.storageOwnerId, input.projectId),
    JSON.stringify(payload, null, 2),
  )
}

export async function writeUserMeta(input: {
  userId: string
  email: string
  createdAt?: string
}): Promise<void> {
  const payload = {
    schema: 1,
    userId: input.userId,
    email: input.email,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  await putObjectText(
    userMetaObjectKey(input.userId),
    JSON.stringify(payload, null, 2),
  )
}

export async function syncUserMeta(input: {
  userId: string
  email: string
  createdAt?: string
}): Promise<void> {
  try {
    await writeUserMeta(input)
  } catch (error) {
    console.error("[storage] failed to write user-meta.json", error)
  }
}

/**
 * Манифест проекта скрыт всегда: его пишет сайт, редактировать его человеку
 * нечем, и в списке файлов он выглядел бы мусором.
 *
 * Служебная папка `options` скрывается не здесь, а по представлению —
 * `isServiceCatalogRow` плюс флаг `includeServiceFiles`.
 */
function isHiddenName(name: string): boolean {
  return name.toLowerCase() === PROJECT_META_FILE_NAME
}

/**
 * Отсекает служебную папку и её содержимое из плоского списка строк каталога.
 *
 * Нужна везде, где строки уходят пользователю списком, а не деревом: с
 * появлением строк у сайдкаров (`writeSidecarSync`) `options/options.json` и
 * `options/__stat/*.jsonl` иначе попадают в материалы проекта наравне с его
 * файлами. Админский «Конвейер» этой функцией не пользуется — он показывает всё.
 */
export function withoutServiceRows<
  T extends { folderPath: string; name: string; isFolder: boolean },
>(rows: T[]): T[] {
  return rows.filter((row) => !isServiceCatalogRow(row))
}

function toStorageFile(row: ProjectFileRecord): ProjectStorageFile {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.isFolder
      ? "application/vnd.folder"
      : row.contentType || "application/octet-stream",
    isFolder: row.isFolder,
    sizeBytes: row.isFolder ? null : row.sizeBytes,
    modifiedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    s3Key: row.s3Key,
    folderPath: row.folderPath,
    uploadedByName: row.uploadedByName ?? null,
  }
}

function buildTree(
  rows: ProjectFileRecord[],
  view: { includeServiceFiles: boolean },
): ProjectStorageFile[] {
  const visible = rows.filter(
    (row) =>
      !isHiddenName(row.name) &&
      (view.includeServiceFiles || !isServiceCatalogRow(row)),
  )
  const byParent = new Map<string, ProjectFileRecord[]>()

  for (const row of visible) {
    const key = row.folderPath
    const list = byParent.get(key)
    if (list) list.push(row)
    else byParent.set(key, [row])
  }

  const sortNodes = (a: ProjectStorageFile, b: ProjectStorageFile) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  }

  function childrenOf(folderPath: string): ProjectStorageFile[] {
    const rowsHere = byParent.get(folderPath) ?? []
    const nodes = rowsHere.map(toStorageFile)
    for (const node of nodes) {
      if (!node.isFolder) continue
      const childPath =
        folderPath === "" ? node.name : `${folderPath}/${node.name}`
      node.children = childrenOf(childPath).sort(sortNodes)
    }
    return nodes.sort(sortNodes)
  }

  return childrenOf("")
}

/**
 * Cabinet view: nested file tree from Postgres + automation JSON from R2.
 *
 * `includeServiceFiles` включает в дерево служебную папку `options`. По
 * умолчанию она скрыта: в кабинете пользователь работает с материалами проекта,
 * а настройки автоматизации у него на отдельной вкладке. Включает флаг только
 * админский «Конвейер» — он работает именно со служебными файлами.
 *
 * Сама папка при этом приезжает из того же `project_files`, что и всё остальное:
 * отдельного листинга бакета для неё больше нет. Раньше он был нужен, потому что
 * сайдкарам не создавали строк, и из-за него в «Конвейере» показывались
 * физические имена (`{uuid}-folderState.json`) и мусор от прошлых заливок.
 */
export async function loadProjectStorageState(
  storageOwnerId: string,
  projectId: string,
  view?: { includeServiceFiles?: boolean },
): Promise<ProjectStorageState> {
  const available = isS3Configured()
  const rows = await listAllProjectFiles(projectId)
  const files = buildTree(rows, {
    includeServiceFiles: view?.includeServiceFiles === true,
  })

  if (!available) {
    return {
      files,
      folderState: null,
      options: [],
      skippedOptions: [],
      optionsFileExists: false,
      optionsEtag: null,
      fileTypes: {},
      available: false,
    }
  }

  const [stateRaw, optionsObject] = await Promise.all([
    getObjectText(projectFolderStateKey(storageOwnerId, projectId)),
    getObjectTextWithMeta(projectOptionsKey(storageOwnerId, projectId)),
  ])

  const folderState = stateRaw
    ? parseFolderState(parseJson(stateRaw))
    : null
  const optionsFileExists = optionsObject != null
  // Разбираем один раз: из этого же JSON достаётся и список параметров, и
  // снимок словаря типов.
  const optionsJson = optionsObject ? parseJson(optionsObject.body) : null
  // Вместе со списком — что показать не вышло: свойство с типом, которого сайт
  // не знает, иначе исчезало бы молча (docs/OVERLAY_CONTROL_PLAN.md §7).
  const { options, skipped: skippedOptions } = optionsJson
    ? readExposedOptions(optionsJson)
    : { options: [], skipped: [] }

  // Референс для рамки наложения (docs/OVERLAY_CONTROL_PLAN.md §8.5). Путь даёт
  // граф, ссылку — этот слой: только здесь есть ключи объектов и строки файлов.
  // Всё в пределах ЭТОГО проекта: копия тестового набора у каждого своя, и
  // заглядывать в шаблон или в соседний проект нельзя.
  const withReference = options.map((option) => {
    if (option.control !== "overlaySettings" || !optionsJson) return option
    const key = overlayReferenceKey(rows, optionsJson, option)
    return key ? { ...option, referenceUrl: appMediaProxyPathForKey(key) } : option
  })

  return {
    files,
    folderState,
    options: withReference,
    skippedOptions,
    optionsFileExists,
    optionsEtag: optionsObject?.etag ?? null,
    fileTypes: await loadFileTypes(),
    available: true,
  }
}

/**
 * Словарь типов файлов конвейера — общий, из его настроек.
 *
 * Его отсутствие НЕ должно ронять загрузку проекта: `readFileTypeDictionary`
 * кидает на незалитой миграции, а файловое дерево к словарю отношения не имеет.
 * Пустой словарь на клиенте означает «проверить нечем», и выбор файла
 * продолжает работать.
 */

/**
 * Ключ объекта по пути внутри проекта (`Assets/logo.png`).
 *
 * Сверяем папку и имя, не считаясь с регистром: путь приходит из графа, а его
 * туда писали и программа, и сайт, и человек руками. Промах — `null`, и рамка
 * останется пустой; подставлять «похожий» файл нельзя.
 */
function findFileKey(
  rows: ProjectFileRecord[],
  projectPath: string,
): string | null {
  const parts = projectPath.replace(/^\/+/, "").split("/")
  const name = parts.pop()?.toLowerCase()
  if (!name) return null
  const folder = parts.join("/").toLowerCase()
  for (const row of rows) {
    if (row.isFolder || !row.s3Key) continue
    if (row.name.toLowerCase() !== name) continue
    if (row.folderPath.replace(/^\/+/, "").toLowerCase() !== folder) continue
    return row.s3Key
  }
  return null
}


/**
 * Ключ объекта для рамки наложения — два шага поиска (§8.5).
 *
 * Сначала сосед по графу: клиент залил файл через `pathNavigator`, путь
 * относительный, искать нечего. Если соседа нет, значение пустое или файл по
 * нему не нашёлся — путь из самих настроек (`fgFilePath`), сверкой хвоста.
 *
 * Второй шаг нужен не реже первого: автор графа настраивал наложение у себя, и
 * путь там абсолютный, с его машины. Файл при этом в проекте есть — он приехал
 * вместе с копией.
 */
function overlayReferenceKey(
  rows: ProjectFileRecord[],
  optionsJson: unknown,
  option: ExposedOption,
): string | null {
  const fromGraph = overlayReferencePath(optionsJson, option.path)
  if (fromGraph) {
    const key = findFileKey(rows, fromGraph)
    if (key) return key
  }

  const fromSettings = overlaySettingsFilePath(option.value)
  if (!fromSettings) return null
  const candidates = rows
    .filter((row) => !row.isFolder && row.s3Key)
    .map((row) => `${row.folderPath.replace(/^\/+/, "")}/${row.name}`)
  const matched = resolveByTail(candidates, fromSettings)
  return matched ? findFileKey(rows, matched) : null
}

async function loadFileTypes(): Promise<Record<string, string[]>> {
  try {
    return await readFileTypeDictionary()
  } catch (error) {
    console.error("[project-storage] file type dictionary unavailable", error)
    return {}
  }
}

/**
 * Пишет options/folderState.json. Файла может не быть: десктоп намеренно не
 * создаёт options/ у нетронутых проектов (см. docs/FOLDER_STATE_SSOT_PLAN.md),
 * поэтому первое переключение тумблера его создаёт, а не падает. Готовность
 * проекта к обработке это НЕ означает — её определяет наличие options.json
 * (см. optionsFileExists в ProjectStorageState).
 *
 * Не вызывать напрямую для смены паузы: тумблер живёт в двух хранилищах, и
 * порядок записи задаёт lib/project-automation.ts#setProjectPaused.
 */
export async function setProjectAutomationEnabled(input: {
  storageOwnerId: string
  projectId: string
  enabled: boolean
  updatedBy: string
}): Promise<ProjectFolderState> {
  const key = projectFolderStateKey(input.storageOwnerId, input.projectId)
  const raw = await getObjectText(key)
  const parsed = raw == null ? null : parseJson(raw)
  const current =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}

  const now = new Date().toISOString()
  const next: Record<string, unknown> = {
    schemaVersion: 1,
    ...current,
    enabled: input.enabled,
    disabledReason: input.enabled ? null : "manual",
    disabledAt: input.enabled ? null : now,
    updatedAt: now,
    updatedBy: input.updatedBy,
  }

  await putObjectText(key, JSON.stringify(next, null, 2))

  const state = parseFolderState(next)
  if (!state) {
    throw new ProjectStorageError("Failed to update folder state.")
  }
  return state
}

/**
 * Правка клиента поверх свежей версии графа.
 *
 * Читаем файл прямо здесь, а не берём снимок, с которым открылась страница:
 * клиент присылает только путь и значение, поэтому структурные изменения
 * автора (новые ноды, переименованные свойства) правка не затирает — она
 * ложится на то, что лежит в хранилище сейчас.
 *
 * Обратная сторона гонки — Ctrl+S в программе поверх этой правки — здесь не
 * лечится намеренно: приоритет у клиента, а программа сравнивает `etag` своей
 * копии с облачной и решает сама (docs/PROJECT_OPTIONS_PANEL.md §4). Поэтому
 * новую версию возвращаем наружу.
 */

/**
 * Абсолютный `fgFilePath` с машины автора → путь внутри проекта (§8.5).
 *
 * Один раз разрешили сверкой хвоста — дальше берём сразу, без поиска. Программа
 * это поймёт: её модалка резолвит `fgFilePath` через
 * `toAbsolutePath(settings.fgFilePath, projectPath)`, то есть относительный путь
 * для неё штатный.
 *
 * Делается ПРИ СОХРАНЕНИИ, а не при открытии настроек: запись в граф от простого
 * просмотра — это то, чего не ждут. И только для путей, похожих на абсолютные:
 * относительный уже в нужной форме, трогать его незачем.
 *
 * Значение по смыслу не меняется — меняется его форма, и обе стороны читают обе.
 */
async function relativizeOverlayPaths(
  root: unknown,
  projectId: string,
): Promise<void> {
  const { options } = readExposedOptions(root)
  const overlays = options.filter((o) => o.control === "overlaySettings")
  if (overlays.length === 0) return

  const rows = await listAllProjectFiles(projectId)
  const candidates = rows
    .filter((row) => !row.isFolder && row.s3Key)
    .map((row) => `${row.folderPath.replace(/^\/+/, "")}/${row.name}`)

  for (const option of overlays) {
    const current = overlaySettingsFilePath(option.value)
    if (!current || !isAbsoluteLikePath(current)) continue
    const matched = resolveByTail(candidates, current)
    if (!matched) continue

    const controlProps = resolveNode(root, option.path)
    if (!controlProps) continue
    const raw = controlProps.value
    if (typeof raw !== "string") continue
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      ;(parsed as Record<string, unknown>).fgFilePath = matched
      controlProps.value = JSON.stringify(parsed)
    } catch {
      // Значение испорчено — трогать его тем более не станем.
    }
  }
}

/**
 * Шрифты титров — в папку проекта (docs/FONTS_PLAN.md §7).
 *
 * Делается ПРИ СОХРАНЕНИИ, по уже записанному значению, а не при выборе в
 * модалке: перебирая шрифты, клиент открывает и закрывает её десяток раз, и
 * каждое «Применить» оставляло бы в проекте файл, который никуда не поехал.
 * Значение и файл должны появляться вместе.
 *
 * Разбор значения, а не отдельный канал от браузера, — по той же причине, что у
 * `relativizeOverlayPaths` рядом: что реально уедет на машину, знает файл, а не
 * страница, с которой пришла правка.
 *
 * Не бросает. Настройки титров — работа клиента, и терять её из-за
 * незакопировавшегося шрифта нельзя; прогон на отсутствующий шрифт пожалуется
 * сам, а молча потерянная правка не пожалуется никогда. То же решение, что в
 * программе (`stashFontsInProject`).
 */
async function installTitleFonts(
  root: unknown,
  storageOwnerId: string,
  projectId: string,
  actor?: StorageActor | null,
): Promise<void> {
  const { options } = readExposedOptions(root)
  const families = new Set<string>()
  for (const option of options) {
    if (option.control !== "titleSettings") continue
    for (const name of titleFontNames(option.value)) families.add(name)
  }
  if (families.size === 0) return

  for (const family of families) {
    // Шрифта нет в витрине — значит это либо системный из старых настроек
    // (Arial и прочие, §5 плана), либо файл, который автор положил в проект
    // сам. И в том, и в другом случае класть нам нечего.
    if (!findFontEntry(family)) continue
    await installFamilyIntoProject({
      storageOwnerId,
      projectId,
      family,
      actor,
    })
  }
}

/** Путь с диска: `/Users/…`, `C:\\…` или UNC. Относительный — всё остальное. */
function isAbsoluteLikePath(path: string): boolean {
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\")
}

/** Узел графа по пути из DTO. Тот же обход, что и при записи правок. */
function resolveNode(
  root: unknown,
  path: string[],
): Record<string, unknown> | null {
  let node: unknown = root
  for (const segment of path) {
    if (!node || typeof node !== "object") return null
    node = Array.isArray(node)
      ? node[Number.parseInt(segment, 10)]
      : (node as Record<string, unknown>)[segment]
  }
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

export async function updateProjectExposedOptions(input: {
  storageOwnerId: string
  projectId: string
  changes: ExposedOptionChange[]
  /** Кто правит — попадёт в `uploaded_by` шрифта, положенного в проект. */
  actor?: StorageActor | null
}): Promise<{ options: ExposedOption[]; etag: string | null }> {
  const key = projectOptionsKey(input.storageOwnerId, input.projectId)
  const raw = await getObjectText(key)
  if (raw == null) {
    throw new ProjectStorageError(
      "Automation is not set up for this project yet.",
    )
  }

  const root = parseJson(raw)
  if (!root || typeof root !== "object") {
    throw new ProjectStorageError(
      "options.json is not valid JSON; cannot apply changes.",
    )
  }

  applyExposedOptionChanges(root, input.changes)
  await relativizeOverlayPaths(root, input.projectId)

  const etag = await putObjectText(key, JSON.stringify(root, null, 2))
  // После записи значения, а не до: файл шрифта без настройки, которая его
  // называет, — мусор в проекте, а настройка без файла хотя бы доедет до
  // машины, где сработает последнее звено `fonts.ensure`.
  await installTitleFonts(root, input.storageOwnerId, input.projectId, input.actor)
  return { options: extractExposedOptions(root), etag }
}
