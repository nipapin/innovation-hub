import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"

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

/** Те же поля с префиксом: в запросе с JOIN users `id` и `created_at` неоднозначны. */
const FILE_FIELDS_PF = `
  pf.id,
  pf.project_id AS "projectId",
  pf.folder_path AS "folderPath",
  pf.name,
  pf.is_folder AS "isFolder",
  pf.s3_key AS "s3Key",
  pf.size_bytes::float8 AS "sizeBytes",
  pf.content_type AS "contentType",
  pf.created_at AS "createdAt"
`

export async function listFilesInFolder(
  projectId: string,
  folderPath: string,
): Promise<ProjectFileRecord[]> {
  const result = await query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS}
       FROM project_files
      WHERE project_id = $1 AND folder_path = $2
        AND deleted_at IS NULL
      ORDER BY is_folder DESC, lower(name) ASC`,
    [projectId, folderPath],
  )
  return result.rows
}

/**
 * Дерево проекта для интерфейса — с именем заливщика.
 *
 * JOIN здесь, а не отдельным запросом на файл: список рисуется целиком, а
 * «кто залил» нужен в панели свойств почти всегда, когда файл выделяют.
 */
export async function listAllProjectFiles(
  projectId: string,
): Promise<ProjectFileRecord[]> {
  const result = await query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS_PF},
              COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email)
                AS "uploadedByName"
       FROM project_files pf
       LEFT JOIN users u ON u.id = pf.uploaded_by
      WHERE pf.project_id = $1
        AND pf.deleted_at IS NULL
      ORDER BY pf.folder_path ASC, pf.is_folder DESC, lower(pf.name) ASC`,
    [projectId],
  )
  return result.rows
}

