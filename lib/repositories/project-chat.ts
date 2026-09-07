import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  ProjectChatMessageRecord,
  ProjectChatSenderType,
} from "@/lib/domain-types"

const MESSAGE_FIELDS = `
  id,
  project_id AS "projectId",
  sender_type AS "senderType",
  sender_user_id AS "senderUserId",
  sender_name AS "senderName",
  body,
  yougile_message_id AS "yougileMessageId",
  delivered,
  created_at AS "createdAt"
`

export async function listProjectChatMessages(
  projectId: string,
): Promise<ProjectChatMessageRecord[]> {
  const result = await query<ProjectChatMessageRecord>(
    `SELECT ${MESSAGE_FIELDS}
       FROM project_chat_messages
      WHERE project_id = $1
      ORDER BY created_at ASC`,
    [projectId],
  )
  return result.rows
}

export async function insertProjectChatMessage(input: {
  projectId: string
  senderType: ProjectChatSenderType
  senderUserId?: string | null
  senderName: string
  body: string
  yougileMessageId?: string | null
  delivered?: boolean
  /**
   * Overrides `created_at` (defaults to NOW()) — used when backfilling
   * messages pulled from YouGile's own history, so they sort by when they
   * were actually sent there instead of when we happened to poll them.
   */
  createdAt?: Date
}): Promise<ProjectChatMessageRecord> {
  const id = randomUUID()
  const result = await query<ProjectChatMessageRecord>(
    `INSERT INTO project_chat_messages (
        id, project_id, sender_type, sender_user_id, sender_name, body,
        yougile_message_id, delivered, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
     RETURNING ${MESSAGE_FIELDS}`,
    [
      id,
      input.projectId,
      input.senderType,
      input.senderUserId ?? null,
      input.senderName,
      input.body,
      input.yougileMessageId ?? null,
      input.delivered ?? false,
      input.createdAt ?? null,
    ],
  )
  return result.rows[0]
}

/** Marks a client message as successfully pushed into the YouGile chat. */
export async function markProjectChatMessageDelivered(
  id: string,
  yougileMessageId: string,
): Promise<void> {
  await query(
    `UPDATE project_chat_messages
        SET yougile_message_id = $2,
            delivered = TRUE
      WHERE id = $1`,
    [id, yougileMessageId],
  )
}

/**
 * Dedup guard for the webhook receiver: a message already recorded under
 * this YouGile message id (e.g. our own echoed send, or a retried webhook
 * delivery) should not be inserted again.
 */
export async function findProjectChatMessageByYougileId(
  yougileMessageId: string,
): Promise<ProjectChatMessageRecord | null> {
  const result = await query<ProjectChatMessageRecord>(
    `SELECT ${MESSAGE_FIELDS}
       FROM project_chat_messages
      WHERE yougile_message_id = $1`,
    [yougileMessageId],
  )
  return result.rows[0] ?? null
}

/**
 * Batch variant of the dedup guard used by the YouGile pull sync: returns
 * which of the given YouGile message ids are already stored, in one query
 * instead of one lookup per remote message.
 */
export async function filterExistingYougileMessageIds(
  yougileMessageIds: string[],
): Promise<Set<string>> {
  if (yougileMessageIds.length === 0) return new Set()

  const result = await query<{ yougileMessageId: string }>(
    `SELECT yougile_message_id AS "yougileMessageId"
       FROM project_chat_messages
      WHERE yougile_message_id = ANY($1)`,
    [yougileMessageIds],
  )
  return new Set(result.rows.map((row) => row.yougileMessageId))
}

/**
 * Unread badge counts for a set of projects: messages from 'team'/'system'
 * created after `projects.chat_last_read_at` (NULL = never opened, so
 * everything counts). One project has exactly one owning user, so a single
 * timestamp column is enough — no per-user read-state table needed.
 */
export async function countUnreadForProjects(
  projectIds: string[],
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}

  const result = await query<{ projectId: string; count: number }>(
    `SELECT m.project_id AS "projectId", COUNT(*)::int AS count
       FROM project_chat_messages m
       JOIN projects p ON p.id = m.project_id
      WHERE m.project_id = ANY($1)
        AND m.sender_type IN ('team', 'system')
        AND m.created_at > COALESCE(p.chat_last_read_at, '-infinity')
      GROUP BY m.project_id`,
    [projectIds],
  )

  const counts: Record<string, number> = {}
  for (const id of projectIds) counts[id] = 0
  for (const row of result.rows) counts[row.projectId] = row.count
  return counts
}

/** Marks a project's chat as read up to now — clears its unread badge. */
export async function markProjectChatRead(projectId: string): Promise<void> {
  await query(`UPDATE projects SET chat_last_read_at = NOW() WHERE id = $1`, [
    projectId,
  ])
}

