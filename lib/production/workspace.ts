import { query, withTransaction } from "@/lib/db"
import { insertSystem, unreadByStep } from "./chat"
import { hasChat, listTree, markSoleExecutor, type StepPaths } from "./flow"
import { formStatus, type FormState } from "./form"
import { fileTypeDictionary } from "./uploads"
import { canEditStepPeople, hasStepRole, listAddedPeople } from "./step-people"
import {
  edgeSubfolder,
  isWorkNode,
  predecessors,
  topologicalOrder,
  upgradeGraph,
  type FormRow,
  type PipelineGraph,
  type WorkKind,
} from "./graph"

/**
 * Данные раздела «Производство» — docs/PRODUCTION_PLAN.md §6.5, §9, шаг 1.8.
 *
 * Человек видит ролики, где он участник чата хотя бы одного этапа, и под
 * каждым — только свои этапы; автоматики в списке нет, её никто не делает
 * руками. Автор пайплайна и запустивший видят свой ролик, даже если этапов
 * у них нет — чтобы им управлять; чужие этапы открываются со схемы по ссылке.
 */

export type StepStatus = "waiting" | "ready" | "approved" | "inherited"

export type MyRun = {
  id: string
  name: string
  pipelineName: string
  status: "active" | "done" | "cancelled"
  dueAt: string | null
  createdAt: string
  /** Прогресс по всем этапам ролика, а не только моим — зелёная полоса (§9.1). */
  progress: { done: number; total: number }
  /** Переименовать и завершить: автор пайплайна, запустивший и проверяющие (§4.7). */
  canManage: boolean
  /** Удалить: только автор пайплайна и запустивший. */
  canDelete: boolean
  pipelineId: string
  /** Править пайплайн — автор и редакторы (§6.4): пункт в меню ролика. */
  canEditPipeline: boolean
  /** `redo` — этап до него вернули в работу, его надо пройти заново. */
  steps: { id: string; name: string; kind: WorkKind; status: StepStatus; dueAt: string | null; unread: number; redo: boolean }[]
}

/** Имя ноды из графа версии — одним выражением, чтобы не тащить граф ради него. */
const NODE_NAME = `(SELECT n->'data'->>'name' FROM jsonb_array_elements(v.graph->'nodes') n
                     WHERE n->>'id' = rs.node_id)`
/** Тип ноды; у графов схемы 1 этап назывался `stage` — это «Инструмент» или «Автоматика». */
const NODE_KIND = `(SELECT CASE WHEN n->>'kind' = 'stage'
                            THEN CASE WHEN n->'data'->>'execution' = 'machine' THEN 'auto' ELSE 'tool' END
                            ELSE n->>'kind' END
                      FROM jsonb_array_elements(v.graph->'nodes') n
                     WHERE n->>'id' = rs.node_id)`

/** Права на ролик `r` пайплайна `p` для `$1` — те же, что проверяет lib/production/runs.ts. */
const RUN_CAN_DELETE = `(p.owner_user_id = $1 OR r.created_by = $1)`
const PIPELINE_CAN_EDIT = `(p.owner_user_id = $1 OR EXISTS (
  SELECT 1 FROM production_pipeline_people pe
   WHERE pe.pipeline_id = p.id AND pe.user_id = $1 AND pe.role = 'editor'))`
const RUN_CAN_MANAGE = `(${RUN_CAN_DELETE} OR EXISTS (
  SELECT 1 FROM production_pipeline_people pp
   WHERE pp.pipeline_id = p.id AND pp.user_id = $1 AND pp.role = 'reviewer'))`

