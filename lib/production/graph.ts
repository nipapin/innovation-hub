/**
 * Граф пайплайна — docs/PRODUCTION_PLAN.md §3.
 *
 * То, что лежит в `production_pipelines.graph` (черновик) и в
 * `production_pipeline_versions.graph` (зафиксированная структура). Позиции нод
 * хранятся здесь же: редактор рисует граф ровно так, как его оставили.
 *
 * Чистый модуль: без React и без базы — его читают редактор в браузере и
 * сервер при сохранении, активации и запуске ролика. Проверки одни на обе
 * стороны, чтобы редактор не показал зелёным то, что сервер потом отвергнет.
 *
 * Схема 3 (решения 2026-09-30 и 2026-10-01, §3.0):
 *
 * - типы нод: «Старт» (кто запускает и правит, сроки, описание — без связей),
 *   «Инструмент», «Форма», «Автоматика», «Действие». Ноды «Финал» нет: ролик
 *   сдан, когда приняты все последние этапы (без исходящих связей);
 * - этап без входящих связей — первый: открывается сразу при запуске ролика;
 * - у ноды один вход и один выход, связей в каждом — сколько угодно; у
 *   действия «Разделить» выходов несколько — по одному на подпапку;
 * - папка-проект этапа — ссылка на конкретный проект владельца; в черновике
 *   может быть только имя (в том числе `$pipelineName`), проект заводится при
 *   активации;
 * - форма — дерево строк как у `checkFolder` и сбора элемента на сайте
 *   (lib/tools/element/site-form.ts).
 *
 * Схемы 1 и 2 читаются и переводятся на лету — `upgradeGraph`.
 */
import { z } from "zod"

import { checkTemplate, type MaskScope, type ResolveError } from "./masks"

export const GRAPH_SCHEMA_VERSION = 4

/** Этапы — ноды, у которых есть своя работа и свой этап в ролике. */
export const WORK_KINDS = ["tool", "form", "auto", "action"] as const
export type WorkKind = (typeof WORK_KINDS)[number]
export type NodeKind = "start" | WorkKind

export function isWorkKind(kind: string): kind is WorkKind {
  return (WORK_KINDS as readonly string[]).includes(kind)
}

/** Хендлеры: один вход, один выход (§3.3); у «Разделить» ещё выходы по `SplitOutput.id`. */
export const IN_HANDLE = "in"
export const OUT_HANDLE = "out"

/** Путь — массив сегментов с масками (§3.4). Считается от корня папки-проекта этапа. */
const segmentsSchema = z.array(z.string().max(200)).max(20)

const peopleSchema = z.array(z.string().min(1)).max(50)

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() })

const nameSchema = z.string().trim().min(1).max(120)

/** Срок хранения в днях после сдачи ролика; 0 — не удалять (§4.5). */
const daysSchema = z.number().int().min(0).max(3650)

const startDataSchema = z.object({
  name: nameSchema,
  description: z.string().max(4000),
  /** Кто может запускать ролики: у них кнопка «Новый ролик», пайплайнов они не видят. */
  launchers: peopleSchema,
  /** Кто может править пайплайн: запускает, видит его в списке, правит всё, включая архив. */
  editors: peopleSchema,
  retention: z.object({
    /** Варианты (рабочие папки) всех этапов. */
    variantsDays: daysSchema,
    /** Финалы промежуточных этапов; финал последнего этапа не удаляется никогда. */
    finalsDays: daysSchema,
  }),
})

/** Общее у всех этапов: имя, люди, папка-проект и папки внутри неё, норма. */
const workBase = {
  name: nameSchema,
  executors: peopleSchema,
  reviewers: peopleSchema,
  watchers: peopleSchema,
  /**
   * Папка-проект владельца пайплайна, куда пишет этап (§2.2). `id` — выбранный
   * проект; `null` — в черновике указано только имя (можно `$pipelineName`),
   * проект заведётся при активации.
   */
  project: z.object({
    id: z.string().min(1).nullable(),
    name: z.string().trim().min(1).max(200),
    /** Шаблон, по которому папка выбрана, — см. `FormProject`. */
    mask: z.string().trim().min(1).max(200).optional(),
  }),
  paths: z.object({
    /** Пусто — входы по ссылке; задано — финалы предыдущих копируются сюда. */
    in: segmentsSchema,
    work: segmentsSchema,
    final: segmentsSchema,
  }),
}

