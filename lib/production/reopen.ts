import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import { insertSystem } from "./chat"
import { advanceRun, afterOpen, hasChat, loadRunContext } from "./flow"
import { isWorkNode, successors, type PipelineGraph } from "./graph"
import { safeValue } from "./masks"
import { hasStepRole } from "./step-people"
import { canSeeStep, loadStep, type StepRow } from "./workspace"

/**
 * Возврат к принятому этапу — два пути, как в git:
 *
 * - **Вернуть в работу**: этап снова открыт, результат заменят. Все этапы после
 *   него закрываются; уже принятые помечаются «переделать» (`paths.redo`) и
 *   пройдут заново, когда до них дойдёт. Готовый ролик возвращается из архива.
 * - **Ветка отсюда** (§4.6): новый ролик «… · ветка N» по той же версии.
 *   Этапы до этого берутся из исходного ролика как есть (`inherited` — его
 *   папки и приёмки), этот и следующие идут заново в своих папках, со своими
 *   чатами. Исходный ролик не трогается.
 *
 * Право — то же, что принимать: проверяющий этапа или автор пайплайна.
 */

/** Все этапы после `nodeId` по связям графа — без него самого. */
function downstream(graph: PipelineGraph, nodeId: string): Set<string> {
  const out = new Set<string>()
  const queue = successors(graph, nodeId)
  while (queue.length > 0) {
    const id = queue.shift()!
    if (out.has(id)) continue
    out.add(id)
    queue.push(...successors(graph, id))
  }
  return out
}

async function canReturn(step: StepRow, userId: string): Promise<boolean> {
  return step.ownerUserId === userId || hasStepRole(step, userId, "reviewer")
}

async function runStatus(runId: string): Promise<string | null> {
  const { rows } = await query<{ status: string }>(`SELECT status FROM production_runs WHERE id = $1`, [runId])
  return rows[0]?.status ?? null
}

export type ReopenResult =
  | { ok: true; redo: number }
  | { ok: false; reason: "not-found" | "forbidden" | "not-approved" | "cancelled" }

