"use client"

import "@xyflow/react/dist/style.css"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { AlertTriangle, Archive, ArchiveRestore, ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useRouter } from "next/navigation"
import { useI18n, type DictKey } from "@/components/account/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  canConnect,
  createWorkNode,
  isWorkKind,
  shortId,
  type GraphIssue,
  type PipelineGraph,
  type WorkKind,
} from "@/lib/production/graph"
import type { PersonOption } from "@/lib/production/people-types"
import { cn } from "@/lib/utils"
import { EditorProvider, type EditorApi } from "./editor-context"
import { DEFAULT_WIDTH } from "./node-parts"
import { RemovableEdge } from "./removable-edge"
import {
  ActionNodeView,
  AutoNodeView,
  FormNodeView,
  StartNodeView,
  ToolNodeView,
  type FlowData,
} from "./nodes"

/**
 * Редактор пайплайна — docs/PRODUCTION_PLAN.md §3, шаг 1.5.
 *
 * Граф — единственное состояние; ноды и связи xyflow выводятся из него на
 * каждом рендере. Черновик сохраняется сам, через секунду после последней
 * правки, с `revision` (§3.5): разошлась — 409, и редактор предлагает
 * подтянуть чужую версию, а не перетирает её.
 */

type PipelineDto = {
  id: string
  name: string
  graph: PipelineGraph
  revision: number
  status: "draft" | "active" | "archived"
  currentVersion: number | null
  activeRuns: number
}

type Loaded = { pipeline: PipelineDto; issues: GraphIssue[]; structureChanged: boolean }

/** Только в ответе на GET: папки владельца и словарь типов файлов. */
type Extras = { projects: { id: string; name: string }[]; fileTypes: string[] }

const NODE_TYPES = {
  start: StartNodeView,
  tool: ToolNodeView,
  form: FormNodeView,
  auto: AutoNodeView,
  action: ActionNodeView,
}

const EDGE_TYPES = { removable: RemovableEdge }

/** Типы этапов в меню «Добавить» — с подписью, она же имя нового этапа. */
const ADD_KINDS: { kind: WorkKind; label: DictKey; hint: DictKey }[] = [
  { kind: "tool", label: "productionEdKindTool", hint: "productionEdKindToolHint" },
  { kind: "form", label: "productionEdKindForm", hint: "productionEdKindFormHint" },
  { kind: "auto", label: "productionEdKindAuto", hint: "productionEdKindAutoHint" },
  { kind: "action", label: "productionEdKindAction", hint: "productionEdKindActionHint" },
]

const SAVE_DELAY_MS = 1000

export function PipelineEditor({ pipelineId }: { pipelineId: string }) {
  return (
    <ReactFlowProvider>
      <EditorInner pipelineId={pipelineId} />
    </ReactFlowProvider>
  )
}

