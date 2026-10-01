import { query, withTransaction } from "@/lib/db"
import { insertSystem } from "./chat"
import { allowedPeopleIds } from "./people"
import type { StepRow } from "./workspace"

/**
 * Люди этапа ролика — люди пайплайна плюс добавленные «+» на рабочем месте
 * (`production_run_step_people`). Добавленный есть только в этом этапе этого
 * ролика; нужен везде — правят пайплайн.
 */

export type StepRole = "executor" | "reviewer"

/** Назначен ли человек на этап в этой роли — пайплайном или в этом ролике. */
export async function hasStepRole(
  step: Pick<StepRow, "id" | "pipelineId" | "nodeId">,
  userId: string,
  role: StepRole,
): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM production_pipeline_people
      WHERE pipeline_id = $1 AND node_id = $2 AND user_id = $4 AND role = $5
     UNION ALL
     SELECT 1 FROM production_run_step_people
      WHERE run_step_id = $3 AND user_id = $4 AND role = $5`,
    [step.pipelineId, step.nodeId, step.id, userId, role],
  )
  return Boolean(rowCount)
}

/** Добавленные в этот этап этого ролика. */
export async function listAddedPeople(stepId: string): Promise<{ userId: string; role: StepRole }[]> {
  const { rows } = await query<{ userId: string; role: StepRole }>(
    `SELECT user_id AS "userId", role FROM production_run_step_people
      WHERE run_step_id = $1 ORDER BY added_at`,
    [stepId],
  )
  return rows
}

/**
 * Добавлять и убирать людей ролика может тот, кто им управляет: автор
 * пайплайна, запустивший и проверяющий этого этапа.
 */
export async function canEditStepPeople(step: StepRow, userId: string): Promise<boolean> {
  if (step.ownerUserId === userId || step.runCreatedBy === userId) return true
  return hasStepRole(step, userId, "reviewer")
}

export type StepPersonResult = { ok: true } | { ok: false; reason: "forbidden" | "outside" | "closed" | "not-found" }

/**
 * Добавить человека в этап ролика: роль, участие в чате и доступ к папке этапа
 * (исполнитель — правка, проверяющий — комментарии), как при запуске. Только из
 * круга автора пайплайна — того же, из которого назначают в редакторе (§6.1).
 */
export async function addStepPerson(
  step: StepRow,
  actorId: string,
  userId: string,
  role: StepRole,
): Promise<StepPersonResult> {
  if (step.status === "approved" || step.status === "inherited") return { ok: false, reason: "closed" }
  if (!(await canEditStepPeople(step, actorId))) return { ok: false, reason: "forbidden" }
  if (!(await allowedPeopleIds(step.ownerUserId)).has(userId)) return { ok: false, reason: "outside" }

  await withTransaction(async (client) => {
    const added = await client.query(
      `INSERT INTO production_run_step_people (run_step_id, user_id, role, added_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [step.id, userId, role, actorId],
    )
    if (!added.rowCount) return
    const joined = await client.query(
      `INSERT INTO production_chat_members (run_step_id, user_id, via, notify)
       VALUES ($1, $2, 'production', 'all')
       ON CONFLICT (run_step_id, user_id) DO UPDATE SET left_at = NULL
       WHERE production_chat_members.left_at IS NOT NULL`,
      [step.id, userId],
    )
    if (joined.rowCount) await insertSystem(client, step.id, "member_joined", { actorId, targetId: userId })
    // Доступ к папке только повышается: у человека он мог уже быть шире.
    if (step.projectId && userId !== step.ownerUserId) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, via)
         VALUES ($1, $2, $3, $4, 'production')
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = CASE
           WHEN (CASE EXCLUDED.role WHEN 'full' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END)
              > (CASE project_members.role WHEN 'full' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END)
           THEN EXCLUDED.role ELSE project_members.role END`,
        [step.projectId, userId, role === "executor" ? "editor" : "commenter", step.ownerUserId],
      )
    }
  })
  return { ok: true }
}

/**
 * Убрать добавленного в ролике. Людей пайплайна отсюда не убрать — они правятся
 * в пайплайне. Отметку «делаю» исполнитель теряет вместе с ролью; чат и доступ
 * к папке остаются — как при правке людей пайплайна.
 */
export async function removeStepPerson(
  step: StepRow,
  actorId: string,
  userId: string,
  role: StepRole,
): Promise<StepPersonResult> {
  if (step.status === "approved" || step.status === "inherited") return { ok: false, reason: "closed" }
  if (!(await canEditStepPeople(step, actorId))) return { ok: false, reason: "forbidden" }
  const removed = await query(
    `DELETE FROM production_run_step_people WHERE run_step_id = $1 AND user_id = $2 AND role = $3`,
    [step.id, userId, role],
  )
  if (!removed.rowCount) return { ok: false, reason: "not-found" }
  if (role === "executor" && !(await hasStepRole(step, userId, "executor"))) {
    await query(`DELETE FROM production_run_step_executors WHERE run_step_id = $1 AND user_id = $2`, [step.id, userId])
  }
  return { ok: true }
}