const toolDataSchema = z.object({
  ...workBase,
  /** Инструмент сайта и его пресет — нижняя часть ноды. Название этапа от него не зависит. */
  tool: z
    .object({
      key: z.string().min(1).max(60),
      preset: z.record(z.unknown()),
    })
    .nullable(),
})

/** Тип строки-подпапки; остальные типы — из словаря типов файлов установки. */
export const FOLDER_ROW_TYPE = "folder"

/**
 * Строка формы — как `FolderRequirementRow` программы и `ElementRow` сайта:
 * название (оно же префикс имени файла), типы файла (подходит любой — «видео
 * или картинка») либо `["folder"]`, `>=`/`=` и число. У подпапки внутри —
 * такие же строки, любой вложенности.
 */
export type FormRow = {
  id: string
  label: string
  types: string[]
  op: ">=" | "="
  count: number
  children: FormRow[]
}

const formRowSchema: z.ZodType<FormRow> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(40),
    label: z.string().max(120),
    types: z.array(z.string().min(1).max(60)).min(1).max(20),
    op: z.enum([">=", "="]),
    count: z.number().int().min(1).max(999),
    children: z.array(formRowSchema).max(50),
  }),
)

const formDataSchema = z.object({
  ...workBase,
  rows: z.array(formRowSchema).max(50),
})

/**
 * Автоматика (§3.2г): исполнитель — машина, вход копируется в папку (по
 * умолчанию `IN`), этап открывается сам. Проверяющий — люди или тоже
 * автоматика; без людей чата у этапа нет.
 */
const autoDataSchema = z.object({
  ...workBase,
  autoApprove: z.boolean(),
})

/** Имя подпапки выхода: один сегмент пути, без масок. */
const outputFolderSchema = z.string().trim().max(120)

/**
 * Выход «Разделить»: файл уходит сюда, если подошёл по всем заполненным
 * условиям — тип (любой из списка), имя без расширения содержит хотя бы один
 * из текстов и не содержит ни одного из запрещённых. Регистр не важен.
 * Файл, подошедший под несколько выходов, копируется в каждый.
 */
export type SplitOutput = {
  id: string
  folder: string
  types: string[]
  contains: string[]
  excludes: string[]
}

const splitOutputSchema = z.object({
  id: z.string().min(1).max(40),
  folder: outputFolderSchema,
  types: z.array(z.string().min(1).max(60)).max(20),
  contains: z.array(z.string().min(1).max(200)).max(50),
  excludes: z.array(z.string().min(1).max(200)).max(50),
})

/**
 * Действие (§3.2д): без людей и без чата.
 *
 * - `copy` — финалы предыдущих этапов в свою финальную папку;
 * - `split` — то же, но разложенное по подпапкам выходов (`outputs`), а не
 *   подошедшее никуда — в `restFolder`. У каждого выхода свой хендлер; основной
 *   выход ноды — «остальное». Следующий этап берёт подпапку своего выхода, а
 *   если она пустая — всю финальную папку действия.
 */
const actionDataSchema = z.object({
  ...workBase,
  action: z.enum(["copy", "split"]),
  outputs: z.array(splitOutputSchema).max(20).optional(),
  restFolder: outputFolderSchema.optional(),
})

/** Ширина ноды, растянутой мышью; нет — ширина по умолчанию своего типа. */
const widthSchema = z.number().min(200).max(1600).optional()

