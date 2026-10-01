import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query } from "@/lib/db"
import { upgradeGraph, type PipelineGraph } from "@/lib/production/graph"
import type { PipelineSettings } from "@/lib/production/schemas"

/**
 * Пайплайны производства — docs/PRODUCTION_PLAN.md §2.1, §3.5.
 *
 * Пайплайн принадлежит автору, править его может ещё и редактор из ноды
 * «Старт» (§6.4). Остальным он не виден вовсе: каждый запрос скоупится по
 * `CAN_EDIT`, как проекты по `user_id`.
 *
 * Граф при чтении приводится к текущей схеме (`upgradeGraph`): версии,
 * зафиксированные по схеме 1, не переписываются.
 */

/** Автор или редактор пайплайна `p`; `$2` — человек. */
const CAN_EDIT = `(p.owner_user_id = $2 OR EXISTS (
  SELECT 1 FROM production_pipeline_people pe
   WHERE pe.pipeline_id = p.id AND pe.user_id = $2 AND pe.role = 'editor'))`

function upgraded(row: PipelineRecord): PipelineRecord {
  return { ...row, graph: upgradeGraph(row.graph) }
}

const FIELDS = `
  p.id,
  p.owner_user_id AS "ownerUserId",
  p.name,
  p.graph,
  p.revision,
  p.current_version AS "currentVersion",
  p.status,
  p.settings,
  p.created_at AS "createdAt",
  p.updated_at AS "updatedAt",
  p.activated_at AS "activatedAt",
  p.archived_at AS "archivedAt",
  p.paused_at AS "pausedAt",
  (SELECT COUNT(*)::int FROM production_runs r
    WHERE r.pipeline_id = p.id AND r.status = 'active') AS "activeRuns"
`

export type PipelineStatus = "draft" | "active" | "archived"

export type PipelineRecord = {
  id: string
  ownerUserId: string
  name: string
  graph: PipelineGraph
  revision: number
  currentVersion: number | null
  status: PipelineStatus
  settings: PipelineSettings
  createdAt: string
  updatedAt: string
  activatedAt: string | null
  archivedAt: string | null
  /** Запуски на паузе: новых роликов нет, идущие доживают. */
  pausedAt: string | null
  /** Сколько роликов по нему сейчас в производстве — счётчик на карточке (§9.2). */
  activeRuns: number
}

export async function listPipelines(userId: string): Promise<PipelineRecord[]> {
  const { rows } = await query<PipelineRecord>(
    `SELECT ${FIELDS} FROM production_pipelines p
      WHERE $1::text IS NOT NULL AND ${CAN_EDIT.replaceAll("$2", "$1")} AND p.deleted_at IS NULL
      ORDER BY p.status = 'archived', p.updated_at DESC`,
    [userId],
  )
  return rows.map(upgraded)
}

/** Пайплайн, который человек может править: автор или редактор. */
export async function findPipeline(id: string, userId: string): Promise<PipelineRecord | null> {
  const { rows } = await query<PipelineRecord>(
    `SELECT ${FIELDS} FROM production_pipelines p
      WHERE p.id = $1 AND ${CAN_EDIT} AND p.deleted_at IS NULL`,
    [id, userId],
  )
  return rows[0] ? upgraded(rows[0]) : null
}