export async function listMyRuns(userId: string, archived: boolean): Promise<MyRun[]> {
  const { rows } = await query<{
    runId: string
    runName: string
    pipelineName: string
    runStatus: MyRun["status"]
    runDue: string | null
    createdAt: string
    stepId: string
    stepName: string
    stepKind: WorkKind
    stepStatus: StepStatus
    stepDue: string | null
    stepRedo: boolean
    doneSteps: number
    totalSteps: number
    canManage: boolean
    canDelete: boolean
    pipelineId: string
    canEditPipeline: boolean
    mine: boolean
  }>(
    `SELECT r.id AS "runId", r.name AS "runName", p.name AS "pipelineName",
            r.status AS "runStatus", r.due_at AS "runDue", r.created_at AS "createdAt",
            rs.id AS "stepId", ${NODE_NAME} AS "stepName", ${NODE_KIND} AS "stepKind",
            rs.status AS "stepStatus", rs.due_at AS "stepDue",
            COALESCE((rs.paths->>'redo')::boolean, false) AS "stepRedo",
            c.done AS "doneSteps", c.total AS "totalSteps",
            ${RUN_CAN_MANAGE} AS "canManage", ${RUN_CAN_DELETE} AS "canDelete",
            p.id AS "pipelineId", ${PIPELINE_CAN_EDIT} AS "canEditPipeline",
            (${NODE_KIND} NOT IN ('auto', 'action') AND EXISTS (
              SELECT 1 FROM production_chat_members cm
               WHERE cm.run_step_id = rs.id AND cm.user_id = $1 AND cm.left_at IS NULL
            )) AS mine
       FROM production_runs r
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v
         ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
       JOIN production_run_steps rs ON rs.run_id = r.id
       CROSS JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE s.status IN ('approved', 'inherited'))::int AS done,
                COUNT(*)::int AS total
           FROM production_run_steps s
          WHERE s.run_id = r.id
            AND (SELECT n->>'kind' FROM jsonb_array_elements(v.graph->'nodes') n
                  WHERE n->>'id' = s.node_id) NOT IN ('start', 'final')
       ) c
      WHERE (r.archived_at IS NOT NULL) = $2
        AND ${NODE_KIND} NOT IN ('start', 'final')
        AND (
          ${RUN_CAN_DELETE}
          OR EXISTS (
            SELECT 1 FROM production_chat_members cm
             WHERE cm.run_step_id = rs.id AND cm.user_id = $1 AND cm.left_at IS NULL
          )
        )
      ORDER BY r.created_at DESC, rs.ready_at NULLS LAST, "stepName"`,
    [userId, archived],
  )

  const runs = new Map<string, MyRun>()
  for (const row of rows) {
    let run = runs.get(row.runId)
    if (!run) {
      run = {
        id: row.runId,
        name: row.runName,
        pipelineName: row.pipelineName,
        status: row.runStatus,
        dueAt: row.runDue,
        createdAt: row.createdAt,
        progress: { done: row.doneSteps, total: row.totalSteps },
        canManage: row.canManage,
        canDelete: row.canDelete,
        pipelineId: row.pipelineId,
        canEditPipeline: row.canEditPipeline,
        steps: [],
      }
      runs.set(row.runId, run)
    }
    if (!row.mine) continue
    run.steps.push({
      id: row.stepId,
      name: row.stepName,
      kind: row.stepKind,
      status: row.stepStatus,
      dueAt: row.stepDue,
      unread: 0,
      redo: row.stepRedo,
    })
  }
  const unread = await unreadByStep(userId, rows.filter((r) => r.mine).map((r) => r.stepId))
  for (const run of runs.values()) for (const s of run.steps) s.unread = unread.get(s.id) ?? 0
  return [...runs.values()].filter((run) => run.steps.length > 0 || run.canDelete)
}

// ─── Этап ─────────────────────────────────────────────────────────────────

export type StepFile = {
  id: string
  name: string
  folderPath: string
  contentType: string
  s3Key: string
  sizeBytes: number
  createdAt: string
  author: string | null
}

export type SchemeNodeView = {
  id: string
  name: string
  kind: "start" | WorkKind | "final"
  status: StepStatus
  x: number
  y: number
  machine: boolean
  autoApprove: boolean
  /** Принятый раньше, но этап до него вернули в работу. */
  redo: boolean
}

