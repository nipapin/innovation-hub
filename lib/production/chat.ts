import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import { sendPushToUser } from "@/lib/push"
import { listPipelinePeople } from "./people"
import { canSeeStep, loadStep, type StepRow } from "./workspace"

/**
 * Чат этапа ролика — docs/PRODUCTION_PLAN.md §7, этап 2.
 *
 * Своя переписка у этапа каждого ролика, без YouGile. Участники — таблица
 * `production_chat_members`; прочтение — отметкой на человека
 * (`last_read_message_id`), «кто прочитал» — участники с отметкой не меньше id.
 * Вложения лежат в рабочей папке этапа (§2.3) — это и есть варианты.
 */

export const REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "✅", "❗"] as const

export type ChatAttachment = {
  fileId: string
  name: string
  s3Key: string
  contentType: string
  sizeBytes: number
}

export type ChatMessage = {
  id: number
  authorId: string | null
  authorName: string | null
  kind: "text" | "system" | "review_ref"
  body: string
  attachments: ChatAttachment[]
  /** Для системных — событие и его подробности (имя файла, кто). */
  event: { type: string; actorName?: string; targetName?: string; name?: string } | null
  mentions: string[]
  replyTo: { id: number; authorName: string | null; body: string } | null
  createdAt: string
  editedAt: string | null
  deleted: boolean
  reactions: { emoji: string; userIds: string[] }[]
}

export type ChatMember = {
  userId: string
  name: string
  via: "production" | "invite" | "mention"
  notify: "all" | "mentions" | "none"
  following: boolean
  lastReadId: number
}

export type ChatAccess = {
  step: StepRow
  /** Строка участника; `null` у автора пайплайна, который не в чате. */
  member: ChatMember | null
  isOwner: boolean
}

const NAME = (alias: string) =>
  `COALESCE(NULLIF(TRIM(${alias}.contact_name), ''), NULLIF(TRIM(${alias}.full_name), ''), ${alias}.email)`

// ─── Доступ ───────────────────────────────────────────────────────────────

export async function getChatAccess(stepId: string, userId: string): Promise<ChatAccess | null> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return null
  const members = await listMembers(stepId)
  return {
    step,
    member: members.find((m) => m.userId === userId) ?? null,
    isOwner: step.ownerUserId === userId,
  }
}

/**
 * Автор пайплайна может писать в любой чат своих роликов; первое его сообщение
 * делает его участником — иначе ему не придут ответы.
 */
async function ensureMember(client: PoolClient, stepId: string, userId: string, via: ChatMember["via"]) {
  await client.query(
    `INSERT INTO production_chat_members (run_step_id, user_id, via)
     VALUES ($1, $2, $3)
     ON CONFLICT (run_step_id, user_id) DO UPDATE SET left_at = NULL`,
    [stepId, userId, via],
  )
}

// ─── Участники ────────────────────────────────────────────────────────────

export async function listMembers(stepId: string): Promise<ChatMember[]> {
  const { rows } = await query<ChatMember>(
    `SELECT cm.user_id AS "userId", ${NAME("u")} AS name, cm.via, cm.notify, cm.following,
            cm.last_read_message_id::int AS "lastReadId"
       FROM production_chat_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.run_step_id = $1 AND cm.left_at IS NULL
      ORDER BY cm.joined_at`,
    [stepId],
  )
  return rows
}

// ─── Сообщения ────────────────────────────────────────────────────────────

