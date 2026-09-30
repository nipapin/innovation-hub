import { query, withTransaction } from "@/lib/db"
import { writeProjectMeta } from "@/lib/project-storage"
import { createProject, deleteProject } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import {
  commitVersion,
  findPipeline,
  findVersionGraph,
  replacePipelinePeople,
  type PipelineRecord,
} from "@/lib/repositories/production-pipelines"
import {
  hasErrors,
  isWorkNode,
  normalizeGraph,
  peopleOf,
  structureSignature,
  validateGraph,
  type GraphIssue,
  type PipelineGraph,
  type WorkNode,
} from "./graph"
import { resolvePath } from "./masks"
import { allowedPeopleIds } from "./people"
import { shareStageProjects } from "./runs"

/**
 * Активация пайплайна и новые версии — docs/PRODUCTION_PLAN.md §3.5.
 *
 * Здесь папки-проекты этапов становятся конкретными (решение 2026-10-01): в
 * черновике у ноды может стоять только имя, в том числе `$pipelineName`; при
 * активации и новой версии имя превращается в проект владельца (есть — берётся,
 * нет — создаётся), id записывается в граф, папки расшариваются людям этапов.
 * Ролики, идущие по старым версиям, не трогаются — они привязаны к своей.
 */

export type CommitResult =
  | { ok: true; pipeline: PipelineRecord }
  | { ok: false; reason: "not-found" | "conflict" | "not-draft" | "not-active" | "unchanged" | "storage" | "project" }
  | { ok: false; reason: "invalid"; issues: GraphIssue[] }

export async function activatePipeline(input: {
  pipelineId: string
  userId: string
  baseRevision: number
}): Promise<CommitResult> {
  const pipeline = await findPipeline(input.pipelineId, input.userId)
  if (!pipeline) return { ok: false, reason: "not-found" }
  if (pipeline.status !== "draft") return { ok: false, reason: "not-draft" }
  return commit(pipeline, input, 1)
}

/**
 * Зафиксировать новую версию структуры активного пайплайна. Без структурных
 * изменений — отказ: версия, неотличимая от прошлой, только засоряла бы список.
 */
export async function commitNewVersion(input: {
  pipelineId: string
  userId: string
  baseRevision: number
}): Promise<CommitResult> {
  const pipeline = await findPipeline(input.pipelineId, input.userId)
  if (!pipeline) return { ok: false, reason: "not-found" }
  if (pipeline.status !== "active" || pipeline.currentVersion == null) {
    return { ok: false, reason: "not-active" }
  }
  if (!(await structureChanged(pipeline))) return { ok: false, reason: "unchanged" }
  return commit(pipeline, input, pipeline.currentVersion + 1)
}

/** Отличается ли черновик от текущей версии по структуре (§3.5). */
export async function structureChanged(pipeline: PipelineRecord): Promise<boolean> {
  if (pipeline.currentVersion == null) return false
  const current = await findVersionGraph(pipeline.id, pipeline.currentVersion)
  if (!current) return true
  return structureSignature(normalizeGraph(pipeline.graph)) !== structureSignature(current)
}

/**
 * Люди — настройка на месте (§3.5): записываются сразу и сразу расшаривают
 * папки этапов идущих роликов. Черновик людей не записывает: людей пайплайна
 * пока нет, и запускать по нему нечего.
 */
export async function applyPeopleInPlace(pipeline: PipelineRecord): Promise<void> {
  if (pipeline.status !== "active") return
  const allowed = await allowedPeopleIds(pipeline.ownerUserId)
  await withTransaction(async (client) => {
    await replacePipelinePeople(
      client,
      pipeline.id,
      pipeline.ownerUserId,
      peopleOf(pipeline.graph).filter((p) => allowed.has(p.userId)),
    )
  })
  await shareStageProjects(pipeline.id, pipeline.ownerUserId, pipeline.graph.nodes.filter(isWorkNode), projectMap(pipeline.graph))
}

function projectMap(graph: PipelineGraph): Map<string, string> {
  const out = new Map<string, string>()
  for (const n of graph.nodes) if (isWorkNode(n) && n.data.project.id) out.set(n.id, n.data.project.id)
  return out
}