export type StepView = {
  id: string
  nodeId: string
  runId: string
  runName: string
  pipelineName: string
  name: string
  status: StepStatus
  /** Этап до него вернули в работу — пройти заново. */
  redo: boolean
  /** Ветка: от какого ролика и с какого этапа (§4.6). */
  parentRunId: string | null
  dueAt: string | null
  kind: WorkKind
  /** Ключ инструмента — кнопка «Открыть в инструменте» (§3.2б). */
  toolKey: string | null
  autoApprove: boolean
  hasChat: boolean
  /**
   * Автоматика: следит ли конвейер за папкой этапа (иначе задачи не будет) и
   * пришли ли результаты обработки.
   */
  machine: { watched: boolean; results: boolean } | null
  /** Строки формы и сколько в каждой уже лежит. */
  form:
    | ({
        rows: FormRow[]
        /** Рабочая папка — по ней файл слота находится в `files.work`. */
        work: string
        /** Словарь типов конвейера: тип → расширения, как у проектов. */
        fileTypes: Record<string, string[]>
      } & FormState)
    | null
  /** `added` — добавлен «+» только в этот ролик; его можно убрать здесь же. */
  executors: { id: string; name: string; marked: boolean; added: boolean }[]
  reviewers: { id: string; name: string; added: boolean }[]
  me: { id: string; isExecutor: boolean; isReviewer: boolean; isOwner: boolean; canEditPeople: boolean }
  approvedFileId: string | null
  /**
   * Папки этапа в его проекте — открыть их в «Проектах» (`?id=&path=`).
   * `in` — входная папка, если вход копируется (автоматика); иначе null.
   */
  folders: { projectId: string; work: string | null; final: string | null; in: string | null } | null
  scheme: { nodes: SchemeNodeView[]; edges: [string, string][] }
  files: { in: StepFile[]; work: StepFile[]; final: StepFile[] }
}

export type StepRow = {
  id: string
  runId: string
  nodeId: string
  status: StepStatus
  dueAt: string | null
  approvedFileId: string | null
  paths: StepPaths | null
  runName: string
  runCreatedBy: string | null
  parentRunId: string | null
  pipelineId: string
  pipelineName: string
  ownerUserId: string
  graph: PipelineGraph
  projectId: string | null
}

export async function loadStep(stepId: string): Promise<StepRow | null> {
  const { rows } = await query<StepRow>(
    `SELECT rs.id, rs.run_id AS "runId", rs.node_id AS "nodeId", rs.status,
            rs.due_at AS "dueAt", rs.approved_file_id AS "approvedFileId", rs.paths,
            r.name AS "runName", r.created_by AS "runCreatedBy", r.parent_run_id AS "parentRunId", p.id AS "pipelineId", p.name AS "pipelineName",
            p.owner_user_id AS "ownerUserId", v.graph,
            COALESCE(rs.paths->>'projectId', ps.project_id) AS "projectId"
       FROM production_run_steps rs
       JOIN production_runs r ON r.id = rs.run_id
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v
         ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
       LEFT JOIN production_pipeline_steps ps
         ON ps.pipeline_id = p.id AND ps.node_id = rs.node_id
      WHERE rs.id = $1`,
    [stepId],
  )
  return rows[0] ? { ...rows[0], graph: upgradeGraph(rows[0].graph) } : null
}

