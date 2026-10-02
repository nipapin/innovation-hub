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
  type FinalConnectionState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { AlertTriangle, Archive, ArchiveRestore, ArrowLeft, CirclePause, CirclePlay, Loader2, Plus, Trash2 } from "lucide-react"
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
  uniqueStageName,
  isWorkNode,
  type PipelineNode,
  isWorkKind,
  OUT_HANDLE,
  shortId,
  splitOutputsOf,
  withLiveHandles,
  type FormRow,
  type GraphIssue,
  type PipelineGraph,
  type WorkKind,
} from "@/lib/production/graph"
import type { PersonOption } from "@/lib/production/people-types"
import { cn } from "@/lib/utils"
import { EditorProvider, type EditorApi } from "./editor-context"
import { DEFAULT_WIDTH, EDITABLE_HOVER, SPLIT_WIDTH } from "./node-parts"
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
 * каждом рендере. Сохраняется по кнопке или Ctrl/Cmd+S, с `revision` (§3.5):
 * разошлась — 409, и редактор предлагает подтянуть чужую версию, а не
 * перетирает её.
 */

type PipelineDto = {
  id: string
  name: string
  graph: PipelineGraph
  revision: number
  status: "draft" | "active" | "archived"
  currentVersion: number | null
  activeRuns: number
  /** Запуски на паузе: новых роликов нет, идущие доживают. */
  pausedAt: string | null
}

type Loaded = { pipeline: PipelineDto; issues: GraphIssue[]; structureChanged: boolean }

/** Только в ответе на GET: папки владельца и словарь типов файлов. */
type Extras = { projects: { id: string; name: string }[]; fileTypes: string[]; toolKeys: string[] }

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

