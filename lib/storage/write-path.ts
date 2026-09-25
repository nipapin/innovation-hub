import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { PoolClient } from "pg"
import { withTransaction } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"
import {
  appendStorageChange,
  nowUnixSec,
} from "@/lib/storage/changes"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  assertLogicalPath,
  assertNameFree,
  folderPrefix,
  isMoveIntoSelf,
  validateLogicalName,
} from "@/lib/storage/file-names"
import {
  CATALOG_FOLDER_NAME,
  contentTypeForSidecar,
  folderPathFromKey,
  isCanonicalSidecar,
  isCatalogKey,
  isOptionsFolderRow,
  logicalKeyForFile,
  logicalNameFromObjectKey,
  OPTIONS_FOLDER_NAME,
  parseProjectIdFromKey,
  projectPrefix,
} from "@/lib/storage/keys"
import type { StorageChangeOp, StorageChangePayload } from "@/lib/storage/types"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

const FILE_FIELDS = `
  id,
  project_id AS "projectId",
  folder_path AS "folderPath",
  name,
  is_folder AS "isFolder",
  s3_key AS "s3Key",
  size_bytes::float8 AS "sizeBytes",
  content_type AS "contentType",
  etag,
  content_hash AS "contentHash",
  created_at AS "createdAt"
`

export { StorageWriteError }

export type ObjectHead = {
  etag: string | null
  size: number
  contentHash: string | null
  originMtime: number | null
}

/**
 * Кто совершает запись.
 *
 * Внимание: это НЕ `userId`, который уже принимают writeFolderCreate/writeRename —
 * тот всегда владелец проекта и нужен только для построения ключа в хранилище
 * (`projectPrefix(storageOwnerId, …)`). Здесь — действующее лицо, и в расшаренном
 * проекте это чаще всего не владелец.
 *
 * `userId` уезжает в журнал всегда: сквозной ответ на «кто это сделал».
 * `isUploader` отвечает на другой вопрос — считать ли его тем, кто принёс файл.
 * У машин парка (`rc_`) он `false`: машина возвращает результаты в проект, и если
 * бы её запись перетирала `uploaded_by`, `description.contact` следующей задачи
 * переехал бы на админа, который зарегистрировал компьютер.
 */
export type StorageActor = {
  userId: string | null
  /** По умолчанию true — записи с сайта и с персонального `mch_`-токена. */
  isUploader?: boolean
}

/** id для `uploaded_by`: null, если актора нет или он не заливщик. */
function uploaderIdOf(actor: StorageActor | null | undefined): string | null {
  if (!actor?.userId) return null
  return actor.isUploader === false ? null : actor.userId
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const meta = response.Metadata ?? {}
    const originRaw = meta["mtime"] ?? meta["x-amz-meta-mtime"]
    return {
      etag: response.ETag?.replace(/"/g, "") ?? null,
      size: Number(response.ContentLength ?? 0),
      contentHash: meta["sha256"] ?? meta["x-amz-meta-sha256"] ?? null,
      originMtime: originRaw ? Number.parseInt(String(originRaw), 10) : null,
    }
  } catch {
    return null
  }
}

/**
 * Убирает объект, который уже залит, но строку в каталоге не получил.
 *
 * Байты в бакете появляются от PUT по presigned URL, а строка — от `/notify`.
 * Между ними стоит проверка имени, и её отказ раньше оставлял оплаченный объект
 * навсегда: удалять его клиенту нечем — `delete` работает по `file_id`, а строки
 * не появилось. Зовётся только на ключ, на который заведомо не ссылается ни одна
 * строка, поэтому живой файл этим снести нельзя.
 */
async function deleteOrphanUpload(key: string): Promise<void> {
  if (!isS3Configured()) return
  try {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
  } catch (error) {
    // Не маскируем исходную ошибку записи: она важнее неудачной уборки.
    console.error("[storage] failed to remove orphaned upload", key, error)
  }
}

function isNameConflict(error: unknown): boolean {
  return error instanceof StorageWriteError && error.status === 409
}

/**
 * Отказ, который повтором не лечится: недопустимое имя (400) или занятое (409).
 *
 * Нужен, чтобы решить судьбу уже залитых байтов. Строку каталога не создали,
 * ссылок на ключ нет — объект заведомо сирота, и оставлять его значит платить за
 * то, что никто никогда не прочитает и не сможет удалить (`delete` работает по
 * file_id). А вот при неизвестной ошибке — упало соединение с базой, отвалился
 * пул — объект НЕ убираем: клиент повторит `/notify` тем же ключом, и байты, уже
 * доехавшие до бакета, пригодятся. Разница существенная, когда файл на гигабайты.
 */
function isDeterministicRejection(error: unknown): boolean {
  return (
    error instanceof StorageWriteError &&
    (error.status === 400 || error.status === 409)
  )
}

/**
 * Единственное исключение из «options — обычная папка».
 *
 * Содержимое служебной папки создаётся, переименовывается, переносится и
 * удаляется как любое другое. Но три файла сайт читает по фиксированному ключу
 * (projectFolderStateKey и рядом), а сама папка задаёт этот ключ. Уведи их с
 * места — и тумблер проекта вместе с настройками перестанет читаться при целом
 * и на вид исправном файле, без единой ошибки где-либо.
 *
 * Поэтому закреплены только имя и место: `folderState.json`, `options.json`,
 * `description.md` внутри `options` и сама папка `options` в корне проекта.
 * Перезапись содержимого при этом полностью разрешена — через PUT /sidecars.
 */
function assertSidecarPlaceIsStable(
  row: { folderPath: string; name: string; isFolder: boolean },
  operation: "rename" | "delete",
): void {
  const what = isOptionsFolderRow(row)
    ? `The "${OPTIONS_FOLDER_NAME}" folder`
    : isCanonicalSidecar(row.folderPath, row.name)
      ? `"${row.name}"`
      : null
  if (!what) return

  throw new StorageWriteError(
    operation === "rename"
      ? `${what} cannot be renamed or moved: the site reads it at a fixed key. Its contents can still be replaced through PUT /api/storage/v1/sidecars.`
      : `${what} cannot be deleted: project automation reads it at a fixed key.`,
    403,
  )
}

