import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import { findVersionGraph, syncStageMembers } from "@/lib/repositories/production-pipelines"
import { advanceRun, afterOpen, loadRunContext, resolveStepPaths, type RunContext } from "./flow"
import { isWorkNode, startOf, upgradeGraph, type WorkNode } from "./graph"
import { safeValue, type ResolveError } from "./masks"
import { allowedPeopleIds } from "./people"

/**
 * Запуск ролика — docs/PRODUCTION_PLAN.md §2.1, §9.2.
 *
 * Ролик идёт по текущей версии пайплайна и остаётся на ней до конца (§3.5).
 * Папки-проекты этапов заведены и расшарены при активации (activation.ts) —
 * здесь строки этапов и открытие первых: этапов без входов.
 */

export type LaunchablePipeline = { id: string; name: string; version: number; description: string }

/**
 * Что человек может запустить: активные пайплайны, где он автор, запускающий
 * или редактор из ноды «Старт» (§6.4), не на паузе. С описанием — подсказка в окне запуска.
 */
export async function listLaunchablePipelines(userId: string): Promise<LaunchablePipeline[]> {
  const { rows } = await query<{ id: string; name: string; version: number; graph: unknown }>(
    `SELECT p.id, p.name, p.current_version AS version, p.graph
       FROM production_pipelines p
      WHERE p.status = 'active' AND p.deleted_at IS NULL AND p.current_version IS NOT NULL
        AND p.paused_at IS NULL
        AND (
          p.owner_user_id = $1
          OR EXISTS (
            SELECT 1 FROM production_pipeline_people pp
             WHERE pp.pipeline_id = p.id AND pp.user_id = $1 AND pp.role IN ('launcher', 'editor')
          )
        )
      ORDER BY p.name`,
    [userId],
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    // Описание — настройка на месте: берётся из черновика, а не из версии.
    description: startOf(upgradeGraph(row.graph))?.data.description ?? "",
  }))
}

export type LaunchResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "not-found" | "name-taken" | "storage" }
  | { ok: false; reason: "bad-path"; stage: string; error: ResolveError }