/** Видит ли человек этап: участник его чата или автор пайплайна (§6.5). */
export async function canSeeStep(step: StepRow, userId: string): Promise<boolean> {
  if (step.ownerUserId === userId) return true
  const { rowCount } = await query(
    `SELECT 1 FROM production_chat_members
      WHERE run_step_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [step.id, userId],
  )
  return Boolean(rowCount)
}

/** Файлы папки проекта — рекурсивно, новые первыми, с тем, кто принёс. */
export async function listFolderFiles(projectId: string | null, folder: string | undefined): Promise<StepFile[]> {
  if (!projectId || !folder) return []
  const { rows } = await query<StepFile>(
    `SELECT f.id, f.name, f.folder_path AS "folderPath", f.content_type AS "contentType",
            f.s3_key AS "s3Key", f.size_bytes::float8 AS "sizeBytes",
            f.created_at AS "createdAt",
            COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email) AS author
       FROM project_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = $1 AND f.deleted_at IS NULL AND NOT f.is_folder
        AND (f.folder_path = $2 OR f.folder_path LIKE $3)
      ORDER BY f.created_at DESC
      LIMIT 500`,
    [projectId, folder, `${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
  )
  return rows
}

/** Файлы по id — результаты обработки автоматики. */
async function listFolderFilesByIds(projectId: string | null, ids: string[]): Promise<StepFile[]> {
  if (!projectId || ids.length === 0) return []
  const { rows } = await query<StepFile>(
    `SELECT f.id, f.name, f.folder_path AS "folderPath", f.content_type AS "contentType",
            f.s3_key AS "s3Key", f.size_bytes::float8 AS "sizeBytes", f.created_at AS "createdAt",
            COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email) AS author
       FROM project_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = $1 AND f.id = ANY($2::text[]) AND f.deleted_at IS NULL
      ORDER BY f.folder_path, f.name`,
    [projectId, ids],
  )
  return rows
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { rows } = await query<{ id: string; name: string }>(
    `SELECT id, COALESCE(NULLIF(TRIM(contact_name), ''), NULLIF(TRIM(full_name), ''), email) AS name
       FROM users WHERE id = ANY($1::text[])`,
    [ids],
  )
  return new Map(rows.map((r) => [r.id, r.name]))
}

/**
 * Раскладка схемы по графу версии: колонка — самый длинный путь от Старта,
 * ряд — порядок внутри колонки, по центру. Для полосы из кружков этого
 * достаточно, отдельная библиотека раскладки не нужна.
 */
function layout(graph: PipelineGraph): Map<string, { x: number; y: number }> {
  const order = topologicalOrder(graph) ?? graph.nodes.map((n) => n.id)
  const depth = new Map<string, number>()
  for (const id of order) {
    const from = predecessors(graph, id)
    depth.set(id, from.length === 0 ? 0 : Math.max(...from.map((p) => (depth.get(p) ?? 0) + 1)))
  }
  const columns = new Map<number, string[]>()
  for (const id of order) {
    const d = depth.get(id) ?? 0
    columns.set(d, [...(columns.get(d) ?? []), id])
  }
  const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length))
  const out = new Map<string, { x: number; y: number }>()
  for (const [x, ids] of columns) {
    ids.forEach((id, i) => out.set(id, { x, y: (tallest - 1) / 2 + i - (ids.length - 1) / 2 }))
  }
  return out
}

/** Схема ролика: кружок на этап со статусом, связи — из графа версии. */
function buildScheme(
  graph: PipelineGraph,
  bySnode: Map<string, { status: StepStatus; paths?: StepPaths | null }>,
): { nodes: SchemeNodeView[]; edges: [string, string][] } {
  const positions = layout(graph)
  return {
    nodes: graph.nodes.filter(isWorkNode).map((n) => ({
      id: n.id,
      name: n.data.name,
      kind: n.kind,
      status: bySnode.get(n.id)?.status ?? ("waiting" as StepStatus),
      x: positions.get(n.id)?.x ?? 0,
      y: positions.get(n.id)?.y ?? 0,
      machine: n.kind === "auto" || n.kind === "action",
      autoApprove: n.kind === "action" || (n.kind === "auto" && n.data.autoApprove),
      redo: Boolean(bySnode.get(n.id)?.paths?.redo),
    })),
    edges: graph.edges.map((e) => [e.source, e.target] as [string, string]),
  }
}