async function journal(
  client: PoolClient,
  input: {
    projectId: string
    key: string
    op: StorageChangeOp
    size?: number | null
    etag?: string | null
    contentHash?: string | null
    eventId?: string | null
    actor?: StorageActor | null
    payload?: StorageChangePayload
  },
): Promise<number> {
  const { actor, ...rest } = input
  return appendStorageChange(client, {
    ...rest,
    actorUserId: actor?.userId ?? null,
    eventTime: nowUnixSec(),
  })
}

async function touchFileRow(
  client: PoolClient,
  fileId: string,
  seq: number,
  patch: {
    etag?: string | null
    contentHash?: string | null
    originMtime?: number | null
    sizeBytes?: number
    s3Key?: string
    /** Новый заливщик при перезаписи; null оставляет прежнего. */
    uploadedBy?: string | null
  },
): Promise<void> {
  await client.query(
    `UPDATE project_files
        SET etag = COALESCE($3, etag),
            content_hash = COALESCE($4, content_hash),
            origin_mtime = COALESCE($5, origin_mtime),
            size_bytes = COALESCE($6, size_bytes),
            s3_key = COALESCE($7, s3_key),
            uploaded_by = COALESCE($8, uploaded_by),
            updated_at = NOW(),
            last_seq = $2,
            deleted_at = NULL
      WHERE id = $1`,
    [
      fileId,
      seq,
      patch.etag ?? null,
      patch.contentHash ?? null,
      patch.originMtime ?? null,
      patch.sizeBytes ?? null,
      patch.s3Key ?? null,
      patch.uploadedBy ?? null,
    ],
  )
}

export async function writeFolderCreate(input: {
  /**
   * `projects.storage_owner_id` — первый сегмент ключа. Не путать ни с `actor`
   * (кто это делает), ни с владельцем: у переданного проекта владелец другой,
   * а ключи остались под тем, кто проект завёл.
   */
  storageOwnerId: string
  projectId: string
  folderPath: string
  name: string
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord> {
  const name = validateLogicalName(input.name)
  const folderPath = input.folderPath.replace(/^\/+|\/+$/g, "")
  assertLogicalPath(folderPath, name)

  return withTransaction(async (client) => {
    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath,
      name,
    })
    const id = randomUUID()
    const key = logicalKeyForFile({
      storageOwnerId: input.storageOwnerId,
      projectId: input.projectId,
      folderPath,
      name,
    })

    // uploaded_by у папки — её создатель: для папки-источника это первое звено
    // отката, когда актора события готовности не осталось (см. resolveContact
    // в lib/pipeline/scan.ts).
    const result = await client.query<ProjectFileRecord>(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key, size_bytes,
          content_type, uploaded_by
       )
       VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '', $5)
       RETURNING ${FILE_FIELDS}`,
      [id, input.projectId, folderPath, name, uploaderIdOf(input.actor)],
    )
    const file = result.rows[0]!

    const seq = await journal(client, {
      projectId: input.projectId,
      key,
      op: "put",
      size: 0,
      eventId: input.eventId ?? null,
      actor: input.actor,
      payload: {
        fileId: file.id,
        name,
        folderPath,
        isFolder: true,
      },
    })
    await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
      file.id,
      seq,
    ])
    return file
  })
}

/**
 * Завести несколько папок одной транзакцией.
 *
 * Зачем: структура элемента — это несколько вложенных папок сразу, и заводились
 * они по одной отдельными запросами. Дорого там не SQL, а то, что на каждую
 * папку приходился свой сетевой круг и своя транзакция; на структуре из десятка
 * папок окно сборки открывалось заметно дольше, чем читало дерево.
 *
 * Порядок items важен и не сортируется здесь: родителя надо завести раньше
 * ребёнка, и знает об этом вызывающий (см. `missingFolders` в
 * lib/tools/element/slots.ts — он уже отдаёт сверху вниз).
 *
 * Транзакция одна на всю пачку: либо структура появляется целиком, либо не
 * появляется вовсе. Наполовину заведённая структура хуже незаведённой — по ней
 * не видно, докуда дошло, а повтор упёрся бы в занятые имена.
 */
export async function writeFolderCreateBatch(input: {
  storageOwnerId: string
  projectId: string
  items: readonly { folderPath: string; name: string }[]
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord[]> {
  if (input.items.length === 0) return []

  const planned = input.items.map((item) => {
    const name = validateLogicalName(item.name)
    const folderPath = item.folderPath.replace(/^\/+|\/+$/g, "")
    assertLogicalPath(folderPath, name)
    return { name, folderPath }
  })

  /*
    Дубли внутри самой пачки ловим до транзакции: `assertNameFree` их не увидит,
    потому что строки соседа в каталоге ещё нет — она появится на следующем шаге
    того же цикла. Без этой проверки пачка с двумя одинаковыми именами прошла бы
    и оставила в каталоге две неразличимые папки.
  */
  const seen = new Set<string>()
  for (const item of planned) {
    const key = `${item.folderPath.toLowerCase()}/${item.name.toLowerCase()}`
    if (seen.has(key)) {
      throw new StorageWriteError(
        `Two folders in the batch would take the name "${item.name}".`,
        409,
      )
    }
    seen.add(key)
  }

  return withTransaction(async (client) => {
    const created: ProjectFileRecord[] = []

    for (const [index, item] of planned.entries()) {
      await assertNameFree(client, {
        projectId: input.projectId,
        folderPath: item.folderPath,
        name: item.name,
      })

      const id = randomUUID()
      const key = logicalKeyForFile({
        storageOwnerId: input.storageOwnerId,
        projectId: input.projectId,
        folderPath: item.folderPath,
        name: item.name,
      })

      const result = await client.query<ProjectFileRecord>(
        `INSERT INTO project_files (
            id, project_id, folder_path, name, is_folder, s3_key, size_bytes,
            content_type, uploaded_by
         )
         VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '', $5)
         RETURNING ${FILE_FIELDS}`,
        [
          id,
          input.projectId,
          item.folderPath,
          item.name,
          uploaderIdOf(input.actor),
        ],
      )
      const file = result.rows[0]!

      // Событие на папку, а не на пачку: применять их клиент будет поштучно,
      // как и у пакетного переименования.
      const seq = await journal(client, {
        projectId: input.projectId,
        key,
        op: "put",
        size: 0,
        eventId: input.eventId ? `${input.eventId}:mkdir:${index}` : null,
        actor: input.actor,
        payload: {
          fileId: file.id,
          name: item.name,
          folderPath: item.folderPath,
          isFolder: true,
        },
      })
      await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
        file.id,
        seq,
      ])

      created.push(file)
    }

    return created
  })
}

/**
 * Ensure every segment of `folderPath` exists (a/b/c). Returns the deepest folder row.
 * Creates missing parents; returns the last existing/created folder, or null for root.
 */
export async function writeEnsureFolderPath(input: {
  storageOwnerId: string
  projectId: string
  folderPath: string
  eventId?: string
  actor?: StorageActor | null
}): Promise<{ folderIds: string[]; folderPath: string }> {
  const cleaned = input.folderPath.replace(/^\/+|\/+$/g, "")
  if (!cleaned) return { folderIds: [], folderPath: "" }

  const segments = cleaned.split("/").filter(Boolean)
  const folderIds: string[] = []
  let parent = ""

  for (let i = 0; i < segments.length; i++) {
    const name = validateLogicalName(segments[i]!)
    const existing = await withTransaction(async (client) => {
      const found = await client.query<ProjectFileRecord>(
        `SELECT ${FILE_FIELDS}
           FROM project_files
          WHERE project_id = $1
            AND lower(folder_path) = lower($2)
            AND lower(name) = lower($3)
            AND is_folder = TRUE
            AND deleted_at IS NULL
          LIMIT 1`,
        [input.projectId, parent, name],
      )
      return found.rows[0] ?? null
    })

    if (existing) {
      folderIds.push(existing.id)
      parent = parent ? `${parent}/${existing.name}` : existing.name
      continue
    }

    const created = await writeFolderCreate({
      storageOwnerId: input.storageOwnerId,
      projectId: input.projectId,
      folderPath: parent,
      name,
      eventId: input.eventId
        ? `${input.eventId}:mkdir:${i}`
        : undefined,
      actor: input.actor,
    })
    folderIds.push(created.id)
    parent = parent ? `${parent}/${created.name}` : created.name
  }

  return { folderIds, folderPath: parent }
}

export async function writeFilePut(input: {
  projectId: string
  folderPath: string
  name: string
  s3Key: string
  sizeBytes: number
  contentType: string
  etag?: string | null
  contentHash?: string | null
  originMtime?: number | null
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord> {
  const name = validateLogicalName(input.name)
  const folderPath = input.folderPath.replace(/^\/+|\/+$/g, "")
  assertLogicalPath(folderPath, name)

  return withTransaction(async (client) => {
    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath,
      name,
    })
    const id = randomUUID()
    const result = await client.query<ProjectFileRecord>(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key,
          size_bytes, content_type, etag, content_hash, origin_mtime, uploaded_by
       )
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${FILE_FIELDS}`,
      [
        id,
        input.projectId,
        folderPath,
        name,
        input.s3Key,
        input.sizeBytes,
        input.contentType,
        input.etag ?? null,
        input.contentHash ?? null,
        input.originMtime ?? null,
        uploaderIdOf(input.actor),
      ],
    )
    const file = result.rows[0]!

    const seq = await journal(client, {
      projectId: input.projectId,
      key: input.s3Key,
      op: "put",
      size: input.sizeBytes,
      etag: input.etag ?? null,
      contentHash: input.contentHash ?? null,
      eventId: input.eventId ?? null,
      actor: input.actor,
      payload: {
        fileId: file.id,
        name,
        folderPath,
        isFolder: false,
        contentType: input.contentType,
      },
    })
    await touchFileRow(client, file.id, seq, {
      etag: input.etag,
      contentHash: input.contentHash,
      originMtime: input.originMtime,
    })
    return file
  })
}

