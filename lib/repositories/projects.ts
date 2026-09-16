import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  ProjectGroupName,
  ProjectMediaRecord,
  ProjectRecord,
} from "@/lib/domain-types"

const PROJECT_FIELDS = `
  id,
  user_id AS "ownerId",
  user_id AS "userId",
  -- Адрес в R2, а не владение: у переданного проекта они расходятся, и ключи
  -- строятся по этому полю. COALESCE — чтобы строка, не дошедшая до бэкфилла,
  -- вела себя как до миграции (db/migrations/2026-08-28-project-storage-owner.sql).
  COALESCE(storage_owner_id, user_id) AS "storageOwnerId",
  name,
  COALESCE(description, '') AS description,
  COALESCE(group_name, 'personal') AS "groupName",
  COALESCE(is_paused, FALSE) AS "isPaused",
  drive_folder_id AS "driveFolderId",
  -- Колонки is_active больше нет: она дублировала смысл is_paused и была с ней
  -- сварена. Поле остаётся вычисляемым, потому что его отдают машинам в ответе
  -- экшена projects (lib/machine-api/actions/storage-read.ts) — контракт
  -- POST /api/v1 ломать нельзя.
  NOT COALESCE(is_paused, FALSE) AS "isActive",
  COALESCE(is_archived, FALSE) AS "isArchived",
  -- Почему проект стоит. NULL — остановлен человеком; иначе биллингом, и
  -- тумблер обратно не включится, пока платить нечем (lib/billing/admission.ts).
  paused_reason AS "pausedReason",
  archived_at AS "archivedAt",
  deleted_at AS "deletedAt",
  client_id AS "clientId",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  yougile_chat_id AS "yougileChatId"
`

const MEDIA_FIELDS = `
  id,
  project_id AS "projectId",
  file_name AS "fileName",
  mime_type AS "mimeType",
  size_bytes AS "sizeBytes",
  drive_file_id AS "driveFileId",
  created_at AS "createdAt"
`

export type ProjectWithUnread = ProjectRecord & {
  unreadCount: number
}

export async function listProjectsByOwner(
  ownerId: string,
): Promise<ProjectWithUnread[]> {
  const result = await query<ProjectWithUnread>(
    `SELECT ${PROJECT_FIELDS},
            COALESCE((
              SELECT COUNT(*)::int
                FROM project_messages m
               WHERE m.project_id = projects.id
                 AND m.sender_role = 'team'
                 AND m.read_by_user = FALSE
            ), 0) AS "unreadCount"
       FROM projects
      WHERE user_id = $1
        AND deleted_at IS NULL
      ORDER BY
        COALESCE(is_archived, FALSE),
        CASE COALESCE(group_name, 'personal')
          WHEN 'shared' THEN 0
          WHEN 'personal' THEN 1
          WHEN 'tools' THEN 2
          WHEN 'archive' THEN 3
          ELSE 4
        END,
        created_at DESC`,
    [ownerId],
  )
  return result.rows
}

export type ArchivedFilter = boolean | "all"

function archivedClause(
  filter: ArchivedFilter | undefined,
  paramIndex: number,
): { sql: string; params: unknown[] } {
  if (filter === undefined || filter === "all") {
    return { sql: "", params: [] }
  }
  return {
    sql: ` AND COALESCE(is_archived, FALSE) = $${paramIndex}`,
    params: [filter],
  }
}

export async function listProjectsByUserId(
  userId: string,
  options?: { archived?: ArchivedFilter; includeDeleted?: boolean },
): Promise<ProjectRecord[]> {
  const archived = archivedClause(options?.archived, 2)
  const deletedSql = options?.includeDeleted
    ? ""
    : " AND deleted_at IS NULL"
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE user_id = $1${deletedSql}${archived.sql}
      ORDER BY created_at DESC`,
    [userId, ...archived.params],
  )
  return result.rows
}

/** All projects (admin / storage listing). */
export async function listAllProjects(options?: {
  includeDeleted?: boolean
}): Promise<ProjectRecord[]> {
  const deletedSql = options?.includeDeleted ? "" : " WHERE deleted_at IS NULL"
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects${deletedSql}
      ORDER BY created_at DESC`,
  )
  return result.rows
}

export async function findProjectById(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<ProjectRecord | null> {
  const deletedSql = options?.includeDeleted ? "" : " AND deleted_at IS NULL"
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE id = $1${deletedSql}`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findOwnedProject(
  id: string,
  ownerId: string,
  options?: { includeDeleted?: boolean },
): Promise<ProjectRecord | null> {
  const deletedSql = options?.includeDeleted ? "" : " AND deleted_at IS NULL"
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE id = $1 AND user_id = $2${deletedSql}`,
    [id, ownerId],
  )
  return result.rows[0] ?? null
}

