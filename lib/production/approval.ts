import { query, withTransaction } from "@/lib/db"
import { findProjectById } from "@/lib/repositories/projects"
import { copySingleFile, loadCopySource } from "@/lib/storage/copy"
import { insertSystem } from "./chat"
import { advanceRun, afterOpen, copyInputs, copyTree, listTree, loadRunContext, type FolderFile } from "./flow"
import { formStatus } from "./form"
import { isWorkNode } from "./graph"
import { canSeeStep, listFolderFiles, loadStep, type StepRow } from "./workspace"

/**
 * Приёмка этапа и передача дальше — docs/PRODUCTION_PLAN.md §4.1, §4.4.
 *
 * Что уходит в финальную папку, зависит от типа этапа:
 *
 * - «Инструмент» — один вариант: последний из чата или выбранный «⋯ → Принять
 *   этот вариант»;
 * - «Форма» — вся рабочая папка со структурой, и только когда выполнены все
 *   строки формы;
 * - «Автоматика» — результаты задач конвейера (`paths.auto.results`, их находит
 *   lib/production/machines.ts); пока их нет — вся рабочая папка со структурой.
 *   С проверяющим «автоматика» этап принимается сам, без человека.
 *
 * Этап закрывается, и открываются следующие, у которых приняты все входы.
 */

export type ApproveResult =
  | { ok: true; fileId: string | null; runDone: boolean }
  | {
      ok: false
      reason: "not-found" | "not-reviewer" | "closed" | "no-variant" | "not-a-variant" | "form-incomplete" | "storage"
    }

/** Принимает проверяющий этапа или автор пайплайна — назначение, а не доступ к папке (§6.3). */
async function isReviewer(step: StepRow, userId: string): Promise<boolean> {
  if (step.ownerUserId === userId) return true
  const { rowCount } = await query(
    `SELECT 1 FROM production_pipeline_people
      WHERE pipeline_id = $1 AND node_id = $2 AND user_id = $3 AND role = 'reviewer'`,
    [step.pipelineId, step.nodeId, userId],
  )
  return Boolean(rowCount)
}

