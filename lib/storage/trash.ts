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
  /**
   * Проект, из которого файл удалён. В выборке по одному проекту он и так
   * известен, но корень корзины показывает файлы всех проектов сразу, и без
   * этого поля строку не к чему привязать — ни подсветить проект слева, ни
   * восстановить её потом.
   */
  projectId: string
  /** Имя проекта — только в выборке по владельцу, иначе пусто. */
  projectName: string
  /** Тип содержимого: по нему интерфейс рисует значок файла. */
  contentType: string
  /**
   * Файл попал в корзину вместе со всем проектом, а не сам по себе. Своей
   * пометки удаления у него нет, поэтому поштучно вернуть или стереть его
   * нельзя — только целиком проект.
   */
  projectDeleted: boolean
}

type TrashRow = {
  fileId: string
  name: string
  folderPath: string
  isFolder: boolean
  fileDeletedAt: Date | null
  projectDeletedAt: Date | null
  sizeBytes: number
  projectId: string
  projectName: string | null
  contentType: string | null
}

function toTrashItem(row: TrashRow): TrashItem {
  const deletedAt = row.fileDeletedAt ?? row.projectDeletedAt
  return {
    fileId: row.fileId,
    name: row.name,
    folderPath: row.folderPath,
    isFolder: row.isFolder,
    deletedAt: deletedAt ? new Date(deletedAt).toISOString() : "",
    sizeBytes: row.sizeBytes,
    projectId: row.projectId,
    projectName: row.projectName ?? "",
    contentType: row.contentType ?? "",
    projectDeleted: row.fileDeletedAt === null,
  }
}

const TRASH_FIELDS = `
  f.id AS "fileId",
  f.name,
  f.folder_path AS "folderPath",
  f.is_folder AS "isFolder",
  f.size_bytes::float8 AS "sizeBytes",
  f.content_type AS "contentType",
  f.project_id AS "projectId"
`

export async function listTrash(projectId: string): Promise<TrashItem[]> {
  const result = await query<TrashRow>(
    `SELECT ${TRASH_FIELDS},
            f.deleted_at AS "fileDeletedAt",
            NULL::timestamptz AS "projectDeletedAt",
            NULL::text AS "projectName"
       FROM project_files f
      WHERE f.project_id = $1 AND f.deleted_at IS NOT NULL
      ORDER BY f.deleted_at DESC, lower(f.name) ASC`,
    [projectId],
  )
  return result.rows.map(toTrashItem)
}

/**
 * Корень корзины: всё удалённое по всем проектам владельца сразу.
 *
 * Сюда идут вещи двух родов. Поштучно выброшенные файлы помечены своим
 * `deleted_at`. А у файлов внутри удалённого проекта такой пометки нет —
 * удалён проект целиком, — но человек-то выбросил и их, и в общем списке он
 * ждёт увидеть именно всё. Поэтому время удаления для них берётся у проекта, а
 * сами они помечены `projectDeleted`: восстанавливать и стирать их поодиночке
 * нельзя, пока не решена судьба самого проекта.
 */
export async function listTrashForOwner(ownerId: string): Promise<TrashItem[]> {
  const result = await query<TrashRow>(
    `SELECT ${TRASH_FIELDS},
            f.deleted_at AS "fileDeletedAt",
            p.deleted_at AS "projectDeletedAt",
            p.name AS "projectName"
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = $1
        AND (f.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL)
      ORDER BY COALESCE(f.deleted_at, p.deleted_at) DESC, lower(f.name) ASC`,
    [ownerId],
  )
  return result.rows.map(toTrashItem)
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

/** Сносит строки и их объекты в R2. Общий хвост всех ручных чисток корзины. */
async function dropFileRows(
  rows: { id: string; s3Key: string | null }[],
): Promise<{ purged: number; keys: string[] }> {
  if (rows.length === 0) return { purged: 0, keys: [] }
  const ids = rows.map((r) => r.id)
  const keys = rows.map((r) => r.s3Key).filter((k): k is string => Boolean(k))

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

/**
 * Удаление одной вещи из корзины навсегда — без отсечки по сроку хранения.
 *
 * Папка уходит со всем, что в ней лежало: подчинённые строки ищутся ровно так
 * же, как при восстановлении (`restoreFromTrash`) — по совпадению `deleted_at` и
 * префиксу пути. Совпадение времени здесь и есть признак «удалено этим же
 * действием»: файл, который человек выбросил из той же папки отдельно и раньше,
 * останется в корзине сам по себе, и его срок хранения не оборвётся чужой
 * чисткой.
 */
export async function purgeTrashItem(input: {
  projectId: string
  fileId: string
}): Promise<{ purged: number }> {
  const found = await query<{
    id: string
    s3Key: string | null
    name: string
    folderPath: string
    isFolder: boolean
    deletedAt: Date
  }>(
    `SELECT id,
            s3_key AS "s3Key",
            name,
            folder_path AS "folderPath",
            is_folder AS "isFolder",
            deleted_at AS "deletedAt"
       FROM project_files
      WHERE id = $1 AND project_id = $2 AND deleted_at IS NOT NULL`,
    [input.fileId, input.projectId],
  )
  const existing = found.rows[0]
  if (!existing) {
    throw new StorageWriteError("File not found in trash.", 404)
  }

  const rows = [{ id: existing.id, s3Key: existing.s3Key }]
  if (existing.isFolder) {
    const prefix = folderPrefix(existing.folderPath, existing.name)
    const children = await query<{ id: string; s3Key: string | null }>(
      `SELECT id, s3_key AS "s3Key"
         FROM project_files
        WHERE project_id = $1
          AND deleted_at = $2
          AND (folder_path = $3 OR folder_path LIKE $3 || '/%')`,
      [input.projectId, existing.deletedAt, prefix],
    )
    rows.push(...children.rows)
  }

  const result = await dropFileRows(rows)
  return { purged: result.purged }
}

/** Чистит корзину проекта целиком — то же, но без выбора вещи. */
export async function emptyProjectTrash(
  projectId: string,
): Promise<{ purged: number }> {
  const rows = await query<{ id: string; s3Key: string | null }>(
    `SELECT id, s3_key AS "s3Key"
       FROM project_files
      WHERE project_id = $1 AND deleted_at IS NOT NULL`,
    [projectId],
  )
  const result = await dropFileRows(rows.rows)
  return { purged: result.purged }
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
  return dropFileRows(rows.rows)
}