/** Пайплайн без проверки прав — для фоновых проходов и запуска после своей проверки. */
export async function findPipelineById(id: string): Promise<PipelineRecord | null> {
  const { rows } = await query<PipelineRecord>(
    `SELECT ${FIELDS} FROM production_pipelines p WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id],
  )
  return rows[0] ? upgraded(rows[0]) : null
}

export async function createPipeline(input: {
  ownerUserId: string
  name: string
  graph: PipelineGraph
  settings: PipelineSettings
}): Promise<PipelineRecord> {
  const id = randomUUID()
  await query(
    `INSERT INTO production_pipelines (id, owner_user_id, name, graph, settings, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $2)`,
    [id, input.ownerUserId, input.name, JSON.stringify(input.graph), JSON.stringify(input.settings)],
  )
  return (await findPipeline(id, input.ownerUserId))!
}

export type SaveResult =
  | { ok: true; pipeline: PipelineRecord }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "conflict"; current: PipelineRecord }

/**
 * Сохранить черновик: имя, граф, настройки, архив. Оптимистическая блокировка
 * по `revision`, как у общих словарей: `UPDATE … WHERE revision = $base`.
 * Не совпало — отдаём текущее состояние, чтобы редактор показал, что изменилось.
 *
 * `revision` растёт на каждую запись, даже если содержимое то же: это счётчик
 * блокировки, а не хеш состояния.
 */
export async function savePipeline(input: {
  id: string
  userId: string
  baseRevision: number
  name?: string
  graph?: PipelineGraph
  settings?: PipelineSettings
  archived?: boolean
  paused?: boolean
}): Promise<SaveResult> {
  const { rowCount } = await query(
    `UPDATE production_pipelines p
        SET name = COALESCE($4, name),
            graph = COALESCE($5::jsonb, graph),
            settings = COALESCE($6::jsonb, settings),
            status = CASE
              WHEN $7::boolean IS TRUE THEN 'archived'
              WHEN $7::boolean IS FALSE AND status = 'archived'
                THEN CASE WHEN current_version IS NULL THEN 'draft' ELSE 'active' END
              ELSE status
            END,
            archived_at = CASE
              WHEN $7::boolean IS TRUE THEN COALESCE(archived_at, NOW())
              WHEN $7::boolean IS FALSE THEN NULL
              ELSE archived_at
            END,
            paused_at = CASE
              WHEN $8::boolean IS TRUE THEN COALESCE(paused_at, NOW())
              WHEN $8::boolean IS FALSE THEN NULL
              ELSE paused_at
            END,
            revision = revision + 1,
            updated_at = NOW()
      WHERE p.id = $1 AND ${CAN_EDIT} AND p.deleted_at IS NULL AND p.revision = $3`,
    [
      input.id,
      input.userId,
      input.baseRevision,
      input.name ?? null,
      input.graph ? JSON.stringify(input.graph) : null,
      input.settings ? JSON.stringify(input.settings) : null,
      input.archived ?? null,
      input.paused ?? null,
    ],
  )
  const current = await findPipeline(input.id, input.userId)
  if (!current) return { ok: false, reason: "not-found" }
  if (rowCount === 0) return { ok: false, reason: "conflict", current }
  return { ok: true, pipeline: current }
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "active-runs" }

/**
 * Удалить можно, только когда по пайплайну не идут ролики (§3.5): иначе сначала
 * архив. Удаление мягкое — папки этапов и история роликов остаются.
 */
export async function deletePipeline(id: string, userId: string): Promise<DeleteResult> {
  const { rowCount } = await query(
    `UPDATE production_pipelines p
        SET deleted_at = NOW(), updated_at = NOW()
      WHERE p.id = $1 AND ${CAN_EDIT} AND p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM production_runs r
           WHERE r.pipeline_id = p.id AND r.status = 'active'
        )`,
    [id, userId],
  )
  if (rowCount && rowCount > 0) return { ok: true }
  const current = await findPipeline(id, userId)
  return { ok: false, reason: current ? "active-runs" : "not-found" }
}

// ─── Активация и версии (§3.5) ────────────────────────────────────────────

/** Папки этапов пайплайна: нода → проект. Одна на ноду во всех версиях. */
export async function listStepProjects(pipelineId: string): Promise<Map<string, string>> {
  const { rows } = await query<{ nodeId: string; projectId: string }>(
    `SELECT node_id AS "nodeId", project_id AS "projectId"
       FROM production_pipeline_steps
      WHERE pipeline_id = $1 AND project_id IS NOT NULL`,
    [pipelineId],
  )
  return new Map(rows.map((row) => [row.nodeId, row.projectId]))
}

/**
 * Записать связь сразу после создания папки, до остальной активации: упади
 * активация дальше, повтор не заведёт вторую папку тому же этапу.
 */
export async function linkStepProject(
  pipelineId: string,
  nodeId: string,
  projectId: string,
): Promise<void> {
  await query(
    `INSERT INTO production_pipeline_steps (pipeline_id, node_id, project_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (pipeline_id, node_id) DO UPDATE SET project_id = EXCLUDED.project_id`,
    [pipelineId, nodeId, projectId],
  )
}

export async function findVersionGraph(
  pipelineId: string,
  version: number,
): Promise<PipelineGraph | null> {
  const { rows } = await query<{ graph: PipelineGraph }>(
    `SELECT graph FROM production_pipeline_versions WHERE pipeline_id = $1 AND version = $2`,
    [pipelineId, version],
  )
  return rows[0] ? upgradeGraph(rows[0].graph) : null
}

/**
 * Люди пайплайна — зеркало графа (§3.5: правятся на месте и действуют сразу).
 * Заменяются целиком. Неизвестные id отбрасываются запросом: граф приходит с
 * клиента, и строка на несуществующего человека уронила бы вставку по FK.
 */
export async function replacePipelinePeople(
  client: PoolClient,
  pipelineId: string,
  addedBy: string,
  people: { nodeId: string; userId: string; role: string }[],
): Promise<void> {
  await client.query(`DELETE FROM production_pipeline_people WHERE pipeline_id = $1`, [pipelineId])
  if (people.length === 0) return
  await client.query(
    `INSERT INTO production_pipeline_people (pipeline_id, node_id, user_id, role, added_by)
     SELECT $1, p.node_id, p.user_id, p.role, $2
       FROM UNNEST($3::text[], $4::text[], $5::text[]) AS p(node_id, user_id, role)
      WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id AND u.is_active)
     ON CONFLICT DO NOTHING`,
    [
      pipelineId,
      addedBy,
      people.map((p) => p.nodeId),
      people.map((p) => p.userId),
      people.map((p) => p.role),
    ],
  )
}

/** Старшинство ролей участника — та же лестница, что в lib/project-roles.ts. */
const RANK_SQL = (column: string) =>
  `CASE ${column} WHEN 'full' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END`

/**
 * Расшарить папку этапа людям этапа (§6.1): исполнитель — редактор,
 * проверяющий — комментатор, наблюдатель — читатель. Всё с `via = 'production'`.
 *
 * Трогаются только строки, выданные пайплайном:
 *   - такая строка получает ровно ту роль, что велит пайплайн (могли и понизить);
 *   - ручное «Поделиться» (`share`) пайплайн не понижает, но может поднять;
 *   - убранного из ноды снимается только доступ `production` — ручной остаётся.
 * Владельцу проекта строк не пишем: он владелец, а не участник.
 */
export async function syncStageMembers(
  client: PoolClient,
  input: {
    projectId: string
    ownerUserId: string
    invitedBy: string
    desired: { userId: string; role: "viewer" | "commenter" | "editor" }[]
    /** Снимать ли доступ `production` у тех, кого нет в `desired`. По умолчанию — да. */
    revoke?: boolean
  },
): Promise<void> {
  const desired = input.desired.filter((d) => d.userId !== input.ownerUserId)
  if (desired.length > 0) {
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role, invited_by, via)
       SELECT $1, d.user_id, d.role, $2, 'production'
         FROM UNNEST($3::text[], $4::text[]) AS d(user_id, role)
        WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id AND u.is_active)
       ON CONFLICT (project_id, user_id) DO UPDATE SET
         role = CASE
           WHEN project_members.via = 'production' THEN EXCLUDED.role
           WHEN ${RANK_SQL("EXCLUDED.role")} > ${RANK_SQL("project_members.role")} THEN EXCLUDED.role
           ELSE project_members.role
         END,
         via = CASE WHEN project_members.via = 'mention' THEN 'production' ELSE project_members.via END`,
      [input.projectId, input.invitedBy, desired.map((d) => d.userId), desired.map((d) => d.role)],
    )
  }
  if (input.revoke === false) return
  await client.query(
    `DELETE FROM project_members
      WHERE project_id = $1 AND via = 'production' AND NOT (user_id = ANY($2::text[]))`,
    [input.projectId, desired.map((d) => d.userId)],
  )
}

/**
 * Зафиксировать версию и сделать её текущей — одним шагом с проверкой
 * `revision`. Не совпала — кто-то правил параллельно, и фиксировать нечего:
 * человек фиксировал бы не то, что видел.
 */
export async function commitVersion(
  client: PoolClient,
  input: {
    pipelineId: string
    userId: string
    baseRevision: number
    version: number
    graph: PipelineGraph
  },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE production_pipelines p
        SET graph = $4::jsonb,
            current_version = $5,
            status = 'active',
            activated_at = COALESCE(activated_at, NOW()),
            revision = revision + 1,
            updated_at = NOW()
      WHERE p.id = $1 AND ${CAN_EDIT} AND p.revision = $3 AND p.deleted_at IS NULL`,
    [input.pipelineId, input.userId, input.baseRevision, JSON.stringify(input.graph), input.version],
  )
  if (!rowCount) return false
  await client.query(
    `INSERT INTO production_pipeline_versions (pipeline_id, version, graph, created_by)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [input.pipelineId, input.version, JSON.stringify(input.graph), input.userId],
  )
  return true
}