/**
 * Докуда команда уже видела переписку по проекту.
 *
 * Порог, а не отметка: их две, и обе законные. Открыли чат в админке — легла
 * `projects.chat_team_last_read_at`; ответили в YouGile — обратная
 * синхронизация принесла сообщение 'team', и оно само по себе значит «мы это
 * прочитали». Берём поздний из двух: учитывать только отметку значило бы
 * копить на сайте долг из переписки, закрытой в YouGile, а только ответ — не
 * давать погасить прочитанное, на которое отвечать нечем.
 *
 * Выражение написано в расчёте на внешний алиас `p` у таблицы projects.
 */
const TEAM_READ_MARK_SQL = `GREATEST(
  COALESCE(p.chat_team_last_read_at, '-infinity'::timestamptz),
  COALESCE((
    SELECT MAX(a.created_at)
      FROM project_chat_messages a
     WHERE a.project_id = p.id
       AND a.sender_type = 'team'
  ), '-infinity'::timestamptz)
)`

/**
 * Сколько сообщений клиента команда ещё не видела. Тот же расчёт стоит и на
 * карточке проекта в «Папках», и в сводном списке чатов — определение одно,
 * иначе два счётчика на одном экране показывали бы разное.
 *
 * Как и порог выше, ждёт внешний алиас `p`.
 */
export const TEAM_UNREAD_COUNT_SQL = `COALESCE((
  SELECT COUNT(*)::int
    FROM project_chat_messages m
   WHERE m.project_id = p.id
     AND m.sender_type = 'client'
     AND m.created_at > ${TEAM_READ_MARK_SQL}
), 0)`

/** Отмечает чат проекта прочитанным со стороны команды. */
export async function markProjectChatReadByTeam(
  projectId: string,
): Promise<void> {
  await query(
    `UPDATE projects SET chat_team_last_read_at = NOW() WHERE id = $1`,
    [projectId],
  )
}

export type AdminChatRow = {
  projectId: string
  projectName: string
  ownerId: string
  ownerEmail: string
  ownerName: string
  isArchived: boolean
  unreadCount: number
  lastMessageAt: Date | null
  lastMessageBody: string | null
  lastMessageSenderType: ProjectChatSenderType | null
  lastMessageSenderName: string | null
}

/**
 * Сводный список чатов для админки: по строке на проект, свежие сверху.
 *
 * Проекты без единого сообщения тоже здесь — раздел отвечает на вопрос «где с
 * кем переписываются», и чат, который ещё не начали, из него исчезать не
 * должен: до него добираются поиском. Уходят они в конец списка сами, потому
 * что сортировка идёт по времени последнего сообщения.
 *
 * Удалённые проекты не показываем: их чат больше некуда открыть — рабочая
 * область такой проект не отдаёт.
 */
export async function listAdminChats(params: {
  search: string
  limit: number
  offset: number
}): Promise<AdminChatRow[]> {
  const pattern = `%${params.search.trim()}%`

  const result = await query<AdminChatRow>(
    `SELECT p.id                        AS "projectId",
            p.name                      AS "projectName",
            p.user_id                   AS "ownerId",
            u.email                     AS "ownerEmail",
            COALESCE(u.full_name, '')   AS "ownerName",
            COALESCE(p.is_archived, FALSE) AS "isArchived",
            ${TEAM_UNREAD_COUNT_SQL}    AS "unreadCount",
            last_msg.created_at             AS "lastMessageAt",
            last_msg.body                   AS "lastMessageBody",
            last_msg.sender_type            AS "lastMessageSenderType",
            last_msg.sender_name            AS "lastMessageSenderName"
       FROM projects p
       JOIN users u ON u.id = p.user_id
       -- LATERAL, а не GROUP BY: нужна не только дата последнего сообщения, но
       -- и его текст с автором — строка списка показывает, чем разговор
       -- закончился, иначе по ней не понять, ждут ли ответа.
       LEFT JOIN LATERAL (
         SELECT m.body, m.sender_type, m.sender_name, m.created_at
           FROM project_chat_messages m
          WHERE m.project_id = p.id
          ORDER BY m.created_at DESC
          LIMIT 1
       ) last_msg ON TRUE
      WHERE p.deleted_at IS NULL
        AND ($1::text = ''
             OR p.name ILIKE $2
             OR u.email ILIKE $2
             OR COALESCE(u.full_name, '') ILIKE $2)
      ORDER BY last_msg.created_at DESC NULLS LAST,
               p.created_at DESC
      LIMIT $3 OFFSET $4`,
    [params.search.trim(), pattern, params.limit, params.offset],
  )
  return result.rows
}

/**
 * Сколько сообщений клиентов ждут команду по всем проектам сайта — число на
 * значке раздела «Чаты» в боковом меню.
 */
export async function countTeamUnreadTotal(): Promise<number> {
  // Складываем те же самые счётчики по проектам, а не пересчитываем порог для
  // каждого сообщения: проектов на порядок меньше, а определение непрочитанного
  // остаётся ровно одно на весь сайт.
  const result = await query<{ count: number }>(
    `SELECT COALESCE(SUM(unread), 0)::int AS count
       FROM (
         SELECT ${TEAM_UNREAD_COUNT_SQL} AS unread
           FROM projects p
          WHERE p.deleted_at IS NULL
       ) totals`,
  )
  return result.rows[0]?.count ?? 0
}