/**
 * Проект, владелец которого числится в этой компании.
 *
 * Рамка машины компании (docs/COMPANY_PIPELINE_PLAN.md §2). Как и вся остальная
 * изоляция компании, ложится на ВЛАДЕЛЬЦА проекта, а не на новую колонку в
 * `projects`: колонка стала бы вторым источником правды и однажды разошлась бы
 * с первым при переводе человека между компаниями.
 */
export async function findCompanyProject(
  id: string,
  companyId: string,
  options?: { includeDeleted?: boolean },
): Promise<ProjectRecord | null> {
  const deletedSql = options?.includeDeleted ? "" : " AND deleted_at IS NULL"
  // Подзапросом, а не JOIN: тогда `PROJECT_FIELDS` остаётся без префикса таблицы
  // и годится как есть. С джойном `id`, `created_at` и `updated_at` стали бы
  // неоднозначными, и список полей пришлось бы держать во второй редакции.
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE id = $1
        AND user_id IN (SELECT id FROM users WHERE company_id = $2)${deletedSql}`,
    [id, companyId],
  )
  return result.rows[0] ?? null
}

/** Проекты всех людей компании. Рамка машины компании — см. findCompanyProject. */
export async function listProjectsByCompanyId(
  companyId: string,
  options?: { includeDeleted?: boolean },
): Promise<ProjectRecord[]> {
  const deletedSql = options?.includeDeleted ? "" : " AND deleted_at IS NULL"
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)${deletedSql}
      ORDER BY created_at DESC`,
    [companyId],
  )
  return result.rows
}

export async function findProjectForUser(
  id: string,
  userId: string,
): Promise<ProjectRecord | null> {
  const owned = await findOwnedProject(id, userId)
  if (owned) return owned
  // EXISTS, not JOIN: project_members also has user_id and created_at, so a
  // JOIN with unqualified PROJECT_FIELDS blows up with "column reference is
  // ambiguous" — that's the HTTP 500 on shared projects.
  const member = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE id = $1
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM project_members pm
           WHERE pm.project_id = projects.id
             AND pm.user_id = $2
        )`,
    [id, userId],
  )
  return member.rows[0] ?? null
}

/**
 * Looks a project up by its Drive folder id rather than our own primary key.
 * Used when reconciling the DB cache against a live scan of the user's Drive
 * folder — Drive folder id is the stable identity there, our own id is not.
 */
export async function findProjectByDriveFolderId(
  driveFolderId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE drive_folder_id = $1`,
    [driveFolderId],
  )
  return result.rows[0] ?? null
}

export async function createProject(input: {
  ownerId?: string
  userId?: string
  name: string
  description?: string
  groupName?: ProjectGroupName
  driveFolderId?: string | null
  clientId?: string | null
}): Promise<ProjectRecord> {
  const ownerId = input.ownerId ?? input.userId
  if (!ownerId) {
    throw new Error("createProject requires ownerId or userId")
  }

  const id = randomUUID()
  const result = await query<ProjectRecord>(
    `INSERT INTO projects (
        id, user_id, storage_owner_id, name, description, group_name, is_paused,
        drive_folder_id, client_id
     )
     VALUES ($1, $2, $2, $3, COALESCE($4, ''), COALESCE($5, 'personal'), FALSE, $6, $7)
     RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      ownerId,
      input.name,
      input.description ?? "",
      input.groupName ?? "personal",
      input.driveFolderId ?? null,
      input.clientId ?? null,
    ],
  )
  // Папки IN / OUT намеренно не создаём: структуру проекта задаёт пользователь.
  // Упрощённый режим работает и с плоским корнем, и с парой IN / OUT.
  const row = result.rows[0]
  if (!row) {
    throw new Error("Project insert returned no row.")
  }
  return row
}

export async function setProjectDriveFolderId(
  id: string,
  driveFolderId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET drive_folder_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PROJECT_FIELDS}`,
    [id, driveFolderId],
  )
  return result.rows[0] ?? null
}

/**
 * Looks a project up by its YouGile group chat id — used by the webhook
 * receiver to route an incoming `chat_message-created` event without
 * requiring the caller to be authenticated as the owning user.
 */
export async function findProjectByYougileChatId(
  yougileChatId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE yougile_chat_id = $1`,
    [yougileChatId],
  )
  return result.rows[0] ?? null
}

/** Persists the YouGile group chat id once it has been lazily created. */
export async function setProjectYougileChatId(
  id: string,
  yougileChatId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET yougile_chat_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PROJECT_FIELDS}`,
    [id, yougileChatId],
  )
  return result.rows[0] ?? null
}

/**
 * Drops a YouGile chat id that the API no longer recognizes (deleted chat
 * or task). The background poller would otherwise keep hitting 404 every
 * tick; the next site message recreates a chat via ensureProjectYouGileChat.
 */
