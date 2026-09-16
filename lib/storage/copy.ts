import { CopyObjectCommand } from "@aws-sdk/client-s3"
import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { appendStorageChange, nowUnixSec } from "@/lib/storage/changes"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  allocateUniqueName,
  folderPrefix,
  validateLogicalName,
} from "@/lib/storage/file-names"
import { logicalKeyForFile } from "@/lib/storage/keys"
import { writeEnsureFolderPath } from "@/lib/storage/write-path"
import type { StorageActor } from "@/lib/storage/write-path"

const FILE_FIELDS = `
  id,
  project_id AS "projectId",
  folder_path AS "folderPath",
  name,
  is_folder AS "isFolder",
  s3_key AS "s3Key",
  size_bytes::float8 AS "sizeBytes",
  content_type AS "contentType",
  created_at AS "createdAt"
`

type SourceRow = ProjectFileRecord & {
  etag: string | null
  contentHash: string | null
  originMtime: number | null
  /**
   * Кто залил оригинал — перенос между проектами оставляет его заливщиком.
   * Необязательное: строки, собранные не выборкой отсюда (публикация), его
   * не несут, а переносом и не пользуются.
   */
  sourceUploadedBy?: string | null
}

async function loadSourceFiles(
  projectId: string,
  fileIds: string[],
): Promise<SourceRow[]> {
  if (fileIds.length === 0) return []
  const result = await query<SourceRow>(
    `SELECT ${FILE_FIELDS},
            etag,
            content_hash AS "contentHash",
            origin_mtime AS "originMtime",
            uploaded_by AS "sourceUploadedBy"
       FROM project_files
      WHERE project_id = $1
        AND id = ANY($2::text[])
        AND deleted_at IS NULL`,
    [projectId, fileIds],
  )
  return result.rows
}

async function loadFolderSubtree(
  projectId: string,
  folder: SourceRow,
): Promise<SourceRow[]> {
  const prefix = folderPrefix(folder.folderPath, folder.name)
  const result = await query<SourceRow>(
    `SELECT ${FILE_FIELDS},
            etag,
            content_hash AS "contentHash",
            origin_mtime AS "originMtime",
            uploaded_by AS "sourceUploadedBy"
       FROM project_files
      WHERE project_id = $1
        AND deleted_at IS NULL
        AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
      ORDER BY folder_path ASC, is_folder DESC, lower(name) ASC`,
    [projectId, prefix],
  )
  return [folder, ...result.rows]
}

async function copyObjectInR2(sourceKey: string, destKey: string): Promise<void> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.", 503)
  }
  const bucket = getS3Bucket()
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
    }),
  )
}

async function insertCopiedRow(
  client: PoolClient,
  input: {
    destProjectId: string
    destStorageOwnerId: string
    folderPath: string
    name: string
    isFolder: boolean
    s3Key: string | null
    sizeBytes: number
    contentType: string
    etag: string | null
    contentHash: string | null
    originMtime: number | null
    eventId?: string | null
    actor?: StorageActor | null
    /** Заливщик копии. Не задан — берётся из `actor`, см. ниже. */
    uploadedBy?: string | null
  },
): Promise<ProjectFileRecord> {
  const name = validateLogicalName(input.name)
  const uniqueName = await allocateUniqueName(client, {
    projectId: input.destProjectId,
    folderPath: input.folderPath,
    name,
  })
  const id = randomUUID()
  const result = await client.query<ProjectFileRecord>(
    `INSERT INTO project_files (
        id, project_id, folder_path, name, is_folder, s3_key,
        size_bytes, content_type, etag, content_hash, origin_mtime, uploaded_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${FILE_FIELDS}`,
    [
      id,
      input.destProjectId,
      input.folderPath,
      uniqueName,
      input.isFolder,
      input.s3Key,
      input.sizeBytes,
      input.contentType,
      input.etag,
      input.contentHash,
      input.originMtime,
      // Копирование — такое же появление файла в проекте, как загрузка: заливщик
      // тот, кто запустил копирование. Перенос — не появление: файл тот же, и
      // заливщик у него прежний, как при переносе внутри проекта.
      input.uploadedBy !== undefined
        ? input.uploadedBy
        : input.actor?.isUploader === false
          ? null
          : (input.actor?.userId ?? null),
    ],
  )
  const file = result.rows[0]!
  const key =
    file.s3Key ??
    logicalKeyForFile({
      storageOwnerId: input.destStorageOwnerId,
      projectId: input.destProjectId,
      folderPath: file.folderPath,
      name: file.name,
    })
  const seq = await appendStorageChange(client, {
    projectId: input.destProjectId,
    key,
    op: "put",
    size: file.isFolder ? 0 : file.sizeBytes,
    etag: input.etag,
    contentHash: input.contentHash,
    eventTime: nowUnixSec(),
    eventId: input.eventId ?? null,
    actorUserId: input.actor?.userId ?? null,
    payload: {
      fileId: file.id,
      name: file.name,
      folderPath: file.folderPath,
      isFolder: file.isFolder,
      contentType: file.contentType,
    },
  })
  await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
    file.id,
    seq,
  ])
  return file
}