export async function reopenStep(stepId: string, userId: string): Promise<ReopenResult> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return { ok: false, reason: "not-found" }
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (!isWorkNode(node) || node.kind === "action") return { ok: false, reason: "not-found" }
  if (step.status !== "approved") return { ok: false, reason: "not-approved" }
  if ((await runStatus(step.runId)) === "cancelled") return { ok: false, reason: "cancelled" }
  if (!(await canReturn(step, userId))) return { ok: false, reason: "forbidden" }

  const after = [...downstream(step.graph, step.nodeId)]
  const redo = await withTransaction(async (client) => {
    const reopened = await client.query(
      `UPDATE production_run_steps
          SET status = 'ready', approved_by = NULL, approved_at = NULL, approved_file_id = NULL
        WHERE id = $1 AND status = 'approved'`,
      [step.id],
    )
    if (!reopened.rowCount) return null
    // Принятые после него — «переделать»; открытые — снова ждут входа.
    const marked = await client.query<{ id: string; nodeId: string }>(
      `UPDATE production_run_steps
          SET status = 'waiting', approved_by = NULL, approved_at = NULL, approved_file_id = NULL,
              paths = CASE WHEN status = 'approved'
                           THEN COALESCE(paths, '{}'::jsonb) || '{"redo": true}'::jsonb
                           ELSE paths END
        WHERE run_id = $1 AND node_id = ANY($2::text[]) AND status IN ('approved', 'ready')
        RETURNING id, node_id AS "nodeId", (paths->>'redo') = 'true' AS redo`,
      [step.runId, after],
    )
    await client.query(
      `UPDATE production_runs SET status = 'active', finished_at = NULL, archived_at = NULL
        WHERE id = $1 AND status = 'done'`,
      [step.runId],
    )
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, run_step_id, actor_user_id, kind, payload)
       VALUES ($1, $2, $3, $4, 'reopened', $5::jsonb)`,
      [step.pipelineId, step.runId, step.id, userId, JSON.stringify({ closed: marked.rows.map((r) => r.id) })],
    )
    if (hasChat(node)) await insertSystem(client, step, "reopened", { actorId: userId })
    for (const row of marked.rows) {
      const next = step.graph.nodes.find((n) => n.id === row.nodeId)
      if (isWorkNode(next) && hasChat(next)) {
        await insertSystem(client, row.id, "redo_needed", { actorId: userId, name: node.data.name })
      }
    }
    return marked.rowCount ?? 0
  })
  if (redo === null) return { ok: false, reason: "not-approved" }
  return { ok: true, redo }
}

export type BranchResult =
  | { ok: true; runId: string; stepId: string }
  | { ok: false; reason: "not-found" | "forbidden" | "not-approved" | "storage" }

/**
 * Ветка ролика от этапа K. Имя — «<ролик> · ветка N», N — следующий свободный
 * номер среди веток этого ролика (с 2: исходный — первая).
 */
export async function branchFromStep(stepId: string, userId: string): Promise<BranchResult> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return { ok: false, reason: "not-found" }
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (!isWorkNode(node) || node.kind === "action") return { ok: false, reason: "not-found" }
  if (step.status !== "approved" && step.status !== "inherited") return { ok: false, reason: "not-approved" }
  if (!(await canReturn(step, userId))) return { ok: false, reason: "forbidden" }

  const parent = await query<{ version: number; tzOffsetMin: number; branches: number }>(
    `SELECT r.pipeline_version AS version, r.tz_offset_min AS "tzOffsetMin",
            (SELECT COUNT(*)::int FROM production_runs c WHERE c.parent_run_id = r.id) AS branches
       FROM production_runs r WHERE r.id = $1`,
    [step.runId],
  )
  const run = parent.rows[0]
  if (!run) return { ok: false, reason: "not-found" }

  const parentSteps = await query<{ id: string; nodeId: string; status: string; paths: unknown; approvedFileId: string | null }>(
    `SELECT id, node_id AS "nodeId", status, paths, approved_file_id AS "approvedFileId"
       FROM production_run_steps WHERE run_id = $1`,
    [step.runId],
  )
  const byNode = new Map(parentSteps.rows.map((s) => [s.nodeId, s]))
  const fresh = downstream(step.graph, step.nodeId).add(step.nodeId)
  const stages = step.graph.nodes.filter(isWorkNode)

  const runId = randomUUID()
  const stepIds = new Map(stages.map((n) => [n.id, randomUUID()]))
  let opened: string[] = []
  let made = false
  // Имя могли занять параллельно — следующий номер, несколько попыток.
  for (let n = run.branches + 2; n < run.branches + 7 && !made; n += 1) {
    const name = `${step.runName} · ветка ${n}`
    const folderName = safeValue(name)
    try {
      opened = await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO production_runs
             (id, pipeline_id, pipeline_version, name, folder_name, due_at, created_by, created_at, tz_offset_min,
              parent_run_id, branched_from_node)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, NOW(), $7, $8, $9)`,
          [runId, step.pipelineId, run.version, name, folderName, userId, run.tzOffsetMin, step.runId, step.nodeId],
        )
        for (const stage of stages) {
          const prev = byNode.get(stage.id)
          // До K — из исходного ролика: его папки, его приёмка. Не принятое там
          // (параллельная ветка ещё идёт) — проходится в ветке заново.
          const inherit = !fresh.has(stage.id) && prev && (prev.status === "approved" || prev.status === "inherited")
          await client.query(
            `INSERT INTO production_run_steps (id, run_id, node_id, status, paths, inherited_from, approved_file_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [
              stepIds.get(stage.id),
              runId,
              stage.id,
              inherit ? "inherited" : "waiting",
              JSON.stringify(inherit ? prev.paths : { projectId: (prev?.paths as { projectId?: string } | null)?.projectId ?? stage.data.project.id }),
              inherit ? prev.id : null,
              inherit ? prev.approvedFileId : null,
            ],
          )
        }
        // Чаты — у этапов, которые ветка проходит сама; люди — из пайплайна.
        await client.query(
          `INSERT INTO production_chat_members (run_step_id, user_id, via, notify)
           SELECT DISTINCT ON (rs.id, pp.user_id)
                  rs.id, pp.user_id, 'production',
                  CASE WHEN pp.role = 'watcher' THEN 'mentions' ELSE 'all' END
             FROM production_run_steps rs
             JOIN production_pipeline_people pp
               ON pp.pipeline_id = $2 AND pp.node_id = rs.node_id
              AND pp.role IN ('executor', 'reviewer', 'watcher')
            WHERE rs.run_id = $1 AND rs.status <> 'inherited'
            ORDER BY rs.id, pp.user_id, pp.role = 'watcher'
           ON CONFLICT DO NOTHING`,
          [runId, step.pipelineId],
        )
        await client.query(
          `INSERT INTO production_events (pipeline_id, run_id, actor_user_id, kind, payload)
           VALUES ($1, $2, $3, 'run_branched', $4::jsonb)`,
          [step.pipelineId, runId, userId, JSON.stringify({ name, parentRunId: step.runId, fromNode: step.nodeId })],
        )
        const ctx = await loadRunContext(client, runId)
        return ctx ? (await advanceRun(client, ctx)).opened : []
      })
      made = true
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error
    }
  }
  if (!made) return { ok: false, reason: "storage" }

  await afterOpen(runId, opened, userId)
  return { ok: true, runId, stepId: stepIds.get(step.nodeId)! }
}
