import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import { findProjectById } from "@/lib/repositories/projects"
import { copySingleFile, loadCopySource } from "@/lib/storage/copy"
import { writeEnsureFolderPath } from "@/lib/storage/write-path"
import { insertSystem } from "./chat"
import {
  isWorkNode,
  lastStages,
  orderedStages,
  predecessors,
  upgradeGraph,
  type PipelineGraph,
  type WorkNode,
} from "./graph"
import { resolvePath, type MaskContext, type ResolveError } from "./masks"

/**
 * Движение ролика по пайплайну — docs/PRODUCTION_PLAN.md §4.1, §4.4.
 *
 * Этап открывается, когда приняты все его входы. В момент открытия:
 *
 * - пути этапа считаются по маскам и замораживаются в `production_run_steps.paths`
 *   (`$stageTime` — это время и есть, поэтому не раньше);
 * - если у этапа задана входная папка, финалы предыдущих этапов копируются в
 *   неё со своей структурой: от пути отрезается всё до финальной папки
 *   источника (`…/этап1/final/123/4.mp4` → `IN/123/4.mp4`); файлов несколько —
 *   они ложатся в подпапку ролика (`IN/<ролик>/123/4.mp4`);
 * - у формы заводятся папки её строк;
 * - действие выполняется сразу и принимается само.
 *
 * Переходы статусов — в транзакции; работа с хранилищем — после неё
 * (`afterOpen`): запись в R2 в транзакцию не входит.
 */

type Client = PoolClient

/** Пути этапа ролика: проект, рабочая и финальная папки, входные — по источникам. */
export type StepPaths = {
  projectId?: string
  work?: string
  final?: string
  /** Входная папка на каждый этап-источник; пусто — входы по ссылке. */
  inputs?: Record<string, string>
  /** Пути не посчитались — этап открыт, но папок у него нет. */
  error?: ResolveError
  /** Автоматика: что положено в `IN` и что с этим сделал конвейер (lib/production/machines.ts). */
  auto?: AutoTracking
  /**
   * Этап был принят, но этап до него вернули в работу — его надо пройти
   * заново (lib/production/reopen.ts). Снимается приёмкой.
   */
  redo?: boolean
}

/**
 * Элемент в `IN`, за которым следит этап автоматики. Конвейер берёт в работу
 * верхний уровень `IN` (lib/pipeline/scan.ts, `resolveInEntry`): файл прямо в
 * `IN` — задача по `source_file_id`, папка — задача по имени папки.
 */
export type AutoEntry = { fileId: string } | { folder: string }

export type AutoTracking = {
  /** Номер захода: «Ещё раз» кладёт вход новой папкой, чтобы конвейер завёл новую задачу. */
  attempt: number
  since: string
  entries: AutoEntry[]
  /** Уже объявленные в чате события `taskId:status` — чтобы не повторяться. */
  notified: string[]
  /** Результаты обработки, когда все они доехали на сайт: id файлов. */
  results?: string[]
}

export type RunContext = {
  runId: string
  pipelineId: string
  pipelineName: string
  ownerUserId: string
  runName: string
  folderName: string
  startedAt: Date
  tzOffsetMin: number
  createdBy: string | null
  launcherName: string
  graph: PipelineGraph
}

export async function loadRunContext(client: Client | null, runId: string): Promise<RunContext | null> {
  const run = client ? client.query.bind(client) : query
  const { rows } = await run<Omit<RunContext, "graph"> & { graph: unknown }>(
    `SELECT r.id AS "runId", r.pipeline_id AS "pipelineId", p.name AS "pipelineName",
            p.owner_user_id AS "ownerUserId", r.name AS "runName", r.folder_name AS "folderName",
            r.created_at AS "startedAt", r.tz_offset_min AS "tzOffsetMin", r.created_by AS "createdBy",
            COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email, '') AS "launcherName",
            v.graph
       FROM production_runs r
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v
         ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.id = $1`,
    [runId],
  )
  const row = rows[0]
  if (!row) return null
  return { ...row, graph: upgradeGraph(row.graph) }
}

export function maskContext(ctx: Pick<RunContext, "pipelineName" | "runName" | "startedAt" | "tzOffsetMin" | "launcherName">): MaskContext {
  return {
    pipelineName: ctx.pipelineName,
    runName: ctx.runName,
    runStartedAt: new Date(ctx.startedAt),
    tzOffsetMin: ctx.tzOffsetMin,
    user: ctx.launcherName,
  }
}

/**
 * Пути этапа по маскам. Чистая функция: её же зовёт запуск ролика «вхолостую»,
 * чтобы плохой шаблон отказал сразу, а не на третьем этапе.
 */