export async function clearProjectYougileChatId(id: string): Promise<void> {
  await query(
    `UPDATE projects
        SET yougile_chat_id = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [id],
  )
}

/**
 * Пауза проекта пишется ТОЛЬКО через lib/project-automation.ts#setProjectPaused:
 * тумблер слежения живёт в двух хранилищах (is_paused в Postgres и
 * options/folderState.json на R2), и разъезжаются они мгновенно, если писать
 * их по отдельности. Прямой вызов updateProject с isPaused обновит Postgres и
 * оставит сайдкар прежним — локальная машина не узнает об изменении.
 *
 * Устаревшего `isActive` здесь больше нет: он был инверсией isPaused и
 * присваивался ей перекрёстно, из-за чего выключение автоматизации ставило
 * проекту «Приостановлен», а пауза гасила автоматизацию в обход R2.
 */
export async function updateProject(
  id: string,
  ownerId: string,
  input: {
    name?: string
    description?: string
    groupName?: ProjectGroupName
    isPaused?: boolean
    isArchived?: boolean
  },
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET name        = COALESCE($3, name),
            description = COALESCE($4, description),
            group_name  = COALESCE($5, group_name),
            is_paused   = COALESCE($6, is_paused),
            is_archived = COALESCE($7, is_archived),
            archived_at = CASE
                            WHEN $7 IS NULL THEN archived_at
                            WHEN $7 = TRUE  THEN COALESCE(archived_at, NOW())
                            ELSE NULL
                          END,
            updated_at  = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      ownerId,
      input.name ?? null,
      input.description ?? null,
      input.groupName ?? null,
      input.isPaused ?? null,
      input.isArchived ?? null,
    ],
  )
  return result.rows[0] ?? null
}

/** Hard-delete (used by purge). Prefer softDeleteProject for user actions. */
export async function deleteProject(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
    [id, ownerId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function listProjectMedia(
  projectId: string,
): Promise<ProjectMediaRecord[]> {
  const result = await query<
    ProjectMediaRecord & { sizeBytes: number | string | null }
  >(
    `SELECT ${MEDIA_FIELDS}
       FROM project_media
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [projectId],
  )
  return result.rows.map(normalizeMedia)
}

export async function findProjectMedia(
  id: string,
  projectId: string,
): Promise<ProjectMediaRecord | null> {
  const result = await query<
    ProjectMediaRecord & { sizeBytes: number | string | null }
  >(
    `SELECT ${MEDIA_FIELDS}
       FROM project_media
      WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  )
  const row = result.rows[0]
  return row ? normalizeMedia(row) : null
}

function normalizeMedia(
  row: ProjectMediaRecord & { sizeBytes: number | string | null },
): ProjectMediaRecord {
  const raw = row.sizeBytes
  const sizeBytes =
    raw == null
      ? null
      : typeof raw === "number"
        ? raw
        : Number.parseInt(String(raw), 10)
  return {
    ...row,
    sizeBytes: Number.isFinite(sizeBytes as number)
      ? (sizeBytes as number)
      : null,
  }
}

export async function createProjectMedia(input: {
  projectId: string
  fileName: string
  mimeType: string
  sizeBytes?: number | null
  driveFileId: string
}): Promise<ProjectMediaRecord> {
  const id = randomUUID()
  const result = await query<
    ProjectMediaRecord & { sizeBytes: number | string | null }
  >(
    `INSERT INTO project_media (
        id, project_id, file_name, mime_type, size_bytes, drive_file_id
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MEDIA_FIELDS}`,
    [
      id,
      input.projectId,
      input.fileName,
      input.mimeType,
      input.sizeBytes ?? null,
      input.driveFileId,
    ],
  )
  return normalizeMedia(result.rows[0])
}

export async function deleteProjectMedia(id: string, projectId: string) {
  await query(`DELETE FROM project_media WHERE id = $1 AND project_id = $2`, [
    id,
    projectId,
  ])
}

export async function deleteProjectMediaByDriveFileId(
  driveFileId: string,
  projectId: string,
) {
  await query(
    `DELETE FROM project_media WHERE drive_file_id = $1 AND project_id = $2`,
    [driveFileId, projectId],
  )
}

/**
 * Active projects with a linked YouGile chat — polled in the background by
 * lib/chat-push-poller.ts so team replies get pulled in (and pushed to the
 * owner) even when nobody has the site open.
 */
export async function listProjectsWithYougileChat(): Promise<ProjectRecord[]> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE yougile_chat_id IS NOT NULL
        AND COALESCE(is_paused, FALSE) = FALSE
        AND deleted_at IS NULL`,
  )
  return result.rows
}

export async function countProjectsByOwner(ownerId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  )
  return result.rows[0]?.count ?? 0
}

export async function countProjectsByUserId(userId: string): Promise<number> {
  return countProjectsByOwner(userId)
}

export async function countMediaByUserId(userId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = $1 AND f.is_folder = FALSE`,
    [userId],
  )
  return result.rows[0]?.count ?? 0
}