const node = <K extends string, D extends z.ZodTypeAny>(kind: K, data: D) =>
  z.object({
    id: z.string().min(1).max(40),
    kind: z.literal(kind),
    position: positionSchema,
    width: widthSchema,
    data,
  })

const nodeSchema = z.discriminatedUnion("kind", [
  node("start", startDataSchema),
  node("tool", toolDataSchema),
  node("form", formDataSchema),
  node("auto", autoDataSchema),
  node("action", actionDataSchema),
])

const edgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Выход «Разделить» (`SplitOutput.id`); нет — основной выход ноды. */
  sourceHandle: z.string().min(1).max(40).optional(),
})

export const pipelineGraphSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(1000),
})

export type PipelineGraph = z.infer<typeof pipelineGraphSchema>
export type PipelineNode = PipelineGraph["nodes"][number]
export type PipelineEdge = PipelineGraph["edges"][number]
export type StartNode = Extract<PipelineNode, { kind: "start" }>
export type StartData = StartNode["data"]
export type WorkNode = Extract<PipelineNode, { kind: WorkKind }>
export type WorkData = WorkNode["data"]
export type ToolNode = Extract<PipelineNode, { kind: "tool" }>
export type FormNode = Extract<PipelineNode, { kind: "form" }>
export type AutoNode = Extract<PipelineNode, { kind: "auto" }>
export type ActionNode = Extract<PipelineNode, { kind: "action" }>

export function isWorkNode(node: PipelineNode | undefined | null): node is WorkNode {
  return Boolean(node && isWorkKind(node.kind))
}

// ─── Создание ─────────────────────────────────────────────────────────────

/** Короткий id: ноды живут в JSON, длинные UUID там только шумят. */
export function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
}

export const DEFAULT_PROJECT: FormProject = { id: null, name: "$pipelineName" }
export const DEFAULT_WORK_PATH = ["$runTime-$runName", "$stageNum $stageName", "versions"]
export const DEFAULT_FINAL_PATH = ["$runTime-$runName", "$stageNum $stageName", "final"]
export const DEFAULT_AUTO_IN = ["IN"]
export const DEFAULT_AUTO_OUT = ["OUT"]
export const DEFAULT_REST_FOLDER = "rest"
function base(name: string) {
  return {
    name,
    executors: [] as string[],
    reviewers: [] as string[],
    watchers: [] as string[],
    project: { ...DEFAULT_PROJECT },
    paths: { in: [] as string[], work: [...DEFAULT_WORK_PATH], final: [...DEFAULT_FINAL_PATH] },
  }
}

/** Новый этап своего типа. Имя по умолчанию — название типа, дальше правится. */
export function createWorkNode(kind: WorkKind, name: string, position = { x: 0, y: 0 }): WorkNode {
  const id = shortId(kind)
  switch (kind) {
    case "tool":
      return { id, kind, position, data: { ...base(name), tool: null } }
    case "form":
      return { id, kind, position, data: { ...base(name), rows: [] } }
    case "auto":
      return {
        id,
        kind,
        position,
        data: {
          ...base(name),
          paths: { in: [...DEFAULT_AUTO_IN], work: [...DEFAULT_AUTO_OUT], final: [...DEFAULT_FINAL_PATH] },
          autoApprove: false,
        },
      }
    case "action":
      return { id, kind, position, data: { ...base(name), action: "copy" } }
  }
}

/**
 * Свободное имя для нового этапа: «Форма», занято — «Форма 1», «Форма 2»…
 * Сравнение то же, что у предупреждения `duplicate-stage-name`.
 */