export async function approveStep(input: {
  stepId: string
  /** `null` — принимает автоматика (проверяющий этапа — «автоматика»). */
  userId: string | null
  /** Выбранный вариант «Инструмента»; не задан — последний в рабочей папке. */
  fileId?: string
}): Promise<ApproveResult> {
  const step = await loadStep(input.stepId)
  if (!step) return { ok: false, reason: "not-found" }
  if (input.userId && !(await canSeeStep(step, input.userId))) return { ok: false, reason: "not-found" }
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (!isWorkNode(node) || node.kind === "action") return { ok: false, reason: "not-found" }
  if (step.status !== "ready") return { ok: false, reason: "closed" }
  if (input.userId === null ? !(node.kind === "auto" && node.data.autoApprove) : !(await isReviewer(step, input.userId))) {
    return { ok: false, reason: "not-reviewer" }
  }

  const projectId = step.projectId ?? undefined
  const work = step.paths?.work
  const final = step.paths?.final
  if (!projectId || !work || !final) return { ok: false, reason: "not-found" }

  // Что принимаем — до захвата: отказ не должен оставлять этап принятым.
  let variant: { id: string; name: string } | null = null
  const results = node.kind === "auto" ? step.paths?.auto?.results : undefined
  const tree = node.kind === "tool" ? [] : results ? await filesById(projectId, results) : await listTree(projectId, work)
  if (node.kind === "tool") {
    const variants = await listFolderFiles(projectId, work)
    variant = (input.fileId ? variants.find((f) => f.id === input.fileId) : variants[0]) ?? null
    if (!variant) return { ok: false, reason: input.fileId ? "not-a-variant" : "no-variant" }
  } else if (node.kind === "form") {
    if (!formStatus(node.data.rows, work, tree).complete) return { ok: false, reason: "form-incomplete" }
  } else if (tree.length === 0) {
    return { ok: false, reason: "no-variant" }
  }

  // Захват: `ready → approved` одним запросом. Два проверяющих, нажавших разом,
  // не примут этап дважды — второй получит «закрыт».
  const claimed = await query(
    `UPDATE production_run_steps
        SET status = 'approved', approved_by = $2, approved_at = NOW()
      WHERE id = $1 AND status = 'ready'`,
    [step.id, input.userId],
  )
  if (!claimed.rowCount) return { ok: false, reason: "closed" }

  // Копия в финальную папку — тем же путём, что и остальной сайт: папка по
  // пути, свободное имя, журнал изменений. Автор копии — автор файла.
  let copiedId: string | null = null
  try {
    if (variant) {
      const project = await findProjectById(projectId)
      const source = await loadCopySource(projectId, variant.id)
      if (!project || !source) throw new Error("source vanished")
      const copied = await copySingleFile({
        sourceProjectId: projectId,
        destProjectId: projectId,
        destStorageOwnerId: project.storageOwnerId,
        destFolderPath: final,
        source,
        actor: { userId: input.userId, isUploader: true },
        keepUploader: true,
      })
      copiedId = copied.id
    } else {
      await copyTree({
        sourceProjectId: projectId,
        // Результат обработки может лежать и вне рабочей папки — тогда он
        // ложится в Final своим путём от корня проекта.
        root: tree.every((f) => f.folderPath === work || f.folderPath.startsWith(`${work}/`)) ? work : "",
        files: tree,
        destProjectId: projectId,
        base: final,
        actorId: input.userId,
      })
    }
  } catch (error) {
    console.error("[production] копия принятого в финальную папку не удалась", error)
    await query(
      `UPDATE production_run_steps SET status = 'ready', approved_by = NULL, approved_at = NULL WHERE id = $1`,
      [step.id],
    )
    return { ok: false, reason: "storage" }
  }

  const { runDone, opened } = await withTransaction(async (client) => {
    if (variant && copiedId) {
      await client.query(`UPDATE production_run_steps SET approved_file_id = $2 WHERE id = $1`, [step.id, copiedId])
      await client.query(
        `INSERT INTO production_file_links (from_file_id, to_file_id, kind, run_step_id)
         VALUES ($1, $2, 'approved', $3)`,
        [variant.id, copiedId, step.id],
      )
    }
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, run_step_id, actor_user_id, kind, payload)
       VALUES ($1, $2, $3, $4, 'approved', $5::jsonb)`,
      [
        step.pipelineId,
        step.runId,
        step.id,
        input.userId,
        JSON.stringify(
          variant
            ? { fileId: copiedId, variantId: variant.id, name: variant.name, latest: !input.fileId }
            : { files: tree.length },
        ),
      ],
    )
    await insertSystem(client, step, input.userId ? "approved" : "auto_approved", {
      actorId: input.userId,
      name: variant?.name ?? String(tree.length),
    })
    const ctx = await loadRunContext(client, step.runId)
    return ctx ? advanceRun(client, ctx) : { runDone: false, opened: [] }
  })

  await afterOpen(step.runId, opened, input.userId)
  return { ok: true, fileId: copiedId, runDone }
}

export type RerunResult = { ok: true; files: number } | { ok: false; reason: "not-found" | "not-reviewer" | "closed" }

/**
 * «Ещё раз» у автоматики (§3.2г): вход копируется в папку обработки заново, и
 * машины обрабатывают весь материал ещё раз. Жмёт проверяющий, когда результат
 * не годится.
 */
export async function rerunAuto(stepId: string, userId: string): Promise<RerunResult> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return { ok: false, reason: "not-found" }
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (node?.kind !== "auto") return { ok: false, reason: "not-found" }
  if (step.status !== "ready") return { ok: false, reason: "closed" }
  if (!(await isReviewer(step, userId))) return { ok: false, reason: "not-reviewer" }

  const ctx = await loadRunContext(null, step.runId)
  if (!ctx) return { ok: false, reason: "not-found" }
  const files = await copyInputs(ctx, step.id, userId, (step.paths?.auto?.attempt ?? 1) + 1)
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, run_step_id, actor_user_id, kind, payload)
       VALUES ($1, $2, $3, $4, 'rerun', $5::jsonb)`,
      [step.pipelineId, step.runId, step.id, userId, JSON.stringify({ files })],
    )
    await insertSystem(client, step, "rerun", { actorId: userId })
  })
  return { ok: true, files }
}

/** Файлы по id — результаты обработки, найденные по `outFiles` задач. */
export async function filesById(projectId: string, ids: string[]): Promise<FolderFile[]> {
  if (ids.length === 0) return []
  const { rows } = await query<FolderFile>(
    `SELECT id, name, folder_path AS "folderPath", content_type AS "contentType"
       FROM project_files
      WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
    [projectId, ids],
  )
  return rows
}