export type CopyPlanItem = {
  source: SourceRow
  /** Relative path under the copied root folder, or "" for top-level items. */
  relativeFolder: string
}

export async function buildCopyPlan(input: {
  projectId: string
  fileIds: string[]
}): Promise<{ items: CopyPlanItem[]; roots: SourceRow[] }> {
  const roots = await loadSourceFiles(input.projectId, input.fileIds)
  if (roots.length === 0) {
    throw new StorageWriteError("No files found to copy.", 404)
  }

  const items: CopyPlanItem[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    if (seen.has(root.id)) continue
    if (root.isFolder) {
      const subtree = await loadFolderSubtree(input.projectId, root)
      const rootPrefix = folderPrefix(root.folderPath, root.name)
      for (const row of subtree) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        let relativeFolder = ""
        if (row.id === root.id) {
          relativeFolder = ""
        } else if (row.folderPath === rootPrefix) {
          relativeFolder = root.name
        } else if (row.folderPath.startsWith(`${rootPrefix}/`)) {
          relativeFolder = `${root.name}/${row.folderPath.slice(rootPrefix.length + 1)}`
        } else {
          relativeFolder = root.name
        }
        items.push({ source: row, relativeFolder })
      }
    } else {
      seen.add(root.id)
      items.push({ source: root, relativeFolder: "" })
    }
  }

  return { items, roots }
}

export async function copySingleFile(input: {
  sourceProjectId: string
  destProjectId: string
  destStorageOwnerId: string
  destFolderPath: string
  source: SourceRow
  eventId?: string | null
  actor?: StorageActor | null
  /** Перенос: заливщиком копии остаётся заливщик оригинала. */
  keepUploader?: boolean
}): Promise<ProjectFileRecord> {
  if (input.source.isFolder) {
    throw new StorageWriteError("Use job path for folder copy.", 400)
  }
  if (!input.source.s3Key) {
    throw new StorageWriteError("Source file has no object key.", 400)
  }

  const destFolder = input.destFolderPath.replace(/^\/+|\/+$/g, "")
  // Папка назначения должна существовать строкой, иначе копия попадёт в каталог
  // и пропадёт из дерева: оно строится спуском по строкам-папкам. Та же причина,
  // по которой заливка заводит папки по пути (writeNotifyUpload).
  if (destFolder) {
    await writeEnsureFolderPath({
      storageOwnerId: input.destStorageOwnerId,
      projectId: input.destProjectId,
      folderPath: destFolder,
      actor: input.actor,
    })
  }
  const destKey = projectUploadObjectKey(
    input.destStorageOwnerId,
    input.destProjectId,
    destFolder,
    `${randomUUID()}-${input.source.name}`,
  )
  await copyObjectInR2(input.source.s3Key, destKey)

  return withTransaction(async (client) =>
    insertCopiedRow(client, {
      destProjectId: input.destProjectId,
      destStorageOwnerId: input.destStorageOwnerId,
      folderPath: destFolder,
      name: input.source.name,
      isFolder: false,
      s3Key: destKey,
      sizeBytes: input.source.sizeBytes,
      contentType: input.source.contentType,
      etag: input.source.etag,
      contentHash: input.source.contentHash,
      originMtime: input.source.originMtime,
      eventId: input.eventId ?? null,
      actor: input.actor,
      uploadedBy: input.keepUploader
        ? (input.source.sourceUploadedBy ?? null)
        : undefined,
    }),
  )
}