export function uniqueStageName(nodes: PipelineNode[], name: string, exceptId?: string): string {
  const taken = new Set(
    nodes
      .filter((n) => isWorkNode(n) && n.id !== exceptId)
      .map((n) => (n as WorkNode).data.name.trim().toLowerCase()),
  )
  const base = name.trim()
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function createFormRow(type: string): FormRow {
  return { id: shortId("row"), label: "", types: [type], op: ">=", count: 1, children: [] }
}

export function createSplitOutput(): SplitOutput {
  return { id: shortId("out"), folder: "", types: [], contains: [], excludes: [] }
}

/** Выходы «Разделить»; у копирования их нет. */
export function splitOutputsOf(node: PipelineNode | undefined): SplitOutput[] {
  return node?.kind === "action" && node.data.action === "split" ? (node.data.outputs ?? []) : []
}

export function restFolderOf(node: ActionNode): string {
  return node.data.restFolder?.trim() || DEFAULT_REST_FOLDER
}

/**
 * Подпапка финала источника, которую получает цель по этой связи; `null` — весь
 * финал. У «Разделить» основной выход — «остальное».
 */
export function edgeSubfolder(graph: PipelineGraph, edge: Pick<PipelineEdge, "source" | "sourceHandle">): string | null {
  const source = graph.nodes.find((n) => n.id === edge.source)
  if (source?.kind !== "action" || source.data.action !== "split") return null
  if (!edge.sourceHandle) return restFolderOf(source)
  return splitOutputsOf(source).find((o) => o.id === edge.sourceHandle)?.folder.trim() || null
}

/** Подходит ли файл выходу. `fits` — проверка типа по расширению (словарь типов — на сервере). */
export function fileFitsOutput(output: SplitOutput, fileName: string, fits: (types: string[], fileName: string) => boolean): boolean {
  if (output.types.length > 0 && !fits(output.types, fileName)) return false
  const dot = fileName.lastIndexOf(".")
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase()
  if (output.contains.length > 0 && !output.contains.some((t) => stem.includes(t.toLowerCase()))) return false
  return !output.excludes.some((t) => stem.includes(t.toLowerCase()))
}

export function isFolderFormRow(row: Pick<FormRow, "types">): boolean {
  return row.types.includes(FOLDER_ROW_TYPE)
}

/** Пустой пайплайн: только «Старт». Этапы добавляются в редакторе. */
export function createEmptyGraph(names: { start: string }): PipelineGraph {
  const start: StartNode = {
    id: shortId("start"),
    kind: "start",
    position: { x: 0, y: 0 },
    data: {
      name: names.start,
      description: "",
      launchers: [],
      editors: [],
      retention: { variantsDays: 0, finalsDays: 0 },
    },
  }
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [start], edges: [] }
}

// ─── Схемы 1 и 2 → 3 ──────────────────────────────────────────────────────

const V1_MASKS: [RegExp, string][] = [
  [/\$pipeline(?![A-Za-z0-9])/g, "$pipelineName"],
  [/\$run(?![A-Za-z0-9])/g, "$runName"],
  [/\$stage(?![A-Za-z0-9])/g, "$stageName"],
]
const v1Path = (segments: unknown) =>
  (Array.isArray(segments) ? segments : []).map((s) =>
    V1_MASKS.reduce((acc, [re, to]) => acc.replace(re, to), String(s)),
  )

type Raw = Record<string, unknown>

/** Строка формы схемы 2 (`kind` file/folder, `op` gte/eq) → строка дерева. */
function v2Row(raw: Raw): FormRow {
  const folder = raw.kind === "folder"
  return {
    id: String(raw.id ?? shortId("row")),
    label: String((folder ? raw.folder : raw.name || raw.folder) ?? ""),
    types: [folder ? FOLDER_ROW_TYPE : raw.type && raw.type !== "any" ? String(raw.type) : "video"],
    op: raw.op === "eq" ? "=" : ">=",
    count: Math.max(1, Number(raw.count) || 1),
    children: [],
  }
}

/** Строка формы схемы 3: один `type` → список из одного. */
function v3Row(raw: Raw): FormRow {
  const { type, ...rest } = raw as Raw & { type?: unknown }
  return {
    ...(rest as Omit<FormRow, "types" | "children">),
    types: Array.isArray(raw.types) ? (raw.types as string[]) : [String(type ?? "video")],
    children: ((raw.children as Raw[]) ?? []).map(v3Row),
  }
}