export function resolveStepPaths(
  ctx: Pick<RunContext, "pipelineName" | "runName" | "startedAt" | "tzOffsetMin" | "launcherName" | "graph">,
  node: WorkNode,
  stageStartedAt: Date,
): { ok: true; paths: Omit<StepPaths, "projectId"> } | { ok: false; error: ResolveError } {
  const stageNum = orderedStages(ctx.graph).findIndex((n) => n.id === node.id) + 1
  const base: MaskContext = {
    ...maskContext(ctx),
    stageName: node.data.name,
    stageNum,
    stageStartedAt,
  }
  const out: Omit<StepPaths, "projectId"> = {}
  if (node.kind !== "action") {
    const work = resolvePath(node.data.paths.work, base)
    if (!work.ok) return work
    out.work = work.path
  }
  const final = resolvePath(node.data.paths.final, base)
  if (!final.ok) return final
  out.final = final.path

  if (node.data.paths.in.length > 0) {
    out.inputs = {}
    const byId = new Map(ctx.graph.nodes.map((n) => [n.id, n]))
    for (const prevId of predecessors(ctx.graph, node.id)) {
      const prev = byId.get(prevId)
      if (!isWorkNode(prev)) continue
      const input = resolvePath(node.data.paths.in, { ...base, prevStageName: prev.data.name }, "input")
      if (!input.ok) return input
      out.inputs[prevId] = input.path
    }
  }
  return { ok: true, paths: out }
}

// ─── Открытие этапов ──────────────────────────────────────────────────────

/** Есть ли у этапа чат: у действия и у автоматики без людей его нет (§3.2). */
export function hasChat(node: WorkNode): boolean {
  if (node.kind === "action") return false
  if (node.kind === "auto") return node.data.reviewers.length > 0 || node.data.watchers.length > 0
  return true
}

/**
 * Открыть этап: статус и пути. Проект этапа уже записан в `paths.projectId`
 * при запуске ролика — здесь к нему добавляются папки.
 */
export async function openStep(
  client: Client,
  ctx: RunContext,
  row: { id: string; nodeId: string },
  actorId: string | null = null,
): Promise<void> {
  const node = ctx.graph.nodes.find((n) => n.id === row.nodeId)
  if (!isWorkNode(node)) return
  const now = new Date()
  const resolved = resolveStepPaths(ctx, node, now)
  if (!resolved.ok) console.error("[production] пути этапа не посчитались", row.id, resolved.error)
  const patch = resolved.ok ? resolved.paths : { error: resolved.error }
  await client.query(
    `UPDATE production_run_steps
        SET status = 'ready', ready_at = $2,
            paths = COALESCE(paths, '{}'::jsonb) || $3::jsonb
      WHERE id = $1`,
    [row.id, now, JSON.stringify(patch)],
  )
  await client.query(
    `INSERT INTO production_events (pipeline_id, run_id, run_step_id, kind) VALUES ($1, $2, $3, 'step_ready')`,
    [ctx.pipelineId, ctx.runId, row.id],
  )
  await markSoleExecutor(client, ctx.pipelineId, row.id, row.nodeId)
  if (hasChat(node)) await insertSystem(client, row.id, "step_ready", { actorId })
}

/**
 * Исполнитель у этапа один — он и делает, отмечаться ему незачем: этап
 * назначается на него сам. Повторный вызов ничего не меняет.
 */