export async function writeNotifyUpload(input: {
  /** `projects.storage_owner_id` — для ключа строк-папок по пути заливки. */
  storageOwnerId: string
  projectId: string
  s3Key: string
  folderPath: string
  fileName: string
  sizeBytes?: number
  contentType?: string
  /** Unix seconds; preferred over R2 object metadata when provided. */
  originMtime?: number | null
  /** Content hash (e.g. sha256 hex); preferred over R2 metadata when provided. */
  contentHash?: string | null
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord> {
  // Три канонических сайдкара сайт читает по фиксированному ключу, а presign
  // минтит `{uuid}-{имя}`. Заливка их обычным путём давала второй объект с тем
  // же логическим именем: сайт читал свой, программа — свой, и «какая версия
  // новее» тут не помогало, потому что это два разных объекта. Единственный
  // законный канал — PUT /api/storage/v1/sidecars.
  if (
    isCanonicalSidecar(input.folderPath, input.fileName) &&
    !input.s3Key.endsWith(`/${OPTIONS_FOLDER_NAME}/${input.fileName}`)
  ) {
    await deleteOrphanUpload(input.s3Key)
    throw new StorageWriteError(
      `"${input.fileName}" is written through PUT /api/storage/v1/sidecars, not /notify.`,
      409,
    )
  }

  const head = await headObject(input.s3Key)
  if (!head) {
    throw new StorageWriteError("Object not found in storage.")
  }

  // Папки по пути заливки должны существовать строками, иначе файл попадает в
  // каталог, но пропадает из дерева: и buildTree в кабинете, и «Конвейер»
  // спускаются только по существующим строкам-папкам. Именно так пропадали IN и
  // OUT — клиент заливал в них файлы, ни разу не позвав /mkdir.
  //
  // Отказ здесь не должен ронять заливку: байты уже в бакете, а строка файла
  // полезна и сама по себе. Единственная причина отказа — занятое имя (файл с
  // именем папки на том же уровне), и это повод для записи в лог, а не для 409.
  if (input.folderPath.replace(/^\/+|\/+$/g, "")) {
    try {
      await writeEnsureFolderPath({
        storageOwnerId: input.storageOwnerId,
        projectId: input.projectId,
        folderPath: input.folderPath,
        actor: input.actor,
      })
    } catch (error) {
      console.error(
        "[storage] notify: could not ensure folder rows for",
        input.folderPath,
        error,
      )
    }
  }

  const contentHash =
    input.contentHash !== undefined && input.contentHash !== null
      ? input.contentHash
      : head.contentHash
  const originMtime =
    input.originMtime !== undefined && input.originMtime !== null
      ? input.originMtime
      : head.originMtime

  const existing = await withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS} FROM project_files WHERE s3_key = $1`,
      [input.s3Key],
    )
    return found.rows[0] ?? null
  })

  if (existing) {
    return withTransaction(async (client) => {
      const seq = await journal(client, {
        projectId: input.projectId,
        key: input.s3Key,
        op: "put",
        size: head.size,
        etag: head.etag,
        contentHash,
        eventId: input.eventId ?? null,
        actor: input.actor,
        payload: {
          fileId: existing.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: false,
        },
      })
      await touchFileRow(client, existing.id, seq, {
        etag: head.etag,
        contentHash,
        originMtime,
        sizeBytes: head.size,
        // Перезаписал другой человек — заливщик теперь он: задачу создаёт
        // именно это событие. Машина парка прежнего не трогает.
        uploadedBy: uploaderIdOf(input.actor),
      })
      const updated = await client.query<ProjectFileRecord>(
        `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1`,
        [existing.id],
      )
      return updated.rows[0]!
    })
  }

  try {
    return await writeFilePut({
      projectId: input.projectId,
      folderPath: input.folderPath,
      name: input.fileName,
      s3Key: input.s3Key,
      sizeBytes: input.sizeBytes ?? head.size,
      contentType: input.contentType ?? "application/octet-stream",
      etag: head.etag,
      contentHash,
      originMtime,
      eventId: input.eventId,
      actor: input.actor,
    })
  } catch (error) {
    // Байты уже в бакете, а строки не будет. Ссылок на этот ключ нет (выше
    // искали по s3_key и не нашли), поэтому при отказе, который повтором не
    // лечится, объект — заведомо сирота, и его надо убрать.
    //
    // Раньше здесь стоял только `isNameConflict`, то есть 409. Недопустимое имя
    // отвергает `validateLogicalName` с кодом 400, до этой ветки дело не доходило,
    // и каждая попытка залить файл с двоеточием в имени оставляла в бакете ещё
    // один мёртвый объект — docs/STORAGE_CLIENT_REQUESTS.md §14.3.
    if (isDeterministicRejection(error)) await deleteOrphanUpload(input.s3Key)
    throw error
  }
}

export async function writeFileDelete(input: {
  storageOwnerId: string
  projectId: string
  fileId: string
  deletedBy?: string | null
  eventId?: string
  actor?: StorageActor | null
}): Promise<{ fileIds: string[]; deletedS3Keys: string[] }> {
  return withTransaction(async (client) => {
    const found = await client.query<{
      id: string
      projectId: string
      folderPath: string
      name: string
      isFolder: boolean
      s3Key: string | null
    }>(
      `SELECT id,
              project_id AS "projectId",
              folder_path AS "folderPath",
              name,
              is_folder AS "isFolder",
              s3_key AS "s3Key"
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return { fileIds: [], deletedS3Keys: [] }

    assertSidecarPlaceIsStable(existing, "delete")

    const prefix = existing.isFolder
      ? folderPrefix(existing.folderPath, existing.name)
      : null

    const targets = await client.query<{
      id: string
      s3Key: string | null
      name: string
      folderPath: string
      isFolder: boolean
    }>(
      prefix == null
        ? `SELECT id, s3_key AS "s3Key", name, folder_path AS "folderPath",
                  is_folder AS "isFolder"
             FROM project_files
            WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT id, s3_key AS "s3Key", name, folder_path AS "folderPath",
                  is_folder AS "isFolder"
             FROM project_files
            WHERE project_id = $2
              AND deleted_at IS NULL
              AND (id = $1 OR folder_path = $3 OR folder_path LIKE $3 || '/%')`,
      prefix == null
        ? [existing.id]
        : [existing.id, input.projectId, prefix],
    )

    const deletedAt = new Date()
    const fileIds: string[] = []

    for (const row of targets.rows) {
      const key =
        row.s3Key ??
        logicalKeyForFile({
          storageOwnerId: input.storageOwnerId,
          projectId: input.projectId,
          folderPath: row.folderPath,
          name: row.name,
        })
      const seq = await journal(client, {
        projectId: input.projectId,
        key,
        op: "delete",
        eventId: input.eventId
          ? row.id === existing.id
            ? input.eventId
            : `${input.eventId}:${row.id}`
          : null,
        actor: input.actor ?? (input.deletedBy ? { userId: input.deletedBy } : null),
        payload: {
          fileId: row.id,
          name: row.name,
          folderPath: row.folderPath,
          isFolder: row.isFolder,
        },
      })
      await client.query(
        `UPDATE project_files
            SET deleted_at = $3, deleted_by = $4, last_seq = $2, updated_at = NOW()
          WHERE id = $1`,
        [row.id, seq, deletedAt, input.deletedBy ?? null],
      )
      fileIds.push(row.id)
    }

    return { fileIds, deletedS3Keys: [] }
  })
}