/** Схема 3 → 4: отличается только строками формы. */
function v3Graph(g: { nodes?: unknown[]; edges?: unknown[] }): PipelineGraph {
  const nodes = (g.nodes ?? []).map((item) => {
    const n = item as PipelineNode
    if (n.kind !== "form") return n
    return { ...n, data: { ...n.data, rows: (n.data.rows as unknown as Raw[]).map(v3Row) } }
  })
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges: (g.edges ?? []) as PipelineGraph["edges"] }
}

/**
 * Перевести граф старой схемы. Схема 1: этап «человек» → «Инструмент»,
 * «машина» → «Автоматика», маски — на новые имена. Схема 2: папка-проект из
 * строки в ссылку, строки формы — в дерево. Обеим: «Финал» и связи со
 * «Стартом» снимаются, нормы — тоже.
 */
export function upgradeGraph(raw: unknown): PipelineGraph {
  const g = (raw ?? {}) as { schemaVersion?: number; nodes?: unknown[]; edges?: unknown[] }
  if (g.schemaVersion === GRAPH_SCHEMA_VERSION) return raw as PipelineGraph
  if (g.schemaVersion === 3) return v3Graph(g)
  const nodes: PipelineNode[] = []
  for (const item of g.nodes ?? []) {
    const n = item as { id: string; kind: string; position: { x: number; y: number }; data: Raw }
    const d = n.data ?? {}
    const paths = (d.paths ?? {}) as { in?: unknown; work?: unknown; final?: unknown }
    const common = {
      name: String(d.name ?? "Stage"),
      executors: (d.executors as string[]) ?? [],
      reviewers: (d.reviewers as string[]) ?? [],
      watchers: (d.watchers as string[]) ?? [],
      project: typeof d.project === "object" && d.project ? (d.project as FormProject) : { id: null, name: String(d.project ?? DEFAULT_PROJECT.name) },
      paths: {
        in: Array.isArray(paths.in) ? (paths.in as string[]) : d.copyInput ? ["IN"] : [],
        work: v1Path(paths.work),
        final: v1Path(paths.final),
      },
    }
    if (n.kind === "start") {
      const retention = d.retention as StartData["retention"] | undefined
      nodes.push({
        id: n.id,
        kind: "start",
        position: n.position,
        data: {
          name: String(d.name ?? "Start"),
          description: String(d.description ?? ""),
          launchers: (d.launchers as string[]) ?? [],
          editors: (d.editors as string[]) ?? [],
          retention: retention ?? { variantsDays: 0, finalsDays: 0 },
        },
      })
    } else if (n.kind === "stage") {
      if (d.execution === "machine") {
        nodes.push({ id: n.id, kind: "auto", position: n.position, data: { ...common, autoApprove: d.approval === "auto" } })
      } else {
        const tool = d.tool as { key: string; preset: Record<string, unknown> } | null
        nodes.push({ id: n.id, kind: "tool", position: n.position, data: { ...common, tool: tool ?? null } })
      }
    } else if (n.kind === "tool") {
      nodes.push({ id: n.id, kind: "tool", position: n.position, data: { ...common, tool: (d.tool as ToolNode["data"]["tool"]) ?? null } })
    } else if (n.kind === "form") {
      nodes.push({ id: n.id, kind: "form", position: n.position, data: { ...common, rows: ((d.rows as Raw[]) ?? []).map(v2Row) } })
    } else if (n.kind === "auto") {
      nodes.push({ id: n.id, kind: "auto", position: n.position, data: { ...common, autoApprove: Boolean(d.autoApprove) } })
    } else if (n.kind === "action") {
      nodes.push({ id: n.id, kind: "action", position: n.position, data: { ...common, action: "copy" } })
    }
  }
  const work = new Set(nodes.filter((n) => n.kind !== "start").map((n) => n.id))
  const edges = (g.edges ?? [])
    .map((item) => {
      const e = item as { id: string; source: string; target: string }
      return { id: e.id, source: e.source, target: e.target }
    })
    .filter((e) => work.has(e.source) && work.has(e.target))
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges }
}