type MessageRow = {
  id: number
  authorId: string | null
  authorName: string | null
  kind: ChatMessage["kind"]
  body: string
  payload: {
    attachments?: ChatAttachment[]
    event?: ChatMessage["event"]
    mentions?: string[]
  }
  replyTo: number | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

export async function listMessages(
  stepId: string,
  opts: { before?: number; after?: number; limit?: number } = {},
): Promise<ChatMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200)
  const { rows } = await query<MessageRow>(
    `SELECT * FROM (
       SELECT m.id::int, m.author_id AS "authorId", ${NAME("u")} AS "authorName", m.kind, m.body,
              m.payload, m.reply_to::int AS "replyTo", m.created_at AS "createdAt",
              m.edited_at AS "editedAt", m.deleted_at AS "deletedAt"
         FROM production_messages m
         LEFT JOIN users u ON u.id = m.author_id
        WHERE m.run_step_id = $1
          AND ($2::bigint IS NULL OR m.id < $2)
          AND ($3::bigint IS NULL OR m.id > $3)
        ORDER BY m.id ${opts.after ? "ASC" : "DESC"}
        LIMIT $4
     ) page ORDER BY id ASC`,
    [stepId, opts.before ?? null, opts.after ?? null, limit],
  )
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const replyIds = rows.map((r) => r.replyTo).filter((id): id is number => id != null)
  const [reactions, replies] = await Promise.all([
    query<{ messageId: number; emoji: string; userId: string }>(
      `SELECT message_id::int AS "messageId", emoji, user_id AS "userId"
         FROM production_message_reactions
        WHERE message_id = ANY($1::bigint[])
        ORDER BY created_at`,
      [ids],
    ),
    replyIds.length
      ? query<{ id: number; authorName: string | null; body: string; deletedAt: string | null }>(
          `SELECT m.id::int, ${NAME("u")} AS "authorName", m.body, m.deleted_at AS "deletedAt"
             FROM production_messages m LEFT JOIN users u ON u.id = m.author_id
            WHERE m.id = ANY($1::bigint[])`,
          [replyIds],
        )
      : Promise.resolve({ rows: [] as { id: number; authorName: string | null; body: string; deletedAt: string | null }[] }),
  ])

  const byMessage = new Map<number, Map<string, string[]>>()
  for (const r of reactions.rows) {
    const map = byMessage.get(r.messageId) ?? new Map<string, string[]>()
    map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.userId])
    byMessage.set(r.messageId, map)
  }
  const replyById = new Map(replies.rows.map((r) => [r.id, r]))

  return rows.map((row) => {
    const deleted = row.deletedAt != null
    const reply = row.replyTo != null ? replyById.get(row.replyTo) : undefined
    return {
      id: row.id,
      authorId: row.authorId,
      authorName: row.authorName,
      kind: row.kind,
      body: deleted ? "" : row.body,
      attachments: deleted ? [] : (row.payload.attachments ?? []),
      event: row.payload.event ?? null,
      mentions: row.payload.mentions ?? [],
      replyTo: reply
        ? { id: reply.id, authorName: reply.authorName, body: reply.deletedAt ? "" : reply.body.slice(0, 200) }
        : null,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deleted,
      reactions: [...(byMessage.get(row.id) ?? new Map())].map(([emoji, userIds]) => ({ emoji, userIds })),
    }
  })
}

export type PostResult =
  | { ok: true; id: number }
  | { ok: false; reason: "empty" | "bad-attachment" | "bad-reply" }

/**
 * Сообщение. Вложения — файлы рабочей папки этого этапа, уже залитые этим же
 * человеком (роут `upload/complete`); чужие или из другой папки не принимаются.
 * Упомянутые не-участники становятся участниками (§6.1: `@` — приглашение), но
 * только из круга автора сообщения.
 */