async function commit(
  pipeline: PipelineRecord,
  input: { userId: string; baseRevision: number },
  version: number,
): Promise<CommitResult> {
  if (pipeline.revision !== input.baseRevision) return { ok: false, reason: "conflict" }

  const issues = validateGraph(normalizeGraph(pipeline.graph))
  if (hasErrors(issues)) return { ok: false, reason: "invalid", issues }

  // Папки — до транзакции: запись в R2 в неё не входит. Созданная папка сразу
  // пишется в граф, так что повтор после сбоя возьмёт её же, а не заведёт вторую.
  const resolved = await resolveStageProjects(pipeline)
  if (!resolved.ok) return resolved
  const graph = normalizeGraph(resolved.graph)

  // Круг людей (§6.1): граф приходит с клиента, и назначить в нём можно было
  // кого угодно. Вне круга — не записываем.
  const allowed = await allowedPeopleIds(pipeline.ownerUserId)

  const committed = await withTransaction(async (client) => {
    const ok = await commitVersion(client, {
      pipelineId: pipeline.id,
      userId: input.userId,
      baseRevision: input.baseRevision,
      version,
      graph,
    })
    if (!ok) return false
    await replacePipelinePeople(
      client,
      pipeline.id,
      pipeline.ownerUserId,
      peopleOf(graph).filter((p) => allowed.has(p.userId)),
    )
    return true
  })
  if (!committed) return { ok: false, reason: "conflict" }
  await shareStageProjects(pipeline.id, pipeline.ownerUserId, graph.nodes.filter(isWorkNode), projectMap(graph))

  const fresh = await findPipeline(pipeline.id, input.userId)
  return fresh ? { ok: true, pipeline: fresh } : { ok: false, reason: "not-found" }
}

/**
 * Имя папки → проект владельца (§2.2). Выбранный проект должен быть его и не в
 * корзине: чужой проект пайплайн расшарить не может (решение 2026-10-01 —
 * пока только свои папки). Несколько этапов с одним именем — один проект.
 */
async function resolveStageProjects(
  pipeline: PipelineRecord,
): Promise<{ ok: true; graph: PipelineGraph } | { ok: false; reason: "storage" | "project" }> {
  const cache = new Map<string, string>()
  const nodes: PipelineGraph["nodes"] = []
  for (const n of pipeline.graph.nodes) {
    if (!isWorkNode(n)) {
      nodes.push(n)
      continue
    }
    const project = n.data.project
    if (project.id) {
      const { rowCount } = await query(
        `SELECT 1 FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [project.id, pipeline.ownerUserId],
      )
      if (!rowCount) return { ok: false, reason: "project" }
      nodes.push(n)
      continue
    }
    const name = resolvePath([project.name], { pipelineName: pipeline.name }, "project")
    if (!name.ok) return { ok: false, reason: "project" }
    const key = name.path.toLowerCase()
    let id = cache.get(key)
    if (!id) {
      const found = await query<{ id: string }>(
        `SELECT id FROM projects
          WHERE user_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`,
        [pipeline.ownerUserId, name.path],
      )
      id = found.rows[0]?.id ?? (await createStageProject(pipeline.ownerUserId, name.path)) ?? undefined
      if (!id) return { ok: false, reason: "storage" }
      cache.set(key, id)
    }
    nodes.push({ ...n, data: { ...n.data, project: { id, name: name.path } } } as WorkNode)
  }
  return { ok: true, graph: { ...pipeline.graph, nodes } }
}

/** Новый проект тем же путём, что обычный: строка, `project-meta.json`, при отказе R2 — откат. */
async function createStageProject(ownerUserId: string, name: string): Promise<string | null> {
  if (!isS3Configured()) return null
  const owner = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [ownerUserId])
  const project = await createProject({ userId: ownerUserId, name })
  try {
    await writeProjectMeta({
      storageOwnerId: project.storageOwnerId,
      ownerId: project.userId,
      projectId: project.id,
      name: project.name,
      description: project.description,
      ownerEmail: owner.rows[0]?.email ?? "",
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("[production] project-meta.json для папки этапа не записался", error)
    await deleteProject(project.id, ownerUserId).catch(() => {})
    return null
  }
  return project.id
}