export async function markSoleExecutor(
  client: Client,
  pipelineId: string,
  stepId: string,
  nodeId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO production_run_step_executors (run_step_id, user_id)
     SELECT $3, MIN(user_id) FROM production_pipeline_people
      WHERE pipeline_id = $1 AND node_id = $2 AND role = 'executor'
     HAVING COUNT(*) = 1
     ON CONFLICT DO NOTHING`,
    [pipelineId, nodeId, stepId],
  )
}

/**
 * Открыть этапы, у которых приняты все входы (§3.3: слияние ждёт все); этап без
 * входов — первый, он открывается сразу. Приняты все последние этапы (без
 * исходящих связей) — ролик сдан и уходит в архив у всех (§4.7).
 */
export async function advanceRun(
  client: Client,
  ctx: RunContext,
): Promise<{ runDone: boolean; opened: string[] }> {
  const { rows } = await client.query<{ id: string; nodeId: string; status: string }>(
    `SELECT id, node_id AS "nodeId", status FROM production_run_steps WHERE run_id = $1 FOR UPDATE`,
    [ctx.runId],
  )
  const byNode = new Map(rows.map((r) => [r.nodeId, r]))
  const done = (nodeId: string) => {
    const s = byNode.get(nodeId)?.status
    return s === "approved" || s === "inherited"
  }

  const opened: string[] = []
  for (const node of ctx.graph.nodes) {
    const row = byNode.get(node.id)
    if (!isWorkNode(node) || !row || row.status !== "waiting") continue
    if (!predecessors(ctx.graph, node.id).every(done)) continue
    await openStep(client, ctx, row)
    row.status = "ready"
    opened.push(row.id)
  }

  const last = lastStages(ctx.graph)
  const runDone = last.size > 0 && [...last].every(done)
  if (runDone) {
    const { rowCount } = await client.query(
      `UPDATE production_runs
          SET status = 'done', finished_at = NOW(), archived_at = COALESCE(archived_at, NOW())
        WHERE id = $1 AND status = 'active'`,
      [ctx.runId],
    )
    if (rowCount) {
      await client.query(`INSERT INTO production_events (pipeline_id, run_id, kind) VALUES ($1, $2, 'run_done')`, [
        ctx.pipelineId,
        ctx.runId,
      ])
    }
  }
  return { runDone, opened }
}

// ─── Файлы ────────────────────────────────────────────────────────────────

export type FolderFile = {
  id: string
  name: string
  folderPath: string
  contentType: string
}

/** Файлы папки проекта — рекурсивно, с путём, чтобы сохранить структуру при копии. */
export async function listTree(projectId: string | undefined, folder: string | undefined): Promise<FolderFile[]> {
  if (!projectId || !folder) return []
  const { rows } = await query<FolderFile>(
    `SELECT id, name, folder_path AS "folderPath", content_type AS "contentType"
       FROM project_files
      WHERE project_id = $1 AND deleted_at IS NULL AND NOT is_folder
        AND (folder_path = $2 OR folder_path LIKE $3)
      ORDER BY folder_path, name
      LIMIT 5000`,
    [projectId, folder, `${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
  )
  return rows
}

/** Путь файла относительно папки-корня: всё до неё отрезается (§4.4). */
export function relativeFolder(root: string, folderPath: string): string {
  if (!root) return folderPath
  if (folderPath === root) return ""
  return folderPath.startsWith(`${root}/`) ? folderPath.slice(root.length + 1) : ""
}

const join = (...parts: string[]) => parts.filter(Boolean).join("/")

/**
 * Скопировать файлы в проект, раскладывая по `base/<относительный путь>`.
 * Автор копии — автор оригинала: в статистике файл остаётся за тем, кто его сделал.
 */
export async function copyTree(input: {
  sourceProjectId: string
  root: string
  files: FolderFile[]
  destProjectId: string
  base: string
  actorId: string | null
}): Promise<string[]> {
  const project = await findProjectById(input.destProjectId)
  if (!project) throw new Error("destination project vanished")
  const copied: string[] = []
  for (const file of input.files) {
    const source = await loadCopySource(input.sourceProjectId, file.id)
    if (!source) continue
    const result = await copySingleFile({
      sourceProjectId: input.sourceProjectId,
      destProjectId: project.id,
      destStorageOwnerId: project.storageOwnerId,
      destFolderPath: join(input.base, relativeFolder(input.root, file.folderPath)),
      source,
      actor: { userId: input.actorId, isUploader: true },
      keepUploader: true,
    })
    copied.push(result.id)
  }
  return copied
}

export type StepState = {
  id: string
  nodeId: string
  status: string
  paths: StepPaths | null
}

async function runSteps(runId: string): Promise<Map<string, StepState>> {
  const { rows } = await query<StepState>(
    `SELECT id, node_id AS "nodeId", status, paths FROM production_run_steps WHERE run_id = $1`,
    [runId],
  )
  return new Map(rows.map((r) => [r.nodeId, r]))
}

/**
 * Скопировать финалы предыдущих этапов во входную папку этапа. Один файл на
 * всех — прямо в папку; несколько — в подпапку ролика, со своей структурой.
 */