/**
 * Папка этапа. `mask` — шаблон, по которому папка выбрана (`$pipelineName`): имя
 * пайплайна сменилось — маска даёт другое имя, и новая версия переводит этап на
 * папку с новым именем сама (activation.ts, `retargetProjects`).
 */
export type FormProject = { id: string | null; name: string; mask?: string }

// ─── Приведение ───────────────────────────────────────────────────────────

/**
 * Привести ноды к правилам, которые не выбираются, а следуют из типа:
 * у автоматики нет исполнителей-людей, у действия нет людей вовсе. Делается при
 * каждом сохранении: граф может прийти и из дубля, и из старого черновика.
 */
export function normalizeGraph(graph: PipelineGraph): PipelineGraph {
  const seen = new Set<string>()
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.kind === "auto") return { ...n, data: { ...n.data, executors: [] } }
      if (n.kind === "action") return { ...n, data: { ...n.data, executors: [], reviewers: [], watchers: [] } }
      return n
    }),
    // Одна и та же связь дважды ничего не значит — оставляем одну.
    edges: withLiveHandles(graph).edges.filter((e) => {
      const key = `${e.source}>${e.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}

/**
 * Снять связи из выходов, которых больше нет: выход «Разделить» удалили или
 * действие переключили на копирование.
 */
export function withLiveHandles(graph: PipelineGraph): PipelineGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const edges = graph.edges.filter(
    (e) => !e.sourceHandle || splitOutputsOf(byId.get(e.source)).some((o) => o.id === e.sourceHandle),
  )
  return edges.length === graph.edges.length ? graph : { ...graph, edges }
}

// ─── Проверка ─────────────────────────────────────────────────────────────

export type PathField = "project" | "in" | "work" | "final"

/**
 * `error` — активировать нельзя. `warning` — можно, но стоит посмотреть: этап
 * без людей законен в шаблоне, людей добавят позже.
 */
export type GraphIssue = {
  level: "error" | "warning"
  code:
    | "no-start"
    | "many-starts"
    | "no-stages"
    | "duplicate-id"
    | "bad-edge"
    | "cycle"
    | "duplicate-stage-name"
    | "bad-path"
    | "no-reviewers"
    | "no-executors"
    | "form-empty"
    | "form-row-label"
    | "split-folder"
    | "auto-last"
  nodeId?: string
  edgeId?: string
  path?: { which: PathField; error: ResolveError }
}

const PATH_SCOPE: Record<PathField, MaskScope> = { project: "project", in: "input", work: "path", final: "path" }

function rowsHaveEmptyLabel(rows: readonly FormRow[]): boolean {
  return rows.some((r) => !r.label.trim() || rowsHaveEmptyLabel(r.children))
}

export function validateGraph(graph: PipelineGraph): GraphIssue[] {
  const issues: GraphIssue[] = []
  const byId = new Map<string, PipelineNode>()
  for (const n of graph.nodes) {
    if (byId.has(n.id)) issues.push({ level: "error", code: "duplicate-id", nodeId: n.id })
    byId.set(n.id, n)
  }

  const starts = graph.nodes.filter((n) => n.kind === "start")
  if (starts.length === 0) issues.push({ level: "error", code: "no-start" })
  for (const n of starts.slice(1)) issues.push({ level: "error", code: "many-starts", nodeId: n.id })
  if (!graph.nodes.some(isWorkNode)) issues.push({ level: "error", code: "no-stages" })

  // Связи — только между этапами: «Старт» ни с кем не связан.
  const valid: PipelineEdge[] = []
  for (const edge of graph.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const badHandle = edge.sourceHandle && !splitOutputsOf(source).some((o) => o.id === edge.sourceHandle)
    if (!isWorkNode(source) || !isWorkNode(target) || source.id === target.id || badHandle) {
      issues.push({ level: "error", code: "bad-edge", edgeId: edge.id })
      continue
    }
    valid.push(edge)
  }
  if (kahn(graph.nodes, valid) === null) issues.push({ level: "error", code: "cycle" })

  const names = new Set<string>()
  for (const n of graph.nodes) {
    if (!isWorkNode(n)) continue
    const d = n.data
    // Имя этапа уходит в `$stageName`, то есть в путь: одинаковые имена могут
    // сложить два этапа в одну папку. Не ошибка — путь мог быть задан иначе.
    const key = d.name.trim().toLowerCase()
    if (names.has(key)) issues.push({ level: "warning", code: "duplicate-stage-name", nodeId: n.id })
    names.add(key)

    const templates: [PathField, string[]][] = [
      ["project", d.project.id ? [] : [d.project.name]],
      ["in", d.paths.in],
      ["work", d.paths.work],
      ["final", d.paths.final],
    ]
    for (const [which, segments] of templates) {
      if (n.kind === "action" && which === "work") continue
      if ((which === "in" || which === "project") && segments.length === 0) continue
      const error = checkTemplate(segments, PATH_SCOPE[which])
      if (error) issues.push({ level: "error", code: "bad-path", nodeId: n.id, path: { which, error } })
    }
    if ((n.kind === "tool" || n.kind === "form") && d.executors.length === 0) {
      issues.push({ level: "warning", code: "no-executors", nodeId: n.id })
    }
    const needsReviewer = n.kind === "tool" || n.kind === "form" || (n.kind === "auto" && !n.data.autoApprove)
    if (needsReviewer && d.reviewers.length === 0) {
      issues.push({ level: "warning", code: "no-reviewers", nodeId: n.id })
    }
    if (n.kind === "form") {
      if (n.data.rows.length === 0) issues.push({ level: "warning", code: "form-empty", nodeId: n.id })
      // Название строки — префикс имени файла: без него файлы не разобрать по местам.
      else if (rowsHaveEmptyLabel(n.data.rows)) issues.push({ level: "error", code: "form-row-label", nodeId: n.id })
    }
    // Автоприёмка последнего этапа: упади автоматика — сообщить некому, ролик
    // не сдастся. Последний этап завершает человек.
    if (n.kind === "auto" && n.data.autoApprove && !valid.some((e) => e.source === n.id)) {
      issues.push({ level: "error", code: "auto-last", nodeId: n.id })
    }
    if (n.kind === "action" && n.data.action === "split") {
      // Имя выхода — подпапка финала: пустое, со слэшем или повтор сложат
      // файлы разных выходов в одно место.
      const folders = [...splitOutputsOf(n).map((o) => o.folder.trim()), restFolderOf(n)]
      const keys = folders.map((f) => f.toLowerCase())
      if (folders.some((f) => !f || f.includes("/") || f === "." || f === "..") || new Set(keys).size !== keys.length) {
        issues.push({ level: "error", code: "split-folder", nodeId: n.id })
      }
    }
  }
  return issues
}

export function hasErrors(issues: readonly GraphIssue[]): boolean {
  return issues.some((issue) => issue.level === "error")
}

/**
 * Можно ли провести связь — редактор спрашивает это на лету: концы — этапы,
 * такой связи ещё нет, круга не получится.
 */
export function canConnect(graph: PipelineGraph, edge: { source: string; target: string }): boolean {
  const source = graph.nodes.find((n) => n.id === edge.source)
  const target = graph.nodes.find((n) => n.id === edge.target)
  if (!isWorkNode(source) || !isWorkNode(target) || source.id === target.id) return false
  if (graph.edges.some((e) => e.source === edge.source && e.target === edge.target)) return false
  return kahn(graph.nodes, [...graph.edges, { id: "probe", ...edge }]) !== null
}

// ─── Структура и люди ─────────────────────────────────────────────────────

/**
 * Отпечаток структуры — то, что меняется только новой версией (§3.5): ноды,
 * их типы, имена, папки, настройки типа и связи. Не входят позиции, ширина,
 * люди, описание и сроки хранения: это настройки на месте.
 */
export function structureSignature(graph: PipelineGraph): string {
  const nodes = [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => {
      if (n.kind === "start") return { id: n.id, kind: n.kind }
      const { executors: _e, reviewers: _r, watchers: _w, ...rest } = n.data
      return { id: n.id, kind: n.kind, ...rest, name: rest.name.trim() }
    })
  const edges = graph.edges.map((e) => `${e.source}>${e.target}${e.sourceHandle ? `:${e.sourceHandle}` : ""}`).sort()
  return JSON.stringify({ nodes, edges })
}

export type PipelineRole = "launcher" | "editor" | "executor" | "reviewer" | "watcher"

/** Люди из графа — строками для `production_pipeline_people`. */
export function peopleOf(graph: PipelineGraph): { nodeId: string; userId: string; role: PipelineRole }[] {
  const out: { nodeId: string; userId: string; role: PipelineRole }[] = []
  for (const n of graph.nodes) {
    if (n.kind === "start") {
      for (const userId of n.data.launchers) out.push({ nodeId: n.id, userId, role: "launcher" })
      for (const userId of n.data.editors) out.push({ nodeId: n.id, userId, role: "editor" })
    } else if (isWorkNode(n)) {
      for (const userId of n.data.executors) out.push({ nodeId: n.id, userId, role: "executor" })
      for (const userId of n.data.reviewers) out.push({ nodeId: n.id, userId, role: "reviewer" })
      for (const userId of n.data.watchers) out.push({ nodeId: n.id, userId, role: "watcher" })
    }
  }
  return out
}

export function startOf(graph: PipelineGraph): StartNode | null {
  return (graph.nodes.find((n) => n.kind === "start") as StartNode | undefined) ?? null
}

/** Этапы по порядку — номер этапа в `$stageNum`. Порядок топологический; в графе с кругом — как лежат. */
export function orderedStages(graph: PipelineGraph): WorkNode[] {
  const order = topologicalOrder(graph) ?? graph.nodes.map((n) => n.id)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return order.map((id) => byId.get(id)).filter(isWorkNode)
}

/**
 * Последние этапы — без исходящих связей: их приёмка сдаёт ролик, их финал не
 * удаляет срок хранения (§4.5).
 */
export function lastStages(graph: PipelineGraph): Set<string> {
  const sources = new Set(graph.edges.map((e) => e.source))
  return new Set(graph.nodes.filter((n) => isWorkNode(n) && !sources.has(n.id)).map((n) => n.id))
}

// ─── Порядок ──────────────────────────────────────────────────────────────

/** Непосредственные предшественники: чей FINAL — вход этого этапа (§4.4). */
export function predecessors(graph: PipelineGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

export function successors(graph: PipelineGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.source === nodeId).map((e) => e.target)
}

/** Топологический порядок (Кан). `null` — в графе круг. */
export function topologicalOrder(graph: PipelineGraph): string[] | null {
  return kahn(graph.nodes, graph.edges)
}

function kahn(nodes: readonly PipelineNode[], edges: readonly PipelineEdge[]): string[] | null {
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  for (const edge of edges) {
    if (indegree.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const edge of edges) {
      if (edge.source !== id || !indegree.has(edge.target)) continue
      const left = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, left)
      if (left === 0) queue.push(edge.target)
    }
  }
  return order.length === nodes.length ? order : null
}

function reach(from: string, edges: readonly PipelineEdge[], dir: "forward" | "backward"): Set<string> {
  const seen = new Set([from])
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const edge of edges) {
      const [a, b] = dir === "forward" ? [edge.source, edge.target] : [edge.target, edge.source]
      if (a === id && !seen.has(b)) {
        seen.add(b)
        stack.push(b)
      }
    }
  }
  return seen
}
