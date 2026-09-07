import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { appendStorageChange, nowUnixSec } from "@/lib/storage/changes"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  allocateUniqueName,
  folderPrefix,
} from "@/lib/storage/file-names"
import { logicalKeyForFile } from "@/lib/storage/keys"
import { TRASH_RETENTION_DAYS } from "@/lib/storage/trash-policy"

// Реэкспорт, чтобы прежние импорты «срок хранения из trash.ts» продолжали
// работать: само число переехало в trash-policy.ts, откуда его может взять и
// клиентский компонент.
export { TRASH_RETENTION_DAYS }

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

export type TrashItem = {
  fileId: string
  name: string
  folderPath: string
  isFolder: boolean
  deletedAt: string
  sizeBytes: number
}

export async function listTrash(projectId: string): Promise<TrashItem[]> {
  const result = await query<{
    fileId: string
    name: string
    folderPath: string
    isFolder: boolean
    deletedAt: Date
    sizeBytes: number
  }>(
    `SELECT id AS "fileId",
            name,
            folder_path AS "folderPath",
            is_folder AS "isFolder",
            deleted_at AS "deletedAt",
            size_bytes::float8 AS "sizeBytes"
       FROM project_files
      WHERE project_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC, lower(name) ASC`,
    [projectId],
  )
  return result.rows.map((row) => ({
    fileId: row.fileId,
    name: row.name,
    folderPath: row.folderPath,
    isFolder: row.isFolder,
    deletedAt: new Date(row.deletedAt).toISOString(),
    sizeBytes: row.sizeBytes,
  }))
}

async function parentFolderLive(
  client: PoolClient,
  projectId: string,
  folderPath: string,
): Promise<boolean> {
  if (folderPath === "") return true
  const segments = folderPath.split("/").filter(Boolean)
  const name = segments.pop()
  if (!name) return true
  const parent = segments.join("/")
  const found = await client.query<{ id: string }>(
    `SELECT id
       FROM project_files
      WHERE project_id = $1
        AND lower(folder_path) = lower($2)
        AND lower(name) = lower($3)
        AND is_folder = TRUE
        AND deleted_at IS NULL
      LIMIT 1`,
    [projectId, parent, name],
  )
  return found.rows.length > 0
}

export async function restoreFromTrash(input: {
  /** `projects.storage_owner_id` — для ключей восстановленных строк. */
  storageOwnerId: string
  projectId: string
  fileId: string
  eventId?: string
}): Promise<ProjectFileRecord> {
  return withTransaction(async (client) => {
    const found = await client.query<
      ProjectFileRecord & { deletedAt: Date | null }
    >(
      `SELECT ${FILE_FIELDS}, deleted_at AS "deletedAt"
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NOT NULL`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) {
      throw new StorageWriteError("File not found in trash.", 404)
    }

    const destFolder = (await parentFolderLive(
      client,
      input.projectId,
      existing.folderPath,
    ))
      ? existing.folderPath
      : ""

    const destName = await allocateUniqueName(client, {
      projectId: input.projectId,
      folderPath: destFolder,
      name: existing.name,
    })

    const oldPrefix = existing.isFolder
      ? folderPrefix(existing.folderPath, existing.name)
      : null
    const newPrefix = existing.isFolder
      ? folderPrefix(destFolder, destName)
      : null

    const cascade = oldPrefix
      ? await client.query<{ id: string }>(
          `SELECT id FROM project_files
            WHERE project_id = $1
              AND deleted_at = $2
              AND (folder_path = $3 OR folder_path LIKE $3 || '/%')`,
          [input.projectId, existing.deletedAt, oldPrefix],
        )
      : { rows: [] as { id: string }[] }

    if (existing.isFolder && oldPrefix && newPrefix && oldPrefix !== newPrefix) {
      await client.query(
        `UPDATE project_files
            SET folder_path = CASE
                  WHEN folder_path = $2 THEN $3
                  ELSE $3 || substr(folder_path, length($2) + 1)
                END
          WHERE project_id = $1
            AND id = ANY($4::text[])`,
        [
          input.projectId,
          oldPrefix,
          newPrefix,
          cascade.rows.map((r) => r.id),
        ],
      )
    }

    const restoredIds = [existing.id, ...cascade.rows.map((r) => r.id)]

    await client.query(
      `UPDATE project_files
          SET deleted_at = NULL,
              deleted_by = NULL,
              name = CASE WHEN id = $2 THEN $3 ELSE name END,
              folder_path = CASE WHEN id = $2 THEN $4 ELSE folder_path END,
              updated_at = NOW()
        WHERE id = ANY($1::text[])`,
      [restoredIds, existing.id, destName, destFolder],
    )

    const updated = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1`,
      [existing.id],
    )
    const file = updated.rows[0]!

    const all = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS} FROM project_files WHERE id = ANY($1::text[])`,
      [restoredIds],
    )

    for (const row of all.rows) {
      const key =
        row.s3Key ??
        logicalKeyForFile({
          storageOwnerId: input.storageOwnerId,
          projectId: input.projectId,
          folderPath: row.folderPath,
          name: row.name,
        })
      const seq = await appendStorageChange(client, {
        projectId: input.projectId,
        key,
        op: "put",
        size: row.isFolder ? 0 : row.sizeBytes,
        eventTime: nowUnixSec(),
        eventId: input.eventId
          ? row.id === existing.id
            ? input.eventId
            : `${input.eventId}:${row.id}`
          : null,
        payload: {
          fileId: row.id,
          name: row.name,
          folderPath: row.folderPath,
          isFolder: row.isFolder,
          contentType: row.contentType,
        },
      })
      await client.query(
        `UPDATE project_files SET last_seq = $2 WHERE id = $1`,
        [row.id, seq],
      )
    }

    return file
  })
}

export async function purgeExpiredTrash(): Promise<{
  purged: number
  keys: string[]
}> {
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
  const rows = await query<{ id: string; s3Key: string | null }>(
    `SELECT id, s3_key AS "s3Key"
       FROM project_files
      WHERE deleted_at IS NOT NULL AND deleted_at < $1
      LIMIT 500`,
    [cutoff],
  )
  if (rows.rows.length === 0) return { purged: 0, keys: [] }

  const keys = rows.rows.map((r) => r.s3Key).filter((k): k is string => Boolean(k))
  const ids = rows.rows.map((r) => r.id)

  await query(`DELETE FROM project_files WHERE id = ANY($1::text[])`, [ids])

  if (keys.length > 0 && isS3Configured()) {
    const client = getS3Client()
    const bucket = getS3Bucket()
    await Promise.allSettled(
      keys.map((key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    )
  }

  return { purged: ids.length, keys }
}