// ─── Обзор ролика ─────────────────────────────────────────────────────────

export type RunOverview = {
  id: string
  name: string
  pipelineName: string
  status: MyRun["status"]
  progress: { done: number; total: number }
  scheme: { nodes: SchemeNodeView[]; edges: [string, string][] }
  /** Мои этапы: со схемы на них можно перейти. Остальные — только FINAL. */
  myStepIds: Record<string, string>
  /** FINAL принятых этапов по id ноды. */
  finals: Record<string, StepFile[]>
  /**
   * Последний результат — принятые этапы, после которых принятых ещё нет: где
   * ролик сейчас. Параллельные ветки — несколько.
   */
  latest: string[]
}

/**
 * Обзор ролика — «этап без чата»: вся схема и принятое. Видит тот, кто видит
 * ролик: участник чата любого его этапа, автор пайплайна, запустивший.
 * Рабочие папки чужих этапов здесь не показываются.
 */
export async function getRunOverview(runId: string, userId: string): Promise<RunOverview | null> {
  const { rows } = await query<{
    id: string
    name: string
    pipelineName: string
    status: MyRun["status"]
    graph: PipelineGraph
    visible: boolean
  }>(
    `SELECT r.id, r.name, p.name AS "pipelineName", r.status, v.graph,
            (p.owner_user_id = $2 OR r.created_by = $2 OR EXISTS (
              SELECT 1 FROM production_chat_members cm
                JOIN production_run_steps s ON s.id = cm.run_step_id
               WHERE s.run_id = r.id AND cm.user_id = $2 AND cm.left_at IS NULL)) AS visible
       FROM production_runs r
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v
         ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
      WHERE r.id = $1`,
    [runId, userId],
  )
  const run = rows[0]
  if (!run?.visible) return null
  const graph = upgradeGraph(run.graph)

  const steps = await query<{
    id: string
    nodeId: string
    status: StepStatus
    paths: StepPaths | null
    projectId: string | null
    mine: boolean
  }>(
    `SELECT rs.id, rs.node_id AS "nodeId", rs.status, rs.paths,
            COALESCE(rs.paths->>'projectId', ps.project_id) AS "projectId",
            EXISTS (SELECT 1 FROM production_chat_members cm
                     WHERE cm.run_step_id = rs.id AND cm.user_id = $2 AND cm.left_at IS NULL) AS mine
       FROM production_run_steps rs
       JOIN production_runs r ON r.id = rs.run_id
       LEFT JOIN production_pipeline_steps ps
         ON ps.pipeline_id = r.pipeline_id AND ps.node_id = rs.node_id
      WHERE rs.run_id = $1`,
    [runId, userId],
  )
  const bySnode = new Map(steps.rows.map((s) => [s.nodeId, s]))
  const scheme = buildScheme(graph, bySnode)
  const work = graph.nodes.filter(isWorkNode)
  const isDone = (id: string) => ["approved", "inherited"].includes(bySnode.get(id)?.status ?? "")
  const done = work.filter((n) => isDone(n.id))

  const finals: Record<string, StepFile[]> = {}
  await Promise.all(
    done.map(async (n) => {
      const st = bySnode.get(n.id)
      finals[n.id] = await listFolderFiles(st?.projectId ?? null, st?.paths?.final)
    }),
  )
  const latest = done
    .filter((n) => !graph.edges.some((e) => e.source === n.id && isDone(e.target)))
    .map((n) => n.id)

  const myStepIds: Record<string, string> = {}
  for (const st of steps.rows) {
    const node = work.find((n) => n.id === st.nodeId)
    if (st.mine && node && node.kind !== "auto" && node.kind !== "action") myStepIds[st.nodeId] = st.id
  }

  return {
    id: run.id,
    name: run.name,
    pipelineName: run.pipelineName,
    status: run.status,
    progress: { done: done.length, total: work.length },
    scheme,
    myStepIds,
    finals,
    latest,
  }
}