/**
 * Copy one planned item. Folder rows create logical folders; files CopyObject.
 * `folderIdMap` maps "relativeFolder/name" of folders already created → dest name.
 */
export async function copyPlanItem(input: {
  destProjectId: string
  destStorageOwnerId: string
  destFolderPath: string
  item: CopyPlanItem
  /** Maps source-relative folder path → actual dest folder path (after unique names). */
  folderPathMap: Map<string, string>
  eventId?: string | null
  actor?: StorageActor | null
  /** Перенос: заливщиком копии остаётся заливщик оригинала. */
  keepUploader?: boolean
}): Promise<ProjectFileRecord> {
  const uploadedBy = input.keepUploader
    ? (input.item.source.sourceUploadedBy ?? null)
    : undefined
  const baseDest = input.destFolderPath.replace(/^\/+|\/+$/g, "")
  const relative = input.item.relativeFolder.replace(/^\/+|\/+$/g, "")

  let destParent = baseDest
  if (relative) {
    const mapped = input.folderPathMap.get(relative)
    if (mapped !== undefined) {
      destParent = mapped
    } else {
      destParent = baseDest ? `${baseDest}/${relative}` : relative
    }
  }

  if (input.item.source.isFolder) {
    const file = await withTransaction(async (client) =>
      insertCopiedRow(client, {
        destProjectId: input.destProjectId,
        destStorageOwnerId: input.destStorageOwnerId,
        folderPath: destParent,
        name: input.item.source.name,
        isFolder: true,
        s3Key: null,
        sizeBytes: 0,
        contentType: "",
        etag: null,
        contentHash: null,
        originMtime: null,
        eventId: input.eventId ?? null,
        actor: input.actor,
        uploadedBy,
      }),
    )
    const sourceRelKey = relative
      ? `${relative}/${input.item.source.name}`
      : input.item.source.name
    const destKey = destParent
      ? `${destParent}/${file.name}`
      : file.name
    input.folderPathMap.set(sourceRelKey, destKey)
    return file
  }

  if (!input.item.source.s3Key) {
    throw new StorageWriteError("Source file has no object key.", 400)
  }

  const destKey = projectUploadObjectKey(
    input.destStorageOwnerId,
    input.destProjectId,
    destParent,
    `${randomUUID()}-${input.item.source.name}`,
  )
  await copyObjectInR2(input.item.source.s3Key, destKey)

  return withTransaction(async (client) =>
    insertCopiedRow(client, {
      destProjectId: input.destProjectId,
      destStorageOwnerId: input.destStorageOwnerId,
      folderPath: destParent,
      name: input.item.source.name,
      isFolder: false,
      s3Key: destKey,
      sizeBytes: input.item.source.sizeBytes,
      contentType: input.item.source.contentType,
      etag: input.item.source.etag,
      contentHash: input.item.source.contentHash,
      originMtime: input.item.source.originMtime,
      eventId: input.eventId ?? null,
      actor: input.actor,
      uploadedBy,
    }),
  )
}

export async function countCopyWork(
  projectId: string,
  fileIds: string[],
): Promise<{ total: number; syncSingle: SourceRow | null }> {
  const { items, roots } = await buildCopyPlan({ projectId, fileIds })
  if (
    roots.length === 1 &&
    !roots[0]!.isFolder &&
    items.length === 1
  ) {
    return { total: 1, syncSingle: roots[0]! }
  }
  return { total: items.length, syncSingle: null }
}