/**
 * Переименование / перемещение.
 *
 * `actor` здесь особенно важен: снятие `-` с имени папки приезжает именно сюда, а
 * для конвейера это событие готовности — «обрабатывай». Кто его совершил, тот и
 * становится `description.contact` витка (lib/pipeline/scan.ts#resolveSourceActor).
 */
export async function writeRename(input: {
  storageOwnerId: string
  projectId: string
  fileId: string
  name?: string
  folderPath?: string
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord | null> {
  return withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS}
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return null

    const newName = input.name !== undefined
      ? validateLogicalName(input.name)
      : existing.name
    const newFolder = (input.folderPath ?? existing.folderPath).replace(
      /^\/+|\/+$/g,
      "",
    )
    assertLogicalPath(newFolder, newName)

    if (newName === existing.name && newFolder === existing.folderPath) {
      return existing
    }

    assertSidecarPlaceIsStable(existing, "rename")

    // Занять каноническое имя чужим файлом — то же расхождение с другой стороны:
    // в каталоге options.json есть, а сайт по своему ключу не находит ничего.
    if (isCanonicalSidecar(newFolder, newName)) {
      throw new StorageWriteError(
        `"${newName}" in "${OPTIONS_FOLDER_NAME}" is reserved for project automation.`,
        403,
      )
    }

    if (existing.isFolder) {
      const oldPrefix = folderPrefix(existing.folderPath, existing.name)
      if (isMoveIntoSelf(oldPrefix, newFolder)) {
        throw new StorageWriteError(
          "Cannot move a folder into itself or a descendant.",
          409,
        )
      }
    }

    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath: newFolder,
      name: newName,
      excludeId: existing.id,
    })

    if (existing.isFolder) {
      const oldPrefix = folderPrefix(existing.folderPath, existing.name)
      const newPrefix = folderPrefix(newFolder, newName)

      await client.query(
        `UPDATE project_files
            SET folder_path = CASE
                  WHEN folder_path = $2 THEN $3
                  ELSE $3 || substr(folder_path, length($2) + 1)
                END,
                updated_at = NOW()
          WHERE project_id = $1
            AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
        [input.projectId, oldPrefix, newPrefix],
      )
    }

    const result = await client.query<ProjectFileRecord>(
      `UPDATE project_files
          SET name = $3,
              folder_path = $4,
              updated_at = NOW()
        WHERE id = $1 AND project_id = $2
        RETURNING ${FILE_FIELDS}`,
      [input.fileId, input.projectId, newName, newFolder],
    )
    const file = result.rows[0]
    if (!file) return null

    const key =
      existing.s3Key ??
      logicalKeyForFile({
        storageOwnerId: input.storageOwnerId,
        projectId: input.projectId,
        folderPath: existing.folderPath,
        name: existing.name,
      })

    const seq = await journal(client, {
      projectId: input.projectId,
      key,
      op: "move",
      size: file.isFolder ? 0 : file.sizeBytes,
      eventId: input.eventId ?? null,
      actor: input.actor,
      payload: {
        fileId: file.id,
        isFolder: existing.isFolder,
        name: file.name,
        folderPath: file.folderPath,
        from: { folderPath: existing.folderPath, name: existing.name },
        to: { folderPath: file.folderPath, name: file.name },
      },
    })
    await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
      file.id,
      seq,
    ])

    return file
  })
}

/**
 * Переименование пачкой — одной транзакцией и без промежуточных состояний.
 *
 * Нужно перенумерации слотов в папке элемента: номер там это позиция, а не
 * идентификатор, поэтому удаление второго из трёх и перетаскивание мышью
 * двигают сразу несколько файлов (docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §6.1).
 * Поштучный `writeRename` для этого не годится по двум причинам, и вторая
 * важнее первой:
 *
 *  1. пачка из десяти файлов — десять запросов и десять транзакций;
 *  2. ПЕРЕСТАНОВКА ДВУХ СОСЕДЕЙ НЕВЫПОЛНИМА поштучно. `01` ↔ `02` — это цикл:
 *     любое первое переименование упирается в занятое имя, и обмен пришлось бы
 *     делать через видимое человеку третье имя.
 *
 * Отсюда две фазы: сначала все строки уезжают на временные имена, потом встают
 * на окончательные. Уникальный индекс каталога проверяется на каждом операторе,
 * и обойти его внутри транзакции иначе нечем. Временные имена не видит никто:
 * транзакция либо доезжает целиком, либо откатывается.
 *
 * В журнал уходит РОВНО ОДНО `move`-событие на файл — то же, что при обычном
 * переименовании. Клиент не должен видеть, что внутри была пересадка.
 */
export async function writeRenameBatch(input: {
  storageOwnerId: string
  projectId: string
  items: Array<{ fileId: string; name?: string; folderPath?: string }>
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord[]> {
  if (input.items.length === 0) return []

  const seenIds = new Set<string>()
  for (const item of input.items) {
    if (seenIds.has(item.fileId)) {
      throw new StorageWriteError("The same file listed twice in the batch.", 400)
    }
    seenIds.add(item.fileId)
  }

  return withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS}
         FROM project_files
        WHERE project_id = $1 AND deleted_at IS NULL AND id = ANY($2::text[])`,
      [input.projectId, input.items.map((item) => item.fileId)],
    )
    const byId = new Map(found.rows.map((row) => [row.id, row]))

    type Plan = {
      existing: ProjectFileRecord
      name: string
      folderPath: string
      /** Путь поддерева до и после — только у папок. */
      oldPrefix: string | null
      newPrefix: string | null
      tempName: string
    }

    const plans: Plan[] = []
    const targets = new Set<string>()

    for (const item of input.items) {
      const existing = byId.get(item.fileId)
      if (!existing) {
        throw new StorageWriteError(`File ${item.fileId} not found.`, 404)
      }

      const name =
        item.name !== undefined ? validateLogicalName(item.name) : existing.name
      const folderPath = (item.folderPath ?? existing.folderPath).replace(
        /^\/+|\/+$/g,
        "",
      )
      assertLogicalPath(folderPath, name)
      assertSidecarPlaceIsStable(existing, "rename")
      if (isCanonicalSidecar(folderPath, name)) {
        throw new StorageWriteError(
          `"${name}" in "${OPTIONS_FOLDER_NAME}" is reserved for project automation.`,
          403,
        )
      }

      // Цель, занятая дважды внутри самой пачки, — ошибка вызывающего, и поймать
      // её надо здесь: до базы такая пачка дойдёт как отказ уникального индекса
      // уже во второй фазе, когда сказать, кто с кем столкнулся, будет нечем.
      const key = `${folderPath.toLowerCase()} ${name.toLowerCase()}`
      if (targets.has(key)) {
        throw new StorageWriteError(
          `Two files in the batch would take the name "${name}".`,
          409,
        )
      }
      targets.add(key)

      const oldPrefix = existing.isFolder
        ? folderPrefix(existing.folderPath, existing.name)
        : null
      const newPrefix = existing.isFolder ? folderPrefix(folderPath, name) : null
      if (oldPrefix && isMoveIntoSelf(oldPrefix, folderPath)) {
        throw new StorageWriteError(
          "Cannot move a folder into itself or a descendant.",
          409,
        )
      }

      plans.push({
        existing,
        name,
        folderPath,
        oldPrefix,
        newPrefix,
        tempName: `.rename-${randomUUID()}`,
      })
    }

    // Занято ли место кем-то ВНЕ пачки. Участники друг друга не смущают: они
    // как раз и разъезжаются по новым местам этой же транзакцией.
    for (const plan of plans) {
      const taken = await client.query<{ id: string }>(
        `SELECT id
           FROM project_files
          WHERE project_id = $1
            AND lower(folder_path) = lower($2)
            AND lower(name) = lower($3)
            AND deleted_at IS NULL
            -- Приведение к text[], а не к uuid[]: колонка id объявлена TEXT, и
            -- Postgres отказывается сравнивать text с uuid (operator does not
            -- exist). Прежний каст делал пакетное переименование нерабочим
            -- всегда, то есть любую перестановку слотов в папке элемента.
            AND NOT (id = ANY($4::text[]))
          LIMIT 1`,
        [input.projectId, plan.folderPath, plan.name, [...seenIds]],
      )
      if (taken.rows.length > 0) {
        throw new StorageWriteError(
          `A file or folder named "${plan.name}" already exists.`,
          409,
        )
      }
    }

    // Фаза 1: все на временные имена. Поддерево папки уезжает вместе с ней,
    // иначе на второй фазе пути детей столкнулись бы ровно так же, как имена.
    for (const plan of plans) {
      await client.query(
        `UPDATE project_files SET name = $2, updated_at = NOW() WHERE id = $1`,
        [plan.existing.id, plan.tempName],
      )
      if (plan.oldPrefix) {
        const tempPrefix = folderPrefix(plan.existing.folderPath, plan.tempName)
        await client.query(
          `UPDATE project_files
              SET folder_path = CASE
                    WHEN folder_path = $2 THEN $3
                    ELSE $3 || substr(folder_path, length($2) + 1)
                  END,
                  updated_at = NOW()
            WHERE project_id = $1
              AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
          [input.projectId, plan.oldPrefix, tempPrefix],
        )
        plan.oldPrefix = tempPrefix
      }
    }

    // Фаза 2: окончательные имена и один `move` на файл.
    const out: ProjectFileRecord[] = []
    for (const plan of plans) {
      if (plan.oldPrefix && plan.newPrefix) {
        await client.query(
          `UPDATE project_files
              SET folder_path = CASE
                    WHEN folder_path = $2 THEN $3
                    ELSE $3 || substr(folder_path, length($2) + 1)
                  END,
                  updated_at = NOW()
            WHERE project_id = $1
              AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
          [input.projectId, plan.oldPrefix, plan.newPrefix],
        )
      }

      const updated = await client.query<ProjectFileRecord>(
        `UPDATE project_files
            SET name = $3, folder_path = $4, updated_at = NOW()
          WHERE id = $1 AND project_id = $2
          RETURNING ${FILE_FIELDS}`,
        [plan.existing.id, input.projectId, plan.name, plan.folderPath],
      )
      const file = updated.rows[0]
      if (!file) {
        throw new StorageWriteError(`File ${plan.existing.id} not found.`, 404)
      }

      const key =
        plan.existing.s3Key ??
        logicalKeyForFile({
          storageOwnerId: input.storageOwnerId,
          projectId: input.projectId,
          folderPath: plan.existing.folderPath,
          name: plan.existing.name,
        })

      const seq = await journal(client, {
        projectId: input.projectId,
        key,
        op: "move",
        size: file.isFolder ? 0 : file.sizeBytes,
        // Событие на файл, а не на пачку: применять их клиент будет поштучно.
        eventId: input.eventId ? `${input.eventId}:${file.id}` : null,
        actor: input.actor,
        payload: {
          fileId: file.id,
          isFolder: plan.existing.isFolder,
          name: file.name,
          folderPath: file.folderPath,
          from: {
            folderPath: plan.existing.folderPath,
            name: plan.existing.name,
          },
          to: { folderPath: file.folderPath, name: file.name },
        },
      })
      await client.query(
        `UPDATE project_files SET last_seq = $2 WHERE id = $1`,
        [file.id, seq],
      )
      out.push(file)
    }

    return out
  })
}