const LABELS_DELAY_MS = 500

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
  const { screenToFlowPosition, fitView } = useReactFlow()
  const canvas = useRef<HTMLDivElement>(null)
  /**
   * Меню добавления ноды: где открыть на экране и куда поставить ноду.
   * `from` — нода и её выход, из которого бросили коннектор в пустоту: новая
   * нода сразу соединится с ней своим входом.
   */
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number }; from?: { node: string; handle?: string } } | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [graph, setGraph] = useState<PipelineGraph | null>(null)
  const [name, setName] = useState("")
  const [people, setPeople] = useState<PersonOption[]>([])
  const [extras, setExtras] = useState<Extras>({ projects: [], fileTypes: [], toolKeys: [] })
  /**
   * Несохранённое: `layout` — только раскладка (положение, ширина нод), на
   * работу пайплайна не влияет; `settings` — всё остальное.
   */
  const [dirtyLevel, setDirtyLevel] = useState<"none" | "layout" | "settings">("none")
  const dirty = dirtyLevel !== "none"
  const markDirty = useCallback(
    (level: "layout" | "settings") => setDirtyLevel((d) => (d === "settings" ? d : level)),
    [],
  )
  const [saving, setSaving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const revision = useRef(0)
  /** Имена из форм программы в проектах автоматики — с сервера. */
  const [autoLabels, setAutoLabels] = useState<{ nodeId: string; label: string }[]>([])

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
    setExtras({ projects: body.projects ?? [], fileTypes: body.fileTypes ?? [], toolKeys: body.toolKeys ?? [] })
    setGraph(body.pipeline.graph)
    setName(body.pipeline.name)
    setDirtyLevel("none")
    setConflict(false)
    if (peopleRes.ok) setPeople(((await peopleRes.json()) as { people: PersonOption[] }).people)
  }, [pipelineId, t])

  useEffect(() => {
    void load()
  }, [load])

  const readOnly = loaded?.pipeline.status === "archived"

  // ─── Сохранение ────────────────────────────────────────────────────────

  const save = useCallback(async (): Promise<Loaded | null> => {
    if (!graph || conflict) return null
    setSaving(true)
    try {
      const res = await fetch(`/api/production/pipelines/${pipelineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current, graph, name: name.trim() || undefined }),
      })
      if (res.status === 409) {
        setConflict(true)
        return null
      }
      if (!res.ok) {
        toast.error(t.productionEdSaveFailed)
        return null
      }
      const body = (await res.json()) as Loaded
      revision.current = body.pipeline.revision
      setLoaded(body)
      setDirtyLevel("none")
      return body
    } finally {
      setSaving(false)
    }
  }, [graph, name, pipelineId, conflict, t])

  // Ушли со страницы с несохранённым — браузер переспросит.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const change = useCallback(
    (fn: (g: PipelineGraph) => PipelineGraph, level: "layout" | "settings" = "settings") => {
      setGraph((g) => (g ? fn(g) : g))
      markDirty(level)
    },
    [markDirty],
  )

  // Проекты автоматики сменились или граф сохранён — перечитать их имена:
  // сервер читает проекты из сохранённого графа.
  const savedRevision = loaded?.pipeline.revision
  const autoProjects = (graph?.nodes ?? [])
    .map((n) => (n.kind === "auto" ? `${n.id}:${n.data.project.id ?? ""}` : ""))
    .filter(Boolean)
    .join(",")
  useEffect(() => {
    if (!autoProjects) {
      setAutoLabels([])
      return
    }
    const timer = window.setTimeout(() => {
      void fetch(`/api/production/pipelines/${pipelineId}/program-forms?labels=1`, { cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as { labels: { nodeId: string; label: string }[] }).labels : []))
        .then(setAutoLabels)
        .catch(() => {})
    }, LABELS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [autoProjects, pipelineId, savedRevision])

  const rowNames = useMemo(() => {
    const names = new Map((graph?.nodes ?? []).map((n) => [n.id, n.data.name]))
    const flat = (rows: FormRow[]): string[] => rows.flatMap((r) => [r.label.trim(), ...flat(r.children)])
    const fromForms = (graph?.nodes ?? []).flatMap((n) =>
      n.kind === "form" ? flat(n.data.rows).filter(Boolean).map((label) => ({ label, nodeId: n.id })) : [],
    )
    return [...fromForms, ...autoLabels]
      .filter((x) => names.has(x.nodeId))
      .map((x) => ({ ...x, nodeName: names.get(x.nodeId)! }))
  }, [autoLabels, graph?.nodes])

  // ─── Правки нод ────────────────────────────────────────────────────────

  const api: EditorApi = useMemo(() => {
    const sources = new Set((graph?.edges ?? []).map((e) => e.source))
    const errorNodes = new Set(
      (loaded?.issues ?? []).filter((i) => i.level === "error" && i.nodeId).map((i) => i.nodeId!),
    )
    return {
      pipelineId,
      readOnly: Boolean(readOnly),
      isDraft: loaded?.pipeline.status === "draft",
      people,
      projects: extras.projects,
      fileTypes: extras.fileTypes,
      toolKeys: extras.toolKeys,
      rowNames,
      updateNode: (id, fn) =>
        change((g) => withLiveHandles({ ...g, nodes: g.nodes.map((n) => (n.id === id ? fn(n) : n)) })),
      nameStage: (id, name) =>
        change((g) => {
          const unique = uniqueStageName(g.nodes, name, id)
          return {
            ...g,
            nodes: g.nodes.map((n) =>
              n.id === id && isWorkNode(n) ? ({ ...n, data: { ...n.data, name: unique } } as PipelineNode) : n,
            ),
          }
        }),
      removeNode: (id) =>
        change((g) => ({
          ...g,
          nodes: g.nodes.filter((n) => n.id !== id),
          edges: g.edges.filter((e) => e.source !== id && e.target !== id),
        })),
      nodeHasError: (id) => errorNodes.has(id),
      hasNext: (id) => sources.has(id),
    }
  }, [change, extras, graph?.edges, loaded?.issues, loaded?.pipeline.status, people, pipelineId, readOnly, rowNames])

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
        // У «Разделить» подписи полей выхода стоят слева: ноде нужно шире.
        style: { width: node.width ?? (splitOutputsOf(node).length > 0 ? SPLIT_WIDTH : DEFAULT_WIDTH[node.kind]) },
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
        sourceHandle: edge.sourceHandle ?? OUT_HANDLE,
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
      change(
        (g) => ({
        ...g,
        nodes: g.nodes
          .filter((n) => !removed.has(n.id))
          .map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n))
          .map((n) => (resized.has(n.id) ? { ...n, width: resized.get(n.id)! } : n)),
        edges: g.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
        }),
        removed.size > 0 ? "settings" : "layout",
      )
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
          ? {
              ...g,
              edges: [
                ...g.edges,
                {
                  id: shortId("e"),
                  source: c.source,
                  target: c.target,
                  ...(c.sourceHandle && c.sourceHandle !== OUT_HANDLE ? { sourceHandle: c.sourceHandle } : {}),
                },
              ],
            }
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
  const addStage = (kind: WorkKind, label: string, at?: { x: number; y: number }, from?: { node: string; handle?: string }) => {
    let position = at
    if (!position) {
      const box = canvas.current?.getBoundingClientRect()
      const center = box
        ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
        : { x: 0, y: 0 }
      position = { x: center.x - DEFAULT_WIDTH[kind] / 2, y: center.y - 160 }
    }
    change((g) => {
      const node = createWorkNode(kind, uniqueStageName(g.nodes, label), position)
      const next = { ...g, nodes: [...g.nodes, node] }
      if (!from || !canConnect(next, { source: from.node, target: node.id })) return next
      const handle = from.handle && from.handle !== OUT_HANDLE ? { sourceHandle: from.handle } : {}
      return { ...next, edges: [...next.edges, { id: shortId("e"), source: from.node, target: node.id, ...handle }] }
    })
  }

  /** Коннектор из выхода брошен не на ноду — предлагаем создать ноду в этой точке. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (readOnly || state.isValid || state.toNode || !state.fromNode || state.fromHandle?.type !== "source") return
      const point = "changedTouches" in event ? event.changedTouches[0] : event
      const box = canvas.current?.getBoundingClientRect()
      const flow = screenToFlowPosition({ x: point.clientX, y: point.clientY })
      setMenu({
        x: point.clientX - (box?.left ?? 0),
        y: point.clientY - (box?.top ?? 0),
        flow: { x: flow.x, y: flow.y - 40 },
        from: { node: state.fromNode.id, handle: state.fromHandle.id ?? undefined },
      })
    },
    [readOnly, screenToFlowPosition],
  )

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

  /** Пауза запусков: новых роликов нет, идущие доживают. Одна кнопка на оба направления. */
  const setPaused = async (paused: boolean) => {
    if (dirty) await save()
    const res = await fetch(`/api/production/pipelines/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: revision.current, paused }),
    })
    if (!res.ok) toast.error(res.status === 409 ? t.productionEdConflict : t.productionEdSaveFailed)
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
    // Подтверждение — только у активации; сохранение изменений не спрашивает.
    if (kind === "activate" && !window.confirm(t.productionEdActivateConfirm)) return
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

  /**
   * «Сохранить»: черновик в базу, а у активного пайплайна с изменённой схемой —
   * и новая версия, по которой пойдут новые ролики.
   */
  const saveAll = async () => {
    if (readOnly || saving || committing) return
    const fresh = dirty ? await save() : loaded
    if (!fresh) return
    if (fresh.pipeline.status === "active" && fresh.structureChanged) {
      if (fresh.issues.some((i) => i.level === "error")) {
        toast.error(t.productionEdHasErrors)
        return
      }
      await commit("versions")
    }
  }
  const saveAllRef = useRef(saveAll)
  saveAllRef.current = saveAll
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void saveAllRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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
              markDirty("settings")
            }}
            aria-label={t.productionEdPipelineName}
            className={cn("min-w-0 max-w-[320px] flex-1 bg-transparent text-[17px] font-semibold text-ws-1 outline-none", EDITABLE_HOVER)}
          />
          <StatusBadge status={p.status} version={p.currentVersion} />
          {p.status === "active" && p.pausedAt ? (
            <span className="text-[12px] text-warning">{t.productionEdStatusPaused}</span>
          ) : null}
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
            {p.status === "active" ? (
              <button
                type="button"
                onClick={() => void setPaused(!p.pausedAt)}
                title={p.pausedAt ? t.productionEdResume : t.productionEdPause}
                aria-label={p.pausedAt ? t.productionEdResume : t.productionEdPause}
                className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover hover:text-ws-1"
              >
                {p.pausedAt ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
                {p.pausedAt ? t.productionEdResume : t.productionEdPause}
              </button>
            ) : null}
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
            {readOnly ? null : (
              <SaveButton
                level={
                  dirtyLevel === "settings" || (p.status === "active" && loaded.structureChanged)
                    ? "settings"
                    : dirtyLevel
                }
                busy={saving || committing}
                onClick={() => void saveAll()}
              />
            )}
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
            onConnectEnd={onConnectEnd}
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
                    addStage(item.kind, t[item.label], menu.flow, menu.from)
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
            <IssuesPanel
              errors={errors}
              warnings={warnings}
              graph={graph}
              onPick={(id) => {
                // К ноде с проблемой: выделить и подвести в кадр.
                setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })))
                void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1 })
              }}
            />
          ) : null}
        </div>
      </div>
    </EditorProvider>
  )
}