export async function launchRun(input: {
  pipelineId: string
  userId: string
  name: string
  /** `Date.getTimezoneOffset()` у запускающего — часы в масках по его поясу. */
  tzOffsetMin: number
}): Promise<LaunchResult> {
  const launchable = await listLaunchablePipelines(input.userId)
  const pipeline = launchable.find((p) => p.id === input.pipelineId)
  if (!pipeline) return { ok: false, reason: "not-found" }

  const graph = await findVersionGraph(pipeline.id, pipeline.version)
  if (!graph) return { ok: false, reason: "not-found" }
  const owner = await query<{ ownerUserId: string; launcherName: string }>(
    `SELECT p.owner_user_id AS "ownerUserId",
            COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email) AS "launcherName"
       FROM production_pipelines p, users u
      WHERE p.id = $1 AND u.id = $2`,
    [pipeline.id, input.userId],
  )
  const ownerUserId = owner.rows[0]?.ownerUserId
  if (!ownerUserId) return { ok: false, reason: "not-found" }

  const startedAt = new Date()
  const runName = input.name.trim()
  const folderName = safeValue(runName)
  if (!folderName || folderName === "." || folderName === "..") {
    return { ok: false, reason: "bad-path", stage: "", error: { code: "empty-segment", index: 0 } }
  }
  const ctx = {
    pipelineName: pipeline.name,
    runName,
    startedAt,
    tzOffsetMin: input.tzOffsetMin,
    launcherName: owner.rows[0].launcherName,
    graph,
  }

  // Пути всех этапов — вхолостую, сейчас: плохой шаблон должен отказать при
  // запуске, а не на третьем этапе через неделю.
  const stages = graph.nodes.filter(isWorkNode)
  for (const node of stages) {
    const probe = resolveStepPaths(ctx, node, startedAt)
    if (!probe.ok) return { ok: false, reason: "bad-path", stage: node.data.name, error: probe.error }
  }

  // Папки-проекты выбраны при активации; без них этапу некуда писать.
  const projects = new Map(stages.map((n) => [n.id, n.data.project.id]))
  if ([...projects.values()].some((id) => !id)) return { ok: false, reason: "storage" }

  const runId = randomUUID()
  const stepIds = new Map(graph.nodes.map((n) => [n.id, randomUUID()]))

  let opened: string[] = []
  try {
    opened = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO production_runs
           (id, pipeline_id, pipeline_version, name, folder_name, due_at, created_by, created_at, tz_offset_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runId, pipeline.id, pipeline.version, runName, folderName, null, input.userId, startedAt, input.tzOffsetMin],
      )
      for (const node of stages) {
        await client.query(
          `INSERT INTO production_run_steps (id, run_id, node_id, status, paths)
           VALUES ($1, $2, $3, 'waiting', $4::jsonb)`,
          [stepIds.get(node.id), runId, node.id, JSON.stringify({ projectId: projects.get(node.id) })],
        )
      }

      // Чаты этапов: люди этапа из пайплайна — участники по назначению (§7.1).
      // Наблюдатель по умолчанию получает только упоминания.
      await client.query(
        `INSERT INTO production_chat_members (run_step_id, user_id, via, notify)
         SELECT DISTINCT ON (rs.id, pp.user_id)
                rs.id, pp.user_id, 'production',
                CASE WHEN pp.role = 'watcher' THEN 'mentions' ELSE 'all' END
           FROM production_run_steps rs
           JOIN production_pipeline_people pp
             ON pp.pipeline_id = $2 AND pp.node_id = rs.node_id
            AND pp.role IN ('executor', 'reviewer', 'watcher')
          WHERE rs.run_id = $1
          ORDER BY rs.id, pp.user_id, pp.role = 'watcher'
         ON CONFLICT DO NOTHING`,
        [runId, pipeline.id],
      )
      await client.query(
        `INSERT INTO production_events (pipeline_id, run_id, actor_user_id, kind, payload)
         VALUES ($1, $2, $3, 'run_created', $4::jsonb)`,
        [pipeline.id, runId, input.userId, JSON.stringify({ name: runName, version: pipeline.version })],
      )

      const run = (await loadRunContext(client, runId)) as RunContext
      return (await advanceRun(client, run)).opened
    })
  } catch (error) {
    // Индекс `production_runs_folder_idx`: ролик с таким именем в пайплайне уже есть.
    if ((error as { code?: string }).code === "23505") return { ok: false, reason: "name-taken" }
    throw error
  }

  await afterOpen(runId, opened, input.userId)
  return { ok: true, runId }
}

/**
 * Расшарить папки этапов людям этапов. Только добавляя: папку могут делить
 * несколько этапов и пайплайнов, и снять человека с одного этапа не значит
 * закрыть ему папку, где он работает по другому. Люди — из пайплайна, а не из
 * версии: это настройка на месте (§3.5).
 */
export async function shareStageProjects(
  pipelineId: string,
  ownerUserId: string,
  stages: WorkNode[],
  projects: Map<string, string>,
): Promise<void> {
  const allowed = await allowedPeopleIds(ownerUserId)
  const people = await query<{ nodeId: string; userId: string; role: string }>(
    `SELECT node_id AS "nodeId", user_id AS "userId", role FROM production_pipeline_people WHERE pipeline_id = $1`,
    [pipelineId],
  )
  const perProject = new Map<string, Map<string, "viewer" | "commenter" | "editor">>()
  const rank = { viewer: 1, commenter: 2, editor: 3 } as const
  const roleOf = { watcher: "viewer", reviewer: "commenter", executor: "editor" } as const
  for (const stage of stages) {
    const projectId = projects.get(stage.id)
    if (!projectId) continue
    const members = perProject.get(projectId) ?? new Map()
    perProject.set(projectId, members)
    for (const p of people.rows) {
      const role = roleOf[p.role as keyof typeof roleOf]
      if (p.nodeId !== stage.id || !role || !allowed.has(p.userId)) continue
      const prev = members.get(p.userId)
      if (!prev || rank[role] > rank[prev as keyof typeof rank]) members.set(p.userId, role)
    }
  }
  await withTransaction(async (client) => {
    for (const [projectId, members] of perProject) {
      await syncStageMembers(client, {
        projectId,
        ownerUserId,
        invitedBy: ownerUserId,
        desired: [...members].map(([userId, role]) => ({ userId, role })),
        revoke: false,
      })
    }
  })
}