/**
 * Приводит каталог в соответствие с только что записанным сайдкаром.
 *
 * Сайдкары попадают в бакет по фиксированному ключу, минуя presign/notify,
 * поэтому строку в `project_files` им никто не создавал. Без строки файла не
 * видно ни в дереве кабинета, ни в `/tree` у клиента, а событие в журнале
 * приходит без `fileId` — то есть применить его к своему индексу клиент не может
 * и вынужден перечитывать дерево целиком.
 *
 * Зовётся ПОСЛЕ каждой успешной записи сайдкара. Идемпотентна: строка ищется по
 * логическому имени, а не по ключу, поэтому файл, попавший в каталог когда-то с
 * uuid-ключом, здесь же переводится на канонический и сохраняет свой `file_id`.
 */
export async function writeSidecarSync(input: {
  /** `projects.storage_owner_id` — для ключа папки в хранилище. */
  storageOwnerId: string
  projectId: string
  /** Канонический ключ объекта. */
  key: string
  /** Логическое имя: folderState.json, options.json, description.md. */
  name: string
  folderPath?: string
  contentType?: string
  sizeBytes?: number
  etag?: string | null
  contentHash?: string | null
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord | null> {
  const folderPath = input.folderPath ?? OPTIONS_FOLDER_NAME
  const contentType = input.contentType ?? contentTypeForSidecar(input.name)

  // Размер и версию берём у объекта, если их не передали: у части путей записи
  // (тумблер, правка options.json) под рукой только результат разбора JSON.
  const head =
    input.etag !== undefined && input.sizeBytes !== undefined
      ? null
      : await headObject(input.key)
  const sizeBytes = input.sizeBytes ?? head?.size ?? 0
  const etag = input.etag ?? head?.etag ?? null
  const contentHash = input.contentHash ?? head?.contentHash ?? null

  // Папка нужна раньше файла: buildTree спускается только в существующие
  // строки-папки, поэтому без неё сайдкар лежал бы в каталоге невидимкой.
  await writeEnsureFolderPath({
    storageOwnerId: input.storageOwnerId,
    projectId: input.projectId,
    folderPath,
    actor: input.actor,
  })

  const existing = await withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS}
         FROM project_files
        WHERE project_id = $1
          AND lower(folder_path) = lower($2)
          AND lower(name) = lower($3)
        ORDER BY (deleted_at IS NULL) DESC, (s3_key = $4) DESC
        LIMIT 1`,
      [input.projectId, folderPath, input.name, input.key],
    )
    return found.rows[0] ?? null
  })

  if (existing) {
    return withTransaction(async (client) => {
      const seq = await journal(client, {
        projectId: input.projectId,
        key: input.key,
        op: "put",
        size: sizeBytes,
        etag,
        contentHash,
        eventId: input.eventId ?? null,
        actor: input.actor,
        payload: {
          fileId: existing.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: false,
          contentType,
        },
      })
      await touchFileRow(client, existing.id, seq, {
        etag,
        contentHash,
        sizeBytes,
        s3Key: input.key,
        uploadedBy: uploaderIdOf(input.actor),
      })
      const updated = await client.query<ProjectFileRecord>(
        `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1`,
        [existing.id],
      )
      return updated.rows[0] ?? null
    })
  }

  return writeFilePut({
    projectId: input.projectId,
    folderPath,
    name: input.name,
    s3Key: input.key,
    sizeBytes,
    contentType,
    etag,
    contentHash,
    eventId: input.eventId,
    actor: input.actor,
  })
}

export async function writeSidecarPut(input: {
  /** `projects.storage_owner_id` — чтобы завести строку каталога и папку options. */
  storageOwnerId: string
  projectId: string
  key: string
  body: string
  contentType?: string
  ifMatch?: string | null
  eventId?: string
  actor?: StorageActor | null
}): Promise<{ etag: string | null; file: ProjectFileRecord | null }> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType ?? "application/json",
    ...(input.ifMatch ? { IfMatch: input.ifMatch } : {}),
  })

  let response
  try {
    response = await getS3Client().send(command)
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
    // 412, а не 409: клиенту нужно отличать «версия устарела, перечитай и
    // реши, что делать» от «имя занято». На 409 он ответил бы переименованием.
    if (status === 412) {
      throw new StorageWriteError("Precondition failed (ETag mismatch).", 412)
    }
    throw error
  }

  const etag = response.ETag?.replace(/"/g, "") ?? null
  // Журналирует и заводит строку writeSidecarSync — отдельной записи в журнал
  // здесь нет намеренно, иначе событие ушло бы дважды.
  const file = await writeSidecarSync({
    storageOwnerId: input.storageOwnerId,
    projectId: input.projectId,
    key: input.key,
    name: input.key.slice(input.key.lastIndexOf("/") + 1),
    contentType: input.contentType,
    sizeBytes: Buffer.byteLength(input.body, "utf8"),
    etag,
    eventId: input.eventId,
    actor: input.actor,
  })
  return { etag, file }
}

export async function writeR2PutFromBuffer(input: {
  projectId: string
  key: string
  body: Buffer
  contentType: string
  fileName: string
  folderPath: string
  eventId?: string
  actor?: StorageActor | null
}): Promise<ProjectFileRecord> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const response = await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  )

  const etag = response.ETag?.replace(/"/g, "") ?? null
  try {
    return await writeFilePut({
      projectId: input.projectId,
      folderPath: input.folderPath,
      name: input.fileName,
      s3Key: input.key,
      sizeBytes: input.body.length,
      contentType: input.contentType,
      etag,
      eventId: input.eventId,
      actor: input.actor,
    })
  } catch (error) {
    // Байты записали мы сами строкой выше, строки не будет — значит объект здесь
    // сирота, как и на пути presign → PUT → notify.
    if (isNameConflict(error)) await deleteOrphanUpload(input.key)
    throw error
  }
}

type ReindexCandidate = {
  key: string
  folderPath: string
  name: string
  head: ObjectHead
}

/** Ключ строки в каталоге: путь плюс имя без учёта регистра — как в индексе. */
function logicalRowId(folderPath: string, name: string): string {
  return `${folderPath.toLowerCase()}\u0000${name.toLowerCase()}`
}

/**
 * Кто из двойников представляет логическое имя.
 *
 * Двойники берутся оттуда, что presign минтит `{uuid}-{имя}`: один и тот же файл
 * мог попасть в бакет и под каноническим ключом, и под физическим. В каталоге же
 * место одно — `project_files_unique_name_idx` держит (project_id, folder_path,
 * name). Побеждает канонический ключ, при прочих равных — свежий по дате.
 */
function preferCandidate(
  a: ReindexCandidate,
  b: ReindexCandidate,
): ReindexCandidate {
  const aCanonical = a.key.endsWith(`/${a.name}`)
  const bCanonical = b.key.endsWith(`/${b.name}`)
  if (aCanonical !== bCanonical) return aCanonical ? a : b
  const aTime = a.head.originMtime ?? 0
  const bTime = b.head.originMtime ?? 0
  if (aTime !== bTime) return aTime > bTime ? a : b
  return a.key <= b.key ? a : b
}

export async function reindexProject(
  storageOwnerId: string,
  projectId: string,
): Promise<{
  scanned: number
  inserted: number
  updated: number
  removed: number
  shadowed: number
}> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const prefix = projectPrefix(storageOwnerId, projectId)
  const client = getS3Client()
  const bucket = getS3Bucket()
  const remoteKeys = new Map<string, ObjectHead>()

  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue
      // `options/` больше НЕ исключается: служебная папка индексируется как
      // любая другая, поэтому её содержимое получает строки и приезжает в /tree.
      // Исключены только два служебных места самого бэкенда: снимки каталога и
      // манифест проекта — их пишет сайт, и в дереве файлов им делать нечего.
      if (obj.Key.includes(`/${CATALOG_FOLDER_NAME}/`)) continue
      if (obj.Key.endsWith("project-meta.json")) continue
      remoteKeys.set(obj.Key, {
        etag: obj.ETag?.replace(/"/g, "") ?? null,
        size: Number(obj.Size ?? 0),
        contentHash: null,
        originMtime: obj.LastModified
          ? Math.floor(obj.LastModified.getTime() / 1000)
          : null,
      })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  // Сводим объекты к одному на логическое имя. Без этого шага реиндекс проекта,
  // где под options лежат канонический сайдкар и его uuid-двойник, упал бы на
  // уникальном индексе и отменил бы всю транзакцию целиком.
  const byLogical = new Map<string, ReindexCandidate>()
  let shadowed = 0
  for (const [key, head] of remoteKeys) {
    const physicalName = key.slice(key.lastIndexOf("/") + 1)
    const candidate: ReindexCandidate = {
      key,
      head,
      name: logicalNameFromObjectKey(physicalName),
      folderPath: folderPathFromKey(storageOwnerId, projectId, key, physicalName),
    }
    const id = logicalRowId(candidate.folderPath, candidate.name)
    const previous = byLogical.get(id)
    if (!previous) {
      byLogical.set(id, candidate)
      continue
    }
    const winner = preferCandidate(previous, candidate)
    byLogical.set(id, winner)
    shadowed++
    console.warn(
      "[storage] reindex: duplicate logical name under",
      `${candidate.folderPath}/${candidate.name};`,
      "keeping",
      winner.key,
    )
  }
  const candidates = [...byLogical.values()]

  // Строки-папок заводим до основной транзакции — вложенная транзакция брала бы
  // второе соединение из пула. Без них buildTree не спустится внутрь: он идёт
  // только по существующим строкам-папкам, и файл в options/__stat остался бы в
  // каталоге, но не показался бы в дереве.
  const folderPaths = [
    ...new Set(candidates.map((c) => c.folderPath).filter(Boolean)),
  ].sort()
  for (const folderPath of folderPaths) {
    try {
      await writeEnsureFolderPath({ storageOwnerId, projectId, folderPath })
    } catch (error) {
      // Имя занято файлом или недопустимо: пропускаем только эту папку, а не
      // весь реиндекс — остальное проиндексировать всё равно нужно.
      console.warn("[storage] reindex: cannot ensure folder", folderPath, error)
    }
  }

  let inserted = 0
  let updated = 0
  let removed = 0

  await withTransaction(async (db) => {
    const local = await db.query<{
      id: string
      s3Key: string
      etag: string | null
      name: string
      folderPath: string
      deletedAt: Date | null
    }>(
      `SELECT id, s3_key AS "s3Key", etag, name,
              folder_path AS "folderPath", deleted_at AS "deletedAt"
         FROM project_files
        WHERE project_id = $1 AND s3_key IS NOT NULL AND is_folder = FALSE`,
      [projectId],
    )
    const localByKey = new Map(local.rows.map((r) => [r.s3Key, r]))
    // Только живые строки: строку из корзины оживлять реиндексом нельзя, иначе
    // удалённый человеком файл вернулся бы сам.
    const localByLogical = new Map(
      local.rows
        .filter((r) => r.deletedAt == null)
        .map((r) => [logicalRowId(r.folderPath, r.name), r]),
    )

    for (const { key, folderPath, name, head } of candidates) {
      // Сначала по ключу, потом по логическому имени: файл, попавший в каталог с
      // uuid-ключом, здесь переводится на канонический и сохраняет file_id —
      // для клиента это тот же файл, перекачивать его не нужно.
      const row =
        localByKey.get(key) ?? localByLogical.get(logicalRowId(folderPath, name))

      if (!row) {
        const fileId = randomUUID()
        const insert = await db.query<{ id: string }>(
          `INSERT INTO project_files (
              id, project_id, folder_path, name, is_folder, s3_key,
              size_bytes, content_type, etag, origin_mtime
           )
           VALUES ($1, $2, $3, $4, FALSE, $5, $6, '', $7, $8)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            fileId,
            projectId,
            folderPath,
            name,
            key,
            head.size,
            head.etag,
            head.originMtime,
          ],
        )
        if (insert.rows.length === 0) {
          // Место занято строкой, которой нет ни в одной из карт (гонка с
          // параллельной заливкой). Молча пропускаем: объект на месте, а имя
          // уже за кем-то — навязывать вторую строку нельзя.
          shadowed++
          continue
        }
        await journal(db, {
          projectId,
          key,
          op: "put",
          size: head.size,
          etag: head.etag,
          eventId: `reindex:put:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
          payload: { fileId, name, folderPath, isFolder: false },
        })
        inserted++
        continue
      }

      localByKey.delete(row.s3Key)
      localByLogical.delete(logicalRowId(row.folderPath, row.name))

      const keyChanged = row.s3Key !== key
      if (!keyChanged && row.etag === head.etag) continue

      const seq = await journal(db, {
        projectId,
        key,
        op: "put",
        size: head.size,
        etag: head.etag,
        eventId: `reindex:sync:${createHash("sha256")
          .update(`${key}:${head.etag ?? ""}`)
          .digest("hex")
          .slice(0, 16)}`,
        payload: {
          fileId: row.id,
          name: row.name,
          folderPath,
          isFolder: false,
        },
      })
      await db.query(
        `UPDATE project_files
            SET s3_key = $6,
                etag = $3,
                size_bytes = $4,
                origin_mtime = $5,
                last_seq = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, seq, head.etag, head.size, head.originMtime, key],
      )
      updated++
    }

    for (const [, row] of localByKey) {
      // Снимки каталога живут вне дерева: строк у них нет и удалять нечего.
      if (isCatalogKey(row.s3Key, storageOwnerId, projectId)) continue
      // Строка уже в корзине — её объект стёрт вместе с ретеншеном, повторное
      // событие удаления клиенту ни о чём не сообщит.
      if (row.deletedAt != null) continue
      await journal(db, {
        projectId,
        key: row.s3Key,
        op: "delete",
        eventId: `reindex:del:${row.id}`,
        payload: { fileId: row.id },
      })
      await db.query(`DELETE FROM project_files WHERE id = $1`, [row.id])
      removed++
    }
  })

  return { scanned: remoteKeys.size, inserted, updated, removed, shadowed }
}

/** Append a journal row after an external R2 write (e.g. sidecar helpers). */
export async function journalStorageEvent(input: {
  projectId: string
  key: string
  op: StorageChangeOp
  size?: number | null
  etag?: string | null
  contentHash?: string | null
  eventId?: string | null
  actor?: StorageActor | null
  payload?: StorageChangePayload
}): Promise<number> {
  return withTransaction(async (client) => journal(client, input))
}

export function hashMachineToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function generateMachineToken(): string {
  return `mch_${randomBytes(32).toString("base64url")}`
}

export { parseProjectIdFromKey, projectPrefix }