/**
 * Цвет — насколько важно сохранить: только раскладка — бледно, настройки —
 * полным цветом, нечего сохранять — неактивна.
 */
function SaveButton({ level, busy, onClick }: { level: "none" | "layout" | "settings"; busy: boolean; onClick: () => void }) {
  const { t } = useI18n()
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S"
  return (
    <button
      type="button"
      disabled={busy || level === "none"}
      onClick={onClick}
      title={`${t.productionEdSaveVersion} (${shortcut})`}
      className={cn(
        "h-8 rounded-[9px] px-3 text-[13px] font-medium transition-colors",
        level === "settings" && "bg-warning text-background hover:bg-warning/90",
        level === "layout" && "border border-warning/30 bg-warning/15 text-warning hover:bg-warning/25",
        level === "none" && "border border-foreground/10 bg-ws-control text-ws-4",
        busy && "opacity-60",
      )}
    >
      {t.productionEdSaveVersion}
    </button>
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
  "form-empty": "productionIssueFormEmpty",
  "form-row-label": "productionIssueFormRowLabel",
      "split-folder": "productionIssueSplitFolder",
      "auto-last": "productionIssueAutoLast",
  "no-reviewers": "productionIssueNoReviewers",
  "no-executors": "productionIssueNoExecutors",
}

/** Проблемы графа: ошибки блокируют активацию, предупреждения — нет. */
function IssuesPanel({
  errors,
  warnings,
  graph,
  onPick,
}: {
  errors: GraphIssue[]
  warnings: GraphIssue[]
  graph: PipelineGraph
  onPick: (nodeId: string) => void
}) {
  const { t } = useI18n()
  // Без имени нода всё равно должна узнаваться — тогда по виду.
  const nameOf = (id?: string) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) return ""
    const kind = ADD_KINDS.find((k) => k.kind === node.kind)
    return node.data.name.trim() || (kind ? t[kind.label] : "")
  }
  return (
    <div className="absolute right-3 top-3 z-10 max-h-[45%] w-72 overflow-y-auto rounded-xl border border-foreground/10 bg-ws-panel p-3 shadow-ws-panel">
      <p className="mb-2 text-[12px] font-semibold text-ws-2">
        {t.productionEdIssues.replace("{e}", String(errors.length)).replace("{w}", String(warnings.length))}
      </p>
      <ul className="space-y-1.5">
        {[...errors, ...warnings].map((issue, index) => (
          <li key={index}>
            <button
              type="button"
              disabled={!issue.nodeId}
              onClick={() => issue.nodeId && onPick(issue.nodeId)}
              className={cn(
                "-mx-1 w-[calc(100%+0.5rem)] rounded px-1 py-0.5 text-left text-[12px] leading-snug enabled:hover:bg-ws-hover",
                issue.level === "error" ? "text-destructive" : "text-warning",
              )}
            >
              {nameOf(issue.nodeId) ? <span className="font-medium">{nameOf(issue.nodeId)}: </span> : null}
              {t[ISSUE_TEXT[issue.code]]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