export async function findFileById(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<ProjectFileRecord | null> {
  const deleted = options?.includeDeleted
    ? ""
    : " AND deleted_at IS NULL"
  const result = await query<ProjectFileRecord>(
    `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1${deleted}`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findFileByS3Key(
  s3Key: string,
): Promise<(ProjectFileRecord & { ownerId: string }) | null> {
  const result = await query<ProjectFileRecord & { ownerId: string }>(
    `SELECT ${FILE_FIELDS},
            p.user_id AS "ownerId"
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE f.s3_key = $1`,
    [s3Key],
  )
  return result.rows[0] ?? null
}

/**
 * Файл с таким логическим именем в этой папке проекта.
 *
 * Нужен заливке: имя занято — и человека надо спросить, перезаписать или
 * сохранить оба. Регистр не различаем, потому что его не различает и проверка
 * `assertNameFree`, которая иначе откажет уже после отправки байтов.
 */
export async function findFileByName(input: {
  projectId: string
  folderPath: string
  name: string
}): Promise<ProjectFileRecord | null> {
  const result = await query<ProjectFileRecord>(
    `SELECT ${FILE_FIELDS}
       FROM project_files
      WHERE project_id = $1
        AND lower(folder_path) = lower($2)
        AND lower(name) = lower($3)
        AND is_folder = FALSE
        AND deleted_at IS NULL
      LIMIT 1`,
    [input.projectId, input.folderPath.replace(/^\/+|\/+$/g, ""), input.name],
  )
  return result.rows[0] ?? null
}

export async function createFolder(input: {
  projectId: string
  folderPath: string
  name: string
}): Promise<ProjectFileRecord> {
  const id = randomUUID()
  const result = await query<ProjectFileRecord>(
    `INSERT INTO project_files (
        id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
     )
     VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '')
     RETURNING ${FILE_FIELDS}`,
    [id, input.projectId, input.folderPath, input.name],
  )
  return result.rows[0]
}

/** Idempotent folder create used by migration / seed helpers. */
export async function ensureFolder(input: {
  projectId: string
  folderPath: string
  name: string
}): Promise<ProjectFileRecord> {
  const existing = await query<ProjectFileRecord>(
    `SELECT ${FILE_FIELDS}
       FROM project_files
      WHERE project_id = $1 AND folder_path = $2 AND name = $3`,
    [input.projectId, input.folderPath, input.name],
  )
  if (existing.rows[0]) return existing.rows[0]
  return createFolder(input)
}

export async function createFile(input: {
  projectId: string
  folderPath: string
  name: string
  s3Key: string
  sizeBytes: number
  contentType: string
}): Promise<ProjectFileRecord> {
  const id = randomUUID()
  const result = await query<ProjectFileRecord>(
    `INSERT INTO project_files (
        id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
     )
     VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7)
     RETURNING ${FILE_FIELDS}`,
    [
      id,
      input.projectId,
      input.folderPath,
      input.name,
      input.s3Key,
      input.sizeBytes,
      input.contentType,
    ],
  )
  return result.rows[0]
}

export async function renameOrMoveFile(input: {
  id: string
  projectId: string
  name?: string
  folderPath?: string
}): Promise<ProjectFileRecord | null> {
  const existing = await findFileById(input.id)
  if (!existing || existing.projectId !== input.projectId) return null

  const newName = input.name ?? existing.name
  const newFolder = input.folderPath ?? existing.folderPath

  // If renaming/moving a folder, also rewrite descendants' folder_path.
  if (existing.isFolder) {
    const oldPrefix =
      existing.folderPath === ""
        ? existing.name
        : `${existing.folderPath}/${existing.name}`
    const newPrefix =
      newFolder === "" ? newName : `${newFolder}/${newName}`

    await query(
      `UPDATE project_files
          SET folder_path = CASE
                WHEN folder_path = $2 THEN $3
                ELSE $3 || substr(folder_path, length($2) + 1)
              END
        WHERE project_id = $1
          AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
      [input.projectId, oldPrefix, newPrefix],
    )
  }

  const result = await query<ProjectFileRecord>(
    `UPDATE project_files
        SET name = $3,
            folder_path = $4
      WHERE id = $1 AND project_id = $2
      RETURNING ${FILE_FIELDS}`,
    [input.id, input.projectId, newName, newFolder],
  )
  return result.rows[0] ?? null
}

export async function deleteFileCascade(
  id: string,
  projectId: string,
): Promise<{ deletedS3Keys: string[] }> {
  const existing = await findFileById(id)
  if (!existing || existing.projectId !== projectId) {
    return { deletedS3Keys: [] }
  }

  const keys: string[] = []

  if (existing.isFolder) {
    const prefix =
      existing.folderPath === ""
        ? existing.name
        : `${existing.folderPath}/${existing.name}`

    const children = await query<{ s3Key: string | null }>(
      `SELECT s3_key AS "s3Key"
         FROM project_files
        WHERE project_id = $1
          AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
          AND s3_key IS NOT NULL`,
      [projectId, prefix],
    )
    for (const row of children.rows) {
      if (row.s3Key) keys.push(row.s3Key)
    }

    await query(
      `DELETE FROM project_files
        WHERE project_id = $1
          AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
      [projectId, prefix],
    )
  } else if (existing.s3Key) {
    keys.push(existing.s3Key)
  }

  await query(`DELETE FROM project_files WHERE id = $1 AND project_id = $2`, [
    id,
    projectId,
  ])

  return { deletedS3Keys: keys }
}

export async function listAllS3KeysForProject(
  projectId: string,
): Promise<string[]> {
  const result = await query<{ s3Key: string }>(
    `SELECT s3_key AS "s3Key"
       FROM project_files
      WHERE project_id = $1 AND s3_key IS NOT NULL`,
    [projectId],
  )
  return result.rows.map((r) => r.s3Key)
}

export async function getOwnerFileStats(ownerId: string): Promise<{
  fileCount: number
  totalBytes: number
}> {
  const result = await query<{ fileCount: number; totalBytes: number }>(
    `SELECT COUNT(*)::int AS "fileCount",
            COALESCE(SUM(f.size_bytes), 0)::float8 AS "totalBytes"
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = $1 AND f.is_folder = FALSE AND f.deleted_at IS NULL`,
    [ownerId],
  )
  return {
    fileCount: result.rows[0]?.fileCount ?? 0,
    totalBytes: result.rows[0]?.totalBytes ?? 0,
  }
}

export type ChartBucket = { label: string; value: number }

/**
 * Полночь по UTC, `daysAgo` дней назад.
 *
 * Корзины графика сопоставляются с `date_trunc` базы по строке даты, а база
 * режет время по UTC. Ключи раньше строились от МЕСТНОЙ полуночи: в Москве
 * (UTC+3) она — 21:00 предыдущего дня по UTC, ключ съезжал на сутки назад, и
 * ни один день и ни одна неделя не совпадали — график «Дни» и «Недели» был
 * нулевым при любых загрузках. Поэтому все ключи — от полуночи UTC.
 */
function utcMidnight(daysAgo = 0): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d
}

/** Aggregates non-folder file creations for chart ranges. */
export async function getUploadChart(
  ownerId: string,
  range: "day" | "week" | "month",
  projectId?: string | null,
): Promise<ChartBucket[]> {
  const projectFilter = projectId ? "AND p.id = $2" : ""
  const params: unknown[] = projectId ? [ownerId, projectId] : [ownerId]

  if (range === "day") {
    // Last 7 days
    const result = await query<{ day: Date; value: number }>(
      `SELECT date_trunc('day', f.created_at) AS day,
              COUNT(*)::int AS value
         FROM project_files f
         JOIN projects p ON p.id = f.project_id
        WHERE p.user_id = $1
          AND f.is_folder = FALSE
          AND f.created_at >= NOW() - INTERVAL '6 days'
          ${projectFilter}
        GROUP BY 1
        ORDER BY 1`,
      params,
    )
    const map = new Map(
      result.rows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        r.value,
      ]),
    )
    const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    const enLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    const buckets: ChartBucket[] = []
    for (let i = 6; i >= 0; i--) {
      const d = utcMidnight(i)
      const key = d.toISOString().slice(0, 10)
      const dow = (d.getUTCDay() + 6) % 7 // Mon=0
      buckets.push({
        label: labels[dow] ?? enLabels[dow] ?? key,
        value: map.get(key) ?? 0,
      })
    }
    return buckets
  }

  if (range === "week") {
    const result = await query<{ week: Date; value: number }>(
      `SELECT date_trunc('week', f.created_at) AS week,
              COUNT(*)::int AS value
         FROM project_files f
         JOIN projects p ON p.id = f.project_id
        WHERE p.user_id = $1
          AND f.is_folder = FALSE
          AND f.created_at >= NOW() - INTERVAL '7 weeks'
          ${projectFilter}
        GROUP BY 1
        ORDER BY 1`,
      params,
    )
    const map = new Map(
      result.rows.map((r) => [
        new Date(r.week).toISOString().slice(0, 10),
        r.value,
      ]),
    )
    const buckets: ChartBucket[] = []
    for (let i = 7; i >= 0; i--) {
      const d = utcMidnight()
      // Align to Monday
      const day = (d.getUTCDay() + 6) % 7
      d.setUTCDate(d.getUTCDate() - day - i * 7)
      const key = d.toISOString().slice(0, 10)
      buckets.push({
        label: `W${8 - i}`,
        value: map.get(key) ?? 0,
      })
    }
    return buckets
  }

  // month — last 7 months
  const result = await query<{ month: Date; value: number }>(
    `SELECT date_trunc('month', f.created_at) AS month,
            COUNT(*)::int AS value
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = $1
        AND f.is_folder = FALSE
        AND f.created_at >= NOW() - INTERVAL '6 months'
        ${projectFilter}
      GROUP BY 1
      ORDER BY 1`,
    params,
  )
  const map = new Map(
    result.rows.map((r) => [
      new Date(r.month).toISOString().slice(0, 7),
      r.value,
    ]),
  )
  const monthNames = [
    "Янв",
    "Фев",
    "Мар",
    "Апр",
    "Май",
    "Июн",
    "Июл",
    "Авг",
    "Сен",
    "Окт",
    "Ноя",
    "Дек",
  ]
  const buckets: ChartBucket[] = []
  for (let i = 6; i >= 0; i--) {
    const d = utcMidnight()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - i)
    const key = d.toISOString().slice(0, 7)
    buckets.push({
      label: monthNames[d.getUTCMonth()] ?? key,
      value: map.get(key) ?? 0,
    })
  }
  return buckets
}