export async function getStepView(stepId: string, userId: string): Promise<StepView | null> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return null

  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (!isWorkNode(node)) return null

  const [allSteps, people, marks, added] = await Promise.all([
    query<{ id: string; nodeId: string; status: StepStatus; paths: StepPaths | null; projectId: string | null }>(
      `SELECT rs.id, rs.node_id AS "nodeId", rs.status, rs.paths,
              COALESCE(rs.paths->>'projectId', ps.project_id) AS "projectId"
         FROM production_run_steps rs
         LEFT JOIN production_pipeline_steps ps
           ON ps.pipeline_id = $2 AND ps.node_id = rs.node_id
        WHERE rs.run_id = $1`,
      [step.runId, step.pipelineId],
    ),
    // Люди — из пайплайна, а не из графа версии: это настройка на месте (§3.5).
    query<{ userId: string; role: string }>(
      `SELECT user_id AS "userId", role FROM production_pipeline_people
        WHERE pipeline_id = $1 AND node_id = $2`,
      [step.pipelineId, step.nodeId],
    ),
    query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM production_run_step_executors
        WHERE run_step_id = $1 ORDER BY marked_at`,
      [step.id],
    ),
    listAddedPeople(step.id),
  ])

  const fromPipeline = (role: string) => people.rows.filter((p) => p.role === role).map((p) => p.userId)
  const addedIds = (role: string) => added.filter((p) => p.role === role).map((p) => p.userId)
  const pipelineExecutors = fromPipeline("executor")
  const pipelineReviewers = fromPipeline("reviewer")
  const executorIds = [...new Set([...pipelineExecutors, ...addedIds("executor")])]
  const reviewerIds = [...new Set([...pipelineReviewers, ...addedIds("reviewer")])]
  const marked = marks.rows.map((m) => m.userId)
  // Этапы, открытые до автоназначения: единственный исполнитель назначается при первом взгляде.
  if (step.status === "ready" && executorIds.length === 1 && marked.length === 0) {
    await withTransaction((client) => markSoleExecutor(client, step.pipelineId, step.id, step.nodeId))
    marked.push(executorIds[0])
  }
  // Отметившийся, которого потом убрали из исполнителей, остаётся видимым: он
  // этап делал, и в отчётах он исполнитель.
  const names = await namesOf([...new Set([...executorIds, ...reviewerIds, ...marked])])

  const bySnode = new Map(allSteps.rows.map((s) => [s.nodeId, s]))
  const scheme = buildScheme(step.graph, bySnode)

  // Исходники — FINAL непосредственно предыдущих этапов этого ролика (§4.4);
  // после «Разделить» — подпапка выхода, а пустая — весь финал действия.
  const inputs = await Promise.all(
    predecessors(step.graph, step.nodeId).map(async (id) => {
      const prev = bySnode.get(id)
      const final = prev?.paths?.final
      const edge = step.graph.edges.find((e) => e.source === id && e.target === step.nodeId)
      const sub = final && edge ? edgeSubfolder(step.graph, edge) : null
      const own = sub ? await listFolderFiles(prev?.projectId ?? null, `${final}/${sub}`) : []
      return own.length > 0 ? own : listFolderFiles(prev?.projectId ?? null, final)
    }),
  )
  // Скопированный вход лежит в своей папке этапа — показываем его, а не ссылку.
  const copiedInputs = Object.values(step.paths?.inputs ?? {})
  const copied = copiedInputs.length
    ? (await Promise.all([...new Set(copiedInputs)].map((dir) => listFolderFiles(step.projectId, dir)))).flat()
    : null
  const [work, final] = await Promise.all([
    listFolderFiles(step.projectId, step.paths?.work),
    listFolderFiles(step.projectId, step.paths?.final),
  ])
  let machine: StepView["machine"] = null
  let machineResults: StepFile[] | null = null
  if (node.kind === "auto") {
    const ids = step.paths?.auto?.results
    machineResults = ids ? (await listFolderFilesByIds(step.projectId, ids)) : null
    const { listWatchedProjects } = await import("@/lib/pipeline/repository")
    const watched = (await listWatchedProjects()).some((p) => p.projectId === step.projectId)
    machine = { watched, results: Boolean(ids) }
  }
  let form: StepView["form"] = null
  if (node.kind === "form") {
    const tree = await listTree(step.projectId ?? undefined, step.paths?.work)
    const checked = formStatus(node.data.rows, step.paths?.work ?? "", tree)
    form = { rows: node.data.rows, work: step.paths?.work ?? "", fileTypes: await fileTypeDictionary(), ...checked }
  }

  const executors = [...new Set([...marked, ...executorIds])].map((id) => ({
    id,
    name: names.get(id) ?? "?",
    marked: marked.includes(id),
    added: !pipelineExecutors.includes(id) && executorIds.includes(id),
  }))

  return {
    id: step.id,
    nodeId: step.nodeId,
    runId: step.runId,
    runName: step.runName,
    pipelineName: step.pipelineName,
    name: node.data.name,
    status: step.status,
    redo: Boolean(step.paths?.redo),
    parentRunId: step.parentRunId,
    dueAt: step.dueAt,
    kind: node.kind,
    toolKey: node.kind === "tool" ? (node.data.tool?.key ?? null) : null,
    autoApprove: node.kind === "action" || (node.kind === "auto" && node.data.autoApprove),
    hasChat: hasChat(node),
    machine,
    form,
    executors,
    reviewers: reviewerIds.map((id) => ({ id, name: names.get(id) ?? "?", added: !pipelineReviewers.includes(id) })),
    me: {
      id: userId,
      isExecutor: executorIds.includes(userId),
      isReviewer: reviewerIds.includes(userId),
      isOwner: step.ownerUserId === userId,
      canEditPeople: step.status === "ready" || step.status === "waiting" ? await canEditStepPeople(step, userId) : false,
    },
    approvedFileId: step.approvedFileId,
    folders: step.projectId
      ? {
          projectId: step.projectId,
          work: step.paths?.work ?? null,
          final: step.paths?.final ?? null,
          in: Object.values(step.paths?.inputs ?? {})[0] ?? null,
        }
      : null,
    scheme,
    files: { in: copied ?? inputs.flat(), work: machineResults ?? work, final },
  }
}

export type MarkResult = { ok: true; marked: boolean } | { ok: false; reason: "not-found" | "not-executor" | "closed" }

/**
 * Отметка «я делаю этот этап» (§4.1): ставит и снимает только сам исполнитель,
 * только на открытом этапе. История — в журнале.
 */
export async function toggleExecutorMark(stepId: string, userId: string): Promise<MarkResult> {
  const step = await loadStep(stepId)
  if (!step || !(await canSeeStep(step, userId))) return { ok: false, reason: "not-found" }
  if (step.status !== "ready") return { ok: false, reason: "closed" }
  if (!(await hasStepRole(step, userId, "executor"))) return { ok: false, reason: "not-executor" }

  const removed = await query(
    `DELETE FROM production_run_step_executors WHERE run_step_id = $1 AND user_id = $2`,
    [stepId, userId],
  )
  const marked = !removed.rowCount
  if (marked) {
    await query(
      `INSERT INTO production_run_step_executors (run_step_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [stepId, userId],
    )
  }
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO production_events (pipeline_id, run_id, run_step_id, actor_user_id, kind)
       VALUES ($1, $2, $3, $4, $5)`,
      [step.pipelineId, step.runId, stepId, userId, marked ? "executor_marked" : "executor_unmarked"],
    )
    await insertSystem(client, stepId, marked ? "executor_marked" : "executor_unmarked", { actorId: userId })
  })
  return { ok: true, marked }
}
