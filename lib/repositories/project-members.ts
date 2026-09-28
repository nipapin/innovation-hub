import { query } from "@/lib/db"
import { accessIdsFor } from "@/lib/repositories/users"

// Роли и вся матрица прав живут в lib/project-access.ts: там же, где проверки
// роутов, чтобы «что значит editor» не разъезжалось между слоями.
export type { ProjectMemberRole } from "@/lib/project-access"
import type { ProjectMemberRole } from "@/lib/project-access"

export type ProjectMemberRecord = {
  projectId: string
  userId: string
  role: ProjectMemberRole
  invitedBy: string | null
  createdAt: Date
  email?: string
  fullName?: string
  /** Кто позвал: показывается владельцу, когда звал не он. */
  invitedByName?: string | null
  invitedByEmail?: string | null
}

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberRecord[]> {
  const result = await query<ProjectMemberRecord>(
    `SELECT pm.project_id AS "projectId",
            pm.user_id AS "userId",
            pm.role,
            pm.invited_by AS "invitedBy",
            pm.created_at AS "createdAt",
            u.email,
            u.full_name AS "fullName",
            inv.full_name AS "invitedByName",
            inv.email AS "invitedByEmail"
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       LEFT JOIN users inv ON inv.id = pm.invited_by
      WHERE pm.project_id = $1
      ORDER BY pm.created_at ASC`,
    [projectId],
  )
  return result.rows
}

/**
 * Строка участия ровно этого пользователя — для ЗАПИСИ: сменить роль, снять
 * доступ, проверить, не позван ли он уже.
 *
 * Для решения «пускать ли» — `findMembershipForAccess`: там засчитывается и
 * участие входа (docs/MULTI_COMPANY_PROFILES_PLAN.md §8.3).
 */
export async function findProjectMembership(
  projectId: string,
  userId: string,
): Promise<ProjectMemberRecord | null> {
  const result = await query<ProjectMemberRecord>(
    `SELECT project_id AS "projectId",
            user_id AS "userId",
            role,
            invited_by AS "invitedBy",
            created_at AS "createdAt"
       FROM project_members
      WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  return result.rows[0] ?? null
}

/**
 * Старшинство ролей участника в SQL — чтобы из двух строк (профиля и его входа)
 * взять старшую. Колонка передаётся явно: в соединении с `users` голое `role`
 * было бы неоднозначным.
 */
function memberRoleRank(column: string): string {
  return `CASE ${column} WHEN 'full' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END`
}

/**
 * Участие, которое засчитывается этому профилю: его собственное или его входа
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §8.3).
 *
 * Проект чужой компании расшаривают на вход, и виден он должен быть из любого
 * профиля человека. Нашлись обе строки — берётся старшая роль: человеку не
 * должно становиться хуже оттого, что его позвали дважды.
 */
export async function findMembershipForAccess(
  projectId: string,
  userId: string,
): Promise<ProjectMemberRecord | null> {
  const ids = await accessIdsFor(userId)
  const result = await query<ProjectMemberRecord>(
    `SELECT project_id AS "projectId",
            user_id AS "userId",
            role,
            invited_by AS "invitedBy",
            created_at AS "createdAt"
       FROM project_members
      WHERE project_id = $1 AND user_id = ANY($2::text[])
      ORDER BY ${memberRoleRank("role")} DESC
      LIMIT 1`,
    [projectId, ids],
  )
  return result.rows[0] ?? null
}

export async function upsertProjectMember(input: {
  projectId: string
  userId: string
  role: ProjectMemberRole
  invitedBy: string | null
}): Promise<ProjectMemberRecord> {
  const result = await query<ProjectMemberRecord>(
    `INSERT INTO project_members (project_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET role = EXCLUDED.role
     RETURNING project_id AS "projectId",
               user_id AS "userId",
               role,
               invited_by AS "invitedBy",
               created_at AS "createdAt"`,
    [input.projectId, input.userId, input.role, input.invitedBy],
  )
  return result.rows[0]!
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

/** Компания владельца расшаренного проекта — для плашки на карточке (§8.4). */
export type SharedProjectOwnerCompany = {
  id: string
  title: string
  branding: Record<string, unknown>
}

/**
 * Проекты, расшаренные этому профилю — ему самому или его входу
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §8.3).
 *
 * Проект, позванный дважды, — одной строкой со старшей ролью. Свои проекты
 * профиля сюда не попадают, даже если расшарены его входу: они уже в «своих», и
 * вторая карточка того же проекта в «Расшаренных» читалась бы как копия.
 */
export async function listSharedProjectsForUser(userId: string) {
  const ids = await accessIdsFor(userId)
  const result = await query<{
    id: string
    ownerId: string
    userId: string
    name: string
    description: string
    groupName: string
    isPaused: boolean
    driveFolderId: string | null
    isActive: boolean
    isArchived: boolean
    archivedAt: Date | null
    deletedAt: Date | null
    clientId: string | null
    createdAt: Date
    updatedAt: Date
    yougileChatId: string | null
    memberRole: ProjectMemberRole
    ownerCompany: SharedProjectOwnerCompany | null
  }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id)
              p.id,
              p.user_id AS "ownerId",
              p.user_id AS "userId",
              p.name,
              COALESCE(p.description, '') AS description,
              COALESCE(p.group_name, 'personal') AS "groupName",
              COALESCE(p.is_paused, FALSE) AS "isPaused",
              p.drive_folder_id AS "driveFolderId",
              NOT COALESCE(p.is_paused, FALSE) AS "isActive",
              COALESCE(p.is_archived, FALSE) AS "isArchived",
              p.archived_at AS "archivedAt",
              p.deleted_at AS "deletedAt",
              p.client_id AS "clientId",
              p.created_at AS "createdAt",
              p.updated_at AS "updatedAt",
              p.yougile_chat_id AS "yougileChatId",
              pm.role AS "memberRole",
              -- Компания проекта выводится через владельца: отдельного поля в
              -- проектах нет и не будет (COMPANY_ACCOUNTS_PLAN.md §16).
              CASE WHEN c.id IS NULL THEN NULL
                   ELSE jsonb_build_object('id', c.id, 'title', c.title, 'branding', c.branding)
              END AS "ownerCompany"
         FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         JOIN users owner ON owner.id = p.user_id
         LEFT JOIN companies c ON c.id = owner.company_id
        WHERE pm.user_id = ANY($1::text[])
          AND p.user_id <> $2
          AND p.deleted_at IS NULL
        ORDER BY p.id, ${memberRoleRank("pm.role")} DESC
     ) shared
     ORDER BY "updatedAt" DESC`,
    [ids, userId],
  )
  return result.rows
}