export async function copyInputs(
  ctx: RunContext,
  stepId: string,
  actorId: string | null,
  attempt = 1,
): Promise<number> {
  const steps = await runSteps(ctx.runId)
  const step = [...steps.values()].find((s) => s.id === stepId)
  const inputs = step?.paths?.inputs
  if (!step?.paths?.projectId || !inputs) return 0
  // Повтор — в новую папку ролика: старая уже обработана, и конвейер второй
  // раз её не возьмёт.
  const folderName = attempt > 1 ? `${ctx.folderName} (${attempt})` : ctx.folderName
  const entries = new Map<string, AutoEntry>()
  const sources = await Promise.all(
    Object.keys(inputs).map(async (prevId) => {
      const prev = steps.get(prevId)
      const files = await listTree(prev?.paths?.projectId, prev?.paths?.final)
      return { prevId, prev, files }
    }),
  )
  const total = sources.reduce((sum, s) => sum + s.files.length, 0)
  let copied = 0
  for (const { prevId, prev, files } of sources) {
    if (!prev?.paths?.projectId || !prev.paths.final || files.length === 0) continue
    const base = total > 1 ? join(inputs[prevId], folderName) : inputs[prevId]
    const ids = await copyTree({
      sourceProjectId: prev.paths.projectId,
      root: prev.paths.final,
      files,
      destProjectId: step.paths.projectId,
      base,
      actorId,
    })
    copied += ids.length
    // Что увидит конвейер: верхний уровень `IN`.
    const parts = base.split("/")
    if (parts[0] === "IN" && parts.length > 1) entries.set(`d:${parts[1]}`, { folder: parts[1] })
    else if (base === "IN" && total === 1 && ids[0]) entries.set(`f:${ids[0]}`, { fileId: ids[0] })
  }

  const node = ctx.graph.nodes.find((n) => n.id === step.nodeId)
  if (node?.kind === "auto") {
    const auto: AutoTracking = { attempt, since: new Date().toISOString(), entries: [...entries.values()], notified: [] }
    await query(`UPDATE production_run_steps SET paths = paths || jsonb_build_object('auto', $2::jsonb) WHERE id = $1`, [
      step.id,
      JSON.stringify(auto),
    ])
  }
  return copied
}

/**
 * Рабочая папка формы — заводится при открытии, чтобы было куда класть (§3.0).
 * Подпапки слотов появляются сами, вместе с первым файлом в них.
 */
async function ensureFormFolders(node: WorkNode, paths: StepPaths, actorId: string | null) {
  if (node.kind !== "form" || !paths.projectId || !paths.work) return
  const project = await findProjectById(paths.projectId)
  if (!project) return
  for (const folderPath of [paths.work]) {
    await writeEnsureFolderPath({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      folderPath,
      actor: { userId: actorId, isUploader: true },
    })
  }
}

/**
 * Работа с хранилищем после открытия этапов: копия входа, папки формы,
 * выполнение действия. Действие принимается само и может открыть следующие
 * этапы — они обрабатываются здесь же, по очереди.
 */
export async function afterOpen(runId: string, stepIds: string[], actorId: string | null = null): Promise<void> {
  const queue = [...stepIds]
  while (queue.length > 0) {
    const stepId = queue.shift()!
    const ctx = await loadRunContext(null, runId)
    if (!ctx) return
    const steps = await runSteps(runId)
    const step = [...steps.values()].find((s) => s.id === stepId)
    const node = ctx.graph.nodes.find((n) => n.id === step?.nodeId)
    if (!step || !isWorkNode(node) || !step.paths) continue
    try {
      if (node.kind === "action") {
        queue.push(...(await runAction(ctx, node, step, actorId)))
        continue
      }
      // Открыт повторно (этап до него вернули в работу) — вход новой папкой,
      // иначе конвейер второй раз его не возьмёт.
      await copyInputs(ctx, stepId, actorId, (step.paths.auto?.attempt ?? 0) + 1)
      await ensureFormFolders(node, step.paths, actorId)
    } catch (error) {
      console.error("[production] этап открыт, но файлы не разложились", stepId, error)
    }
  }
}

/**
 * Действие «копировать»: финалы предыдущих этапов — в финальную папку действия,
 * со структурой, и этап принят. Людей и чата у действия нет.
 */
async function runAction(ctx: RunContext, node: WorkNode, step: StepState, actorId: string | null): Promise<string[]> {
  const steps = await runSteps(ctx.runId)
  if (step.paths?.projectId && step.paths.final) {
    for (const prevId of predecessors(ctx.graph, node.id)) {
      const prev = steps.get(prevId)
      if (!prev?.paths?.projectId || !prev.paths.final) continue
      await copyTree({
        sourceProjectId: prev.paths.projectId,
        root: prev.paths.final,
        files: await listTree(prev.paths.projectId, prev.paths.final),
        destProjectId: step.paths.projectId,
        base: step.paths.final,
        actorId,
      })
    }
  }
  const opened = await withTransaction(async (client) => {
    const claimed = await client.query(
      `UPDATE production_run_steps SET status = 'approved', approved_at = NOW() WHERE id = $1 AND status = 'ready'`,
      [step.id],
    )
    if (!claimed.rowCount) return []
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, run_step_id, kind, payload)
       VALUES ($1, $2, $3, 'approved', '{"auto":true}'::jsonb)`,
      [ctx.pipelineId, ctx.runId, step.id],
    )
    return (await advanceRun(client, ctx)).opened
  })
  return opened
}