// ─── Управление роликом ─────────────────────────────────────────────────────

export type RunActionResult = { ok: true } | { ok: false; reason: "not-found" | "forbidden" | "closed" }

type RunAccess = { pipelineId: string; status: string; canManage: boolean; canDelete: boolean }

/**
 * Кто что может с роликом. Переименовать и завершить — автор пайплайна,
 * запустивший и проверяющие любого этапа (§4.7). Удалить — только первые двое:
 * удаление стирает журнал и чаты у всех участников. Не участник — «нет такого».
 */
async function runAccess(runId: string, userId: string): Promise<RunAccess | null> {
  const { rows } = await query<RunAccess & { visible: boolean }>(
    `SELECT r.pipeline_id AS "pipelineId", r.status,
            (p.owner_user_id = $2 OR r.created_by = $2) AS "canDelete",
            (p.owner_user_id = $2 OR r.created_by = $2 OR EXISTS (
              SELECT 1 FROM production_pipeline_people pp
               WHERE pp.pipeline_id = p.id AND pp.user_id = $2 AND pp.role = 'reviewer')) AS "canManage",
            (p.owner_user_id = $2 OR r.created_by = $2 OR EXISTS (
              SELECT 1 FROM production_chat_members cm
                JOIN production_run_steps rs ON rs.id = cm.run_step_id
               WHERE rs.run_id = r.id AND cm.user_id = $2 AND cm.left_at IS NULL)) AS visible
       FROM production_runs r
       JOIN production_pipelines p ON p.id = r.pipeline_id
      WHERE r.id = $1`,
    [runId, userId],
  )
  const row = rows[0]
  return row?.visible ? row : null
}

/**
 * Новое имя — только подпись. Папки ролика (`folder_name`) уже заведены во всех
 * этапах, и пути в них не меняются: иначе ролик потерял бы свои файлы.
 */
export async function renameRun(runId: string, userId: string, name: string): Promise<RunActionResult> {
  const access = await runAccess(runId, userId)
  if (!access) return { ok: false, reason: "not-found" }
  if (!access.canManage) return { ok: false, reason: "forbidden" }
  await withTransaction(async (client) => {
    await client.query(`UPDATE production_runs SET name = $2 WHERE id = $1`, [runId, name.trim()])
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, actor_user_id, kind, payload)
       VALUES ($1, $2, $3, 'run_renamed', $4::jsonb)`,
      [access.pipelineId, runId, userId, JSON.stringify({ name: name.trim() })],
    )
  })
  return { ok: true }
}

/**
 * «Завершить» — отмена на полпути (§4.7): ролик уходит в архив как есть, со
 * статусом «отменён». Папки, версии, чаты и журнал остаются. Автоматика по
 * отменённому ролику дальше не идёт — она берёт только активные.
 */
export async function cancelRun(runId: string, userId: string): Promise<RunActionResult> {
  const access = await runAccess(runId, userId)
  if (!access) return { ok: false, reason: "not-found" }
  if (!access.canManage) return { ok: false, reason: "forbidden" }
  const done = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE production_runs
          SET status = 'cancelled', cancelled_by = $2, finished_at = NOW(),
              archived_at = COALESCE(archived_at, NOW())
        WHERE id = $1 AND status = 'active'`,
      [runId, userId],
    )
    if (!rowCount) return false
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, actor_user_id, kind)
       VALUES ($1, $2, $3, 'run_cancelled')`,
      [access.pipelineId, runId, userId],
    )
    return true
  })
  return done ? { ok: true } : { ok: false, reason: "closed" }
}

/**
 * Удаление строк ролика: этапы, чаты и журнал уходят каскадом. Файлы в папках
 * этапов не трогаем — это проекты хранилища, и чистят их там.
 */
export async function deleteRun(runId: string, userId: string): Promise<RunActionResult> {
  const access = await runAccess(runId, userId)
  if (!access) return { ok: false, reason: "not-found" }
  if (!access.canDelete) return { ok: false, reason: "forbidden" }
  await query(`DELETE FROM production_runs WHERE id = $1`, [runId])
  return { ok: true }
}