function EditorInner({ pipelineId }: { pipelineId: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const { screenToFlowPosition } = useReactFlow()
  const canvas = useRef<HTMLDivElement>(null)
  /** Меню по правому клику: где открыть на экране и куда поставить ноду. */
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [graph, setGraph] = useState<PipelineGraph | null>(null)
  const [name, setName] = useState("")
  const [people, setPeople] = useState<PersonOption[]>([])
  const [extras, setExtras] = useState<Extras>({ projects: [], fileTypes: [] })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const revision = useRef(0)

  const load = useCallback(async () => {
    const [res, peopleRes] = await Promise.all([
      fetch(`/api/production/pipelines/${pipelineId}`, { cache: "no-store" }),
      fetch("/api/production/people", { cache: "no-store" }),
    ])
    if (!res.ok) {
      toast.error(t.productionEdLoadFailed)
      return
    }
    const body = (await res.json()) as Loaded & Extras
    revision.current = body.pipeline.revision
    setLoaded(body)
    setExtras({ projects: body.projects ?? [], fileTypes: body.fileTypes ?? [] })
    setGraph(body.pipeline.graph)
    setName(body.pipeline.name)
    setDirty(false)
    setConflict(false)
    if (peopleRes.ok) setPeople(((await peopleRes.json()) as { people: PersonOption[] }).people)
  }, [pipelineId, t])

  useEffect(() => {
    void load()
  }, [load])

  const readOnly = loaded?.pipeline.status === "archived"

  // ─── Сохранение ────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!graph || conflict) return
    setSaving(true)
    try {
      const res = await fetch(`/api/production/pipelines/${pipelineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current, graph, name: name.trim() || undefined }),
      })
      if (res.status === 409) {
        setConflict(true)
        return
      }
      if (!res.ok) {
        toast.error(t.productionEdSaveFailed)
        return
      }
      const body = (await res.json()) as Loaded
      revision.current = body.pipeline.revision
      setLoaded(body)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [graph, name, pipelineId, conflict, t])

  useEffect(() => {
    if (!dirty || readOnly) return
    const timer = window.setTimeout(() => void save(), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, readOnly, save])

  const change = useCallback((fn: (g: PipelineGraph) => PipelineGraph) => {
    setGraph((g) => (g ? fn(g) : g))
    setDirty(true)
  }, [])

  // ─── Правки нод ────────────────────────────────────────────────────────

  const api: EditorApi = useMemo(() => {
    const errorNodes = new Set(
      (loaded?.issues ?? []).filter((i) => i.level === "error" && i.nodeId).map((i) => i.nodeId!),
    )
    return {
      readOnly: Boolean(readOnly),
      isDraft: loaded?.pipeline.status === "draft",
      people,
      projects: extras.projects,
      fileTypes: extras.fileTypes,
      updateNode: (id, fn) =>
        change((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? fn(n) : n)) })),
      removeNode: (id) =>
        change((g) => ({
          ...g,
          nodes: g.nodes.filter((n) => n.id !== id),
          edges: g.edges.filter((e) => e.source !== id && e.target !== id),
        })),
      nodeHasError: (id) => errorNodes.has(id),
    }
  }, [change, extras, loaded?.issues, loaded?.pipeline.status, people, readOnly])

  // ─── Граф → xyflow ─────────────────────────────────────────────────────

  /**
   * Ноды xyflow — своё состояние, а не вывод из графа на каждом рендере: xyflow
   * пишет в них замеры размеров и выделение, и без замеров нода не рисуется.
   * Из графа приходят данные и позиции, в граф уходят только движение и
   * удаление.
   */
  const [nodes, setNodes] = useState<Node<FlowData>[]>([])
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      return (graph?.nodes ?? []).map((node) => ({
        ...byId.get(node.id),
        id: node.id,
        type: node.kind,
        position: node.position,
        style: { width: node.width ?? DEFAULT_WIDTH[node.kind] },
        data: { node },
        deletable: isWorkKind(node.kind) && !readOnly,
      }))
    })
  }, [graph, readOnly])

  const edges: Edge[] = useMemo(
    () =>
      (graph?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "removable",
        deletable: !readOnly,
      })),
    [graph, readOnly],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowData>>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns))
      const moved = new Map<string, { x: number; y: number }>()
      const resized = new Map<string, number>()
      const removed = new Set<string>()
      for (const c of changes) {
        if (c.type === "position" && c.position) moved.set(c.id, c.position)
        // Растянули за край — ширина уходит в граф; замеры xyflow (без
        // `setAttributes`) — нет.
        if (c.type === "dimensions" && c.setAttributes && c.dimensions) resized.set(c.id, Math.round(c.dimensions.width))
        if (c.type === "remove") removed.add(c.id)
      }
      if (moved.size === 0 && removed.size === 0 && resized.size === 0) return
      change((g) => ({
        ...g,
        nodes: g.nodes
          .filter((n) => !removed.has(n.id))
          .map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n))
          .map((n) => (resized.has(n.id) ? { ...n, width: resized.get(n.id)! } : n)),
        edges: g.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
      }))
    },
    [change],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id))
      if (removed.size === 0) return
      change((g) => ({ ...g, edges: g.edges.filter((e) => !removed.has(e.id)) }))
    },
    [change],
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      Boolean(graph && canConnect(graph, { source: c.source, target: c.target })),
    [graph],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      change((g) =>
        canConnect(g, { source: c.source, target: c.target })
          ? { ...g, edges: [...g.edges, { id: shortId("e"), source: c.source, target: c.target }] }
          : g,
      )
    },
    [change],
  )

  /**
   * Новая нода — там, куда смотрят: из меню «+ Этап» — в центр видимой части
   * холста, из правого клика — в точку клика. Верхний левый угол ноды сдвинут
   * на половину её ширины, чтобы по центру оказалась сама нода.
   */
  const addStage = (kind: WorkKind, label: string, at?: { x: number; y: number }) => {
    let position = at
    if (!position) {
      const box = canvas.current?.getBoundingClientRect()
      const center = box
        ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
        : { x: 0, y: 0 }
      position = { x: center.x - DEFAULT_WIDTH[kind] / 2, y: center.y - 160 }
    }
    change((g) => ({ ...g, nodes: [...g.nodes, createWorkNode(kind, label, position)] }))
  }

  // ─── Архив и удаление ──────────────────────────────────────────────────

  const setArchived = async (archived: boolean) => {
    if (archived && !window.confirm(t.productionEdArchiveConfirm)) return
    if (dirty) await save()
    const res = await fetch(`/api/production/pipelines/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: revision.current, archived }),
    })
    if (!res.ok) {
      toast.error(res.status === 409 ? t.productionEdConflict : t.productionEdSaveFailed)
      await load()
      return
    }
    toast.success(archived ? t.productionEdArchived : t.productionEdRestored)
    await load()
  }

  const remove = async () => {
    if (!window.confirm(t.productionEdDeleteConfirm)) return
    const res = await fetch(`/api/production/pipelines/${pipelineId}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error(res.status === 409 ? t.productionEdDeleteActiveRuns : t.productionEdSaveFailed)
      return
    }
    router.push("/account/production/pipelines")
  }

  // ─── Активация и версия ────────────────────────────────────────────────

  const commit = async (kind: "activate" | "versions") => {
    const confirmText = kind === "activate" ? t.productionEdActivateConfirm : t.productionEdVersionConfirm
    if (!window.confirm(confirmText)) return
    if (dirty) await save()
    setCommitting(true)
    try {
      const res = await fetch(`/api/production/pipelines/${pipelineId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current }),
      })
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        toast.error(
          body.code === "invalid"
            ? t.productionEdHasErrors
            : body.code === "conflict"
              ? t.productionEdConflict
              : body.code === "storage"
                ? t.productionEdStorage
                : body.code === "project"
                  ? t.productionEdProjectGone
                  : t.productionEdCommitFailed,
        )
        await load()
        return
      }
      toast.success(kind === "activate" ? t.productionEdActivated : t.productionEdVersionSaved)
      await load()
    } finally {
      setCommitting(false)
    }
  }

  if (!loaded || !graph) {
    return (
      <div className="flex h-full items-center justify-center text-ws-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const p = loaded.pipeline
  const errors = loaded.issues.filter((i) => i.level === "error")
  const warnings = loaded.issues.filter((i) => i.level === "warning")

  return (
    <EditorProvider value={api}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
          <Link
            href="/account/production/pipelines"
            aria-label={t.productionEdBack}
            title={t.productionEdBack}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <input
            value={name}
            disabled={readOnly}
            onChange={(event) => {
              setName(event.target.value)
              setDirty(true)
            }}
            aria-label={t.productionEdPipelineName}
            className="min-w-0 max-w-[320px] flex-1 bg-transparent text-[17px] font-semibold text-ws-1 outline-none"
          />
          <StatusBadge status={p.status} version={p.currentVersion} />
          <span className="text-[12px] text-ws-4">
            {saving ? t.productionEdSaving : dirty ? t.productionEdUnsaved : t.productionEdSaved}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {readOnly ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
                  >
                    <Plus className="h-4 w-4" />
                    {t.productionEdAddStage}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {ADD_KINDS.map((item) => (
                    <DropdownMenuItem key={item.kind} onSelect={() => addStage(item.kind, t[item.label])} className="flex-col items-start gap-0.5">
                      <span className="text-[13px] font-medium">{t[item.label]}</span>
                      <span className="text-[11.5px] text-ws-4">{t[item.hint]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              type="button"
              onClick={() => void setArchived(!readOnly)}
              title={readOnly ? t.productionEdRestore : t.productionEdArchive}
              aria-label={readOnly ? t.productionEdRestore : t.productionEdArchive}
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
            >
              {readOnly ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            {p.activeRuns === 0 ? (
              <button
                type="button"
                onClick={() => void remove()}
                title={t.productionEdDelete}
                aria-label={t.productionEdDelete}
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
            {p.status === "draft" ? (
              <button
                type="button"
                disabled={committing || errors.length > 0}
                onClick={() => void commit("activate")}
                title={errors.length > 0 ? t.productionEdHasErrors : undefined}
                className="h-8 rounded-[9px] bg-success px-3 text-[13px] font-medium text-background hover:bg-success/90 disabled:opacity-45"
              >
                {t.productionEdActivate}
              </button>
            ) : null}
            {p.status === "active" && loaded.structureChanged ? (
              <button
                type="button"
                disabled={committing || errors.length > 0}
                onClick={() => void commit("versions")}
                className="h-8 rounded-[9px] bg-ws-action px-3 text-[13px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-45"
              >
                {t.productionEdSaveVersion}
              </button>
            ) : null}
          </div>
        </header>

        {conflict ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning md:px-6">
            <AlertTriangle className="h-4 w-4" />
            <span className="flex-1">{t.productionEdConflict}</span>
            <button type="button" onClick={() => void load()} className="font-medium underline">
              {t.productionEdReload}
            </button>
          </div>
        ) : null}

        <div ref={canvas} className="relative min-h-0 flex-1">
          <ReactFlow
            className="production-flow"
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              if (readOnly) return
              const box = canvas.current?.getBoundingClientRect()
              setMenu({
                x: event.clientX - (box?.left ?? 0),
                y: event.clientY - (box?.top ?? 0),
                flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              })
            }}
            onPaneClick={() => setMenu(null)}
            onMoveStart={() => setMenu(null)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>

          {menu ? (
            <div
              style={{ left: menu.x, top: menu.y }}
              className="absolute z-20 w-72 rounded-md border border-foreground/10 bg-popover p-1 shadow-ws-menu"
              onContextMenu={(event) => event.preventDefault()}
            >
              {ADD_KINDS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => {
                    addStage(item.kind, t[item.label], menu.flow)
                    setMenu(null)
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-ws-hover"
                >
                  <span className="text-[13px] font-medium text-ws-1">{t[item.label]}</span>
                  <span className="text-[11.5px] text-ws-4">{t[item.hint]}</span>
                </button>
              ))}
            </div>
          ) : null}

          {errors.length + warnings.length > 0 ? (
            <IssuesPanel errors={errors} warnings={warnings} graph={graph} />
          ) : null}
        </div>
      </div>
    </EditorProvider>
  )
}

function StatusBadge({ status, version }: { status: PipelineDto["status"]; version: number | null }) {
  const { t } = useI18n()
  const label =
    status === "draft"
      ? t.productionEdStatusDraft
      : status === "active"
        ? t.productionEdStatusActive.replace("{v}", String(version ?? 1))
        : t.productionEdStatusArchived
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-medium",
        status === "active" ? "border-success/30 bg-success/15 text-success" : "border-foreground/10 text-ws-4",
      )}
    >
      {label}
    </span>
  )
}

const ISSUE_TEXT: Record<GraphIssue["code"], DictKey> = {
  "no-start": "productionIssueNoStart",
  "many-starts": "productionIssueManyStarts",
  "no-stages": "productionIssueNoStages",
  "duplicate-id": "productionIssueDuplicateId",
  "bad-edge": "productionIssueBrokenEdge",
  cycle: "productionIssueCycle",
  "duplicate-stage-name": "productionIssueDuplicateName",
  "bad-path": "productionIssueBadPath",
  "path-shared": "productionIssuePathShared",
  "form-empty": "productionIssueFormEmpty",
  "form-row-label": "productionIssueFormRowLabel",
  "no-reviewers": "productionIssueNoReviewers",
  "no-executors": "productionIssueNoExecutors",
}

/** Проблемы графа: ошибки блокируют активацию, предупреждения — нет. */
function IssuesPanel({
  errors,
  warnings,
  graph,
}: {
  errors: GraphIssue[]
  warnings: GraphIssue[]
  graph: PipelineGraph
}) {
  const { t } = useI18n()
  const nameOf = (id?: string) => {
    const node = graph.nodes.find((n) => n.id === id)
    return node ? node.data.name : ""
  }
  return (
    <div className="absolute right-3 top-3 z-10 max-h-[45%] w-72 overflow-y-auto rounded-xl border border-foreground/10 bg-ws-panel p-3 shadow-ws-panel">
      <p className="mb-2 text-[12px] font-semibold text-ws-2">
        {t.productionEdIssues.replace("{e}", String(errors.length)).replace("{w}", String(warnings.length))}
      </p>
      <ul className="space-y-1.5">
        {[...errors, ...warnings].map((issue, index) => (
          <li
            key={index}
            className={cn("text-[12px] leading-snug", issue.level === "error" ? "text-destructive" : "text-warning")}
          >
            {nameOf(issue.nodeId) ? <span className="font-medium">{nameOf(issue.nodeId)}: </span> : null}
            {t[ISSUE_TEXT[issue.code]]}
          </li>
        ))}
      </ul>
    </div>
  )
}