export async function postMessage(input: {
  access: ChatAccess
  userId: string
  body: string
  attachmentIds: string[]
  replyTo?: number
  mentions: string[]
}): Promise<PostResult> {
  const body = input.body.trim()
  if (!body && input.attachmentIds.length === 0) return { ok: false, reason: "empty" }
  const { step } = input.access

  let attachments: ChatAttachment[] = []
  if (input.attachmentIds.length > 0) {
    if (!step.projectId || !step.paths) return { ok: false, reason: "bad-attachment" }
    const { rows } = await query<ChatAttachment>(
      `SELECT id AS "fileId", name, s3_key AS "s3Key", content_type AS "contentType",
              size_bytes::float8 AS "sizeBytes"
         FROM project_files
        WHERE id = ANY($1::text[]) AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder
          AND uploaded_by = $4
          AND (folder_path = $3 OR starts_with(folder_path, $3 || '/'))`,
      [input.attachmentIds, step.projectId, step.paths.work, input.userId],
    )
    if (rows.length !== input.attachmentIds.length) return { ok: false, reason: "bad-attachment" }
    attachments = input.attachmentIds.map((id) => rows.find((r) => r.fileId === id)!)
  }

  if (input.replyTo != null) {
    const { rowCount } = await query(
      `SELECT 1 FROM production_messages WHERE id = $1 AND run_step_id = $2`,
      [input.replyTo, step.id],
    )
    if (!rowCount) return { ok: false, reason: "bad-reply" }
  }

  // Упоминания: участник — уведомление; не-участник из круга автора — приглашение.
  const members = await listMembers(step.id)
  const memberIds = new Set(members.map((m) => m.userId))
  const circle = new Set((await listPipelinePeople(input.userId)).map((p) => p.id))
  const mentions = [...new Set(input.mentions)].filter((id) => memberIds.has(id) || circle.has(id))
  const invited = mentions.filter((id) => !memberIds.has(id))

  const id = await withTransaction(async (client) => {
    if (!input.access.member) await ensureMember(client, step.id, input.userId, "production")
    for (const userId of invited) {
      await ensureMember(client, step.id, userId, "mention")
      await insertSystem(client, step, "member_joined", { actorId: input.userId, targetId: userId })
    }
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO production_messages (run_step_id, author_id, kind, body, payload, reply_to)
       VALUES ($1, $2, 'text', $3, $4::jsonb, $5) RETURNING id::int`,
      [step.id, input.userId, body, JSON.stringify({ attachments, mentions }), input.replyTo ?? null],
    )
    // Своё сообщение прочитано автором.
    await client.query(
      `UPDATE production_chat_members SET last_read_message_id = GREATEST(last_read_message_id, $3)
        WHERE run_step_id = $1 AND user_id = $2`,
      [step.id, input.userId, rows[0].id],
    )
    await client.query(`SELECT pg_notify('production_chat', $1)`, [
      JSON.stringify({ stepId: step.id, type: "message" }),
    ])
    return rows[0].id
  })

  void pushAboutMessage({ step, authorId: input.userId, body, attachments, mentions }).catch((error) =>
    console.error("[production] push о сообщении не ушёл", error),
  )
  return { ok: true, id }
}

/**
 * Push участникам: `all` — о каждом сообщении, `mentions` — только когда
 * упомянули. Без слежения и с `none` — ничего. Автору — ничего.
 */
async function pushAboutMessage(input: {
  step: StepRow
  authorId: string
  body: string
  attachments: ChatAttachment[]
  mentions: string[]
}) {
  const members = await listMembers(input.step.id)
  const author = members.find((m) => m.userId === input.authorId)?.name ?? ""
  const node = input.step.graph.nodes.find((n) => n.id === input.step.nodeId)
  const title = `${input.step.runName} · ${node?.data.name ?? ""}`
  const text = input.body || input.attachments.map((a) => a.name).join(", ")
  for (const m of members) {
    if (m.userId === input.authorId || !m.following || m.notify === "none") continue
    if (m.notify === "mentions" && !input.mentions.includes(m.userId)) continue
    await sendPushToUser(m.userId, {
      title,
      body: `${author}: ${text}`.slice(0, 180),
      url: `/account/production?step=${encodeURIComponent(input.step.id)}`,
    })
  }
}

// ─── Системные сообщения ──────────────────────────────────────────────────

/**
 * Системное сообщение в чат этапа — из того же события, что пишется в журнал
 * (§7.1). Имена кладутся при записи: переименованный или удалённый аккаунт не
 * должен переписывать историю.
 */
export async function insertSystem(
  client: PoolClient,
  step: { id: string } | string,
  type: string,
  details: { actorId?: string | null; targetId?: string; name?: string } = {},
) {
  const stepId = typeof step === "string" ? step : step.id
  const ids = [details.actorId, details.targetId].filter((x): x is string => Boolean(x))
  const names = ids.length
    ? new Map(
        (
          await client.query<{ id: string; name: string }>(
            `SELECT id, ${NAME("users")} AS name FROM users WHERE id = ANY($1::text[])`,
            [ids],
          )
        ).rows.map((r) => [r.id, r.name]),
      )
    : new Map<string, string>()
  const event = {
    type,
    actorName: details.actorId ? names.get(details.actorId) : undefined,
    targetName: details.targetId ? names.get(details.targetId) : undefined,
    name: details.name,
  }
  await client.query(
    `INSERT INTO production_messages (run_step_id, author_id, kind, body, payload)
     VALUES ($1, NULL, 'system', '', $2::jsonb)`,
    [stepId, JSON.stringify({ event })],
  )
  await client.query(`SELECT pg_notify('production_chat', $1)`, [JSON.stringify({ stepId, type: "message" })])
}

// ─── Прочтение, реакции ───────────────────────────────────────────────────

export async function markRead(stepId: string, userId: string, lastId: number): Promise<void> {
  const { rowCount } = await query(
    `UPDATE production_chat_members
        SET last_read_message_id = GREATEST(last_read_message_id, LEAST($3, (
          SELECT COALESCE(MAX(id), 0) FROM production_messages WHERE run_step_id = $1)))
      WHERE run_step_id = $1 AND user_id = $2 AND left_at IS NULL
        AND last_read_message_id < $3`,
    [stepId, userId, lastId],
  )
  if (rowCount) {
    await query(`SELECT pg_notify('production_chat', $1)`, [JSON.stringify({ stepId, type: "read" })])
  }
}

export async function toggleReaction(input: {
  stepId: string
  userId: string
  messageId: number
  emoji: string
}): Promise<boolean> {
  if (!(REACTIONS as readonly string[]).includes(input.emoji)) return false
  const { rowCount: exists } = await query(
    `SELECT 1 FROM production_messages WHERE id = $1 AND run_step_id = $2 AND deleted_at IS NULL`,
    [input.messageId, input.stepId],
  )
  if (!exists) return false
  const removed = await query(
    `DELETE FROM production_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [input.messageId, input.userId, input.emoji],
  )
  if (!removed.rowCount) {
    await query(
      `INSERT INTO production_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [input.messageId, input.userId, input.emoji],
    )
  }
  await query(`SELECT pg_notify('production_chat', $1)`, [
    JSON.stringify({ stepId: input.stepId, type: "reaction" }),
  ])
  return true
}

/** Удалить своё сообщение: текст и вложения скрываются, место в ленте остаётся. */
export async function deleteOwnMessage(stepId: string, userId: string, messageId: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE production_messages SET deleted_at = NOW()
      WHERE id = $1 AND run_step_id = $2 AND author_id = $3 AND deleted_at IS NULL`,
    [messageId, stepId, userId],
  )
  if (rowCount) {
    await query(`SELECT pg_notify('production_chat', $1)`, [JSON.stringify({ stepId, type: "message" })])
  }
  return Boolean(rowCount)
}

// ─── Приглашение, выход, настройки ────────────────────────────────────────

export type InviteResult = { ok: true } | { ok: false; reason: "outside" | "already" }

/** Позвать в чат (§6.1): только из своей компании или своих контактов. */
export async function inviteToChat(access: ChatAccess, inviterId: string, userId: string): Promise<InviteResult> {
  const members = await listMembers(access.step.id)
  if (members.some((m) => m.userId === userId)) return { ok: false, reason: "already" }
  const circle = await listPipelinePeople(inviterId)
  if (!circle.some((p) => p.id === userId)) return { ok: false, reason: "outside" }
  await withTransaction(async (client) => {
    await ensureMember(client, access.step.id, userId, "invite")
    await client.query(
      `UPDATE production_chat_members SET invited_by = $3 WHERE run_step_id = $1 AND user_id = $2`,
      [access.step.id, userId, inviterId],
    )
    await insertSystem(client, access.step, "member_joined", { actorId: inviterId, targetId: userId })
  })
  return { ok: true }
}

export type LeaveResult = { ok: true } | { ok: false; reason: "not-member" | "executor-marked" | "last-reviewer" }

/**
 * Выйти из чата (§7.1): исполнитель, отметившийся на открытом этапе, — нельзя,
 * пока не снимет отметку; последний проверяющий этапа — нельзя. Остальные — в
 * любой момент. Доступ к папке по назначению не снимается.
 */
export async function leaveChat(access: ChatAccess, userId: string): Promise<LeaveResult> {
  if (!access.member) return { ok: false, reason: "not-member" }
  const { step } = access
  if (step.status === "ready") {
    const { rowCount: marked } = await query(
      `SELECT 1 FROM production_run_step_executors WHERE run_step_id = $1 AND user_id = $2`,
      [step.id, userId],
    )
    if (marked) return { ok: false, reason: "executor-marked" }
  }
  const reviewers = await query<{ userId: string }>(
    `SELECT pp.user_id AS "userId"
       FROM production_pipeline_people pp
       JOIN production_chat_members cm ON cm.user_id = pp.user_id AND cm.run_step_id = $3 AND cm.left_at IS NULL
      WHERE pp.pipeline_id = $1 AND pp.node_id = $2 AND pp.role = 'reviewer'`,
    [step.pipelineId, step.nodeId, step.id],
  )
  const reviewerIds = reviewers.rows.map((r) => r.userId)
  if (reviewerIds.length === 1 && reviewerIds[0] === userId) return { ok: false, reason: "last-reviewer" }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE production_chat_members SET left_at = NOW() WHERE run_step_id = $1 AND user_id = $2`,
      [step.id, userId],
    )
    await insertSystem(client, step, "member_left", { actorId: userId })
  })
  return { ok: true }
}

export async function setMemberPrefs(
  stepId: string,
  userId: string,
  prefs: { notify?: ChatMember["notify"]; following?: boolean },
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE production_chat_members
        SET notify = COALESCE($3, notify), following = COALESCE($4, following)
      WHERE run_step_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [stepId, userId, prefs.notify ?? null, prefs.following ?? null],
  )
  return Boolean(rowCount)
}

/** Непрочитанное по этапам — для счётчиков в списке роликов. Без слежения — ноль. */
export async function unreadByStep(userId: string, stepIds: string[]): Promise<Map<string, number>> {
  if (stepIds.length === 0) return new Map()
  const { rows } = await query<{ stepId: string; n: number }>(
    `SELECT cm.run_step_id AS "stepId", COUNT(m.id)::int AS n
       FROM production_chat_members cm
       JOIN production_messages m
         ON m.run_step_id = cm.run_step_id AND m.id > cm.last_read_message_id
        AND m.deleted_at IS NULL AND (m.author_id IS NULL OR m.author_id <> cm.user_id)
      WHERE cm.user_id = $1 AND cm.left_at IS NULL AND cm.following
        AND cm.run_step_id = ANY($2::text[])
      GROUP BY cm.run_step_id`,
    [userId, stepIds],
  )
  return new Map(rows.map((r) => [r.stepId, r.n]))
}
