"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import {
  Check,
  Circle,
  Hand,
  Loader2,
  Maximize,
  Minus,
  MoveUpRight,
  Pencil,
  PenLine,
  Plus,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { ReviewComment, ReviewPoint, ReviewShape, ReviewView } from "@/lib/production/review-types"
import { cn } from "@/lib/utils"
import { mediaUrl } from "../chat/upload"
import { PALETTE, constrain } from "../image-editor"

/**
 * Инструмент пометок по картинке — docs/PRODUCTION_PLAN.md §8.2.
 *
 * Слева картинка с зумом (колесо) и панорамой (перетаскивание, пробел или
 * средняя кнопка), справа — пометки: автор, время, текст, «исправлено».
 * «+ Комментарий» начинает черновик: рисунок ложится отдельным слоем поверх
 * картинки (сама картинка не меняется), текст пишется справа, «Принять»
 * привязывает рисунок к пометке. Пока идёт черновик, прежние рисунки бледные,
 * рисовать поверх них можно. Выбранная в списке пометка ярче остальных.
 *
 * Координаты рисунка — доли картинки 0..1; толщина и текст — ступень 1..5 от
 * большей стороны картинки. Так рисунок совпадает на любом размере.
 */

export type ReviewTarget = { id: string; name: string; s3Key: string; contentType: string }

type OpenReview = (file: ReviewTarget, commentId?: string) => void

const ReviewContext = createContext<OpenReview | null>(null)

/** Открыть пометки файла этапа; null — вне этапа (инструмента нет). */
export function useReview(): OpenReview | null {
  return useContext(ReviewContext)
}

/** Даёт инструмент пометок всему, что внутри этапа: меню файла, просмотр, чат. */
export function ReviewProvider({ stepId, children }: { stepId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState<{ file: ReviewTarget; commentId?: string; at: number } | null>(null)
  const openReview = useCallback<OpenReview>((file, commentId) => setOpen({ file, commentId, at: Date.now() }), [])
  // Другой этап — окно прежнего закрывается.
  useEffect(() => setOpen(null), [stepId])
  return (
    <ReviewContext.Provider value={openReview}>
      {children}
      {open ? (
        <ReviewDialog
          key={`${open.file.id}:${open.at}`}
          stepId={stepId}
          target={open.file}
          focusId={open.commentId}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </ReviewContext.Provider>
  )
}

type Tool = "pan" | "pen" | "arrow" | "line" | "rect" | "ellipse" | "text"
type View = { zoom: number; x: number; y: number }

const uid = () => Math.random().toString(36).slice(2, 10)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function ReviewDialog({
  stepId,
  target,
  focusId,
  onClose,
}: {
  stepId: string
  target: ReviewTarget
  focusId?: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const api = `/api/production/steps/${encodeURIComponent(stepId)}/files/${encodeURIComponent(target.id)}/review`
  const [data, setData] = useState<ReviewView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(focusId ?? null)
  /** Черновик новой пометки: рисунок и текст. null — черновика нет. */
  const [draft, setDraft] = useState<{ body: string; shapes: ReviewShape[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState("#ff3b30")
  const [size, setSize] = useState(2)

  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      setData((await res.json()) as ReviewView)
    } catch {
      setLoadFailed(true)
    }
  }, [api])
  useEffect(() => void load(), [load])

  // Ссылка из чата на пометку, которой уже нет.
  const checkedFocus = useRef(false)
  useEffect(() => {
    if (!data || checkedFocus.current || !focusId) return
    checkedFocus.current = true
    if (!data.comments.some((c) => c.id === focusId)) {
      toast.error(t.productionReviewMissing)
      setSelected(null)
    }
  }, [data, focusId, t])

  const send = async (method: "POST" | "PATCH" | "DELETE", body?: unknown, query = "") => {
    setSaving(true)
    try {
      const res = await fetch(`${api}${query}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error("review")
      return (await res.json().catch(() => ({}))) as { comment?: ReviewComment }
    } catch {
      toast.error(t.productionReviewFailed)
      return null
    } finally {
      setSaving(false)
      // Свежий список: чужие пометки могли появиться между действиями.
      void load()
    }
  }

  const accept = async () => {
    if (!draft || !draft.body.trim()) return
    const result = await send("POST", { body: draft.body.trim(), shapes: draft.shapes })
    if (result?.comment) {
      setDraft(null)
      setSelected(result.comment.id)
    }
  }

  const close = () => {
    if (draft && (draft.body.trim() || draft.shapes.length > 0) && !window.confirm(t.textUnsavedDiscard)) return
    onClose()
  }

  const file = data?.file ?? target
  const comments = data?.comments ?? []

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[90vh] max-w-[min(1500px,96vw)] flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="truncate border-b border-foreground/[0.07] px-4 py-3 pr-12 text-[14px]">
          {t.productionReviewTitle} · {file.name}
        </DialogTitle>
        <DialogDescription className="sr-only">{t.productionReviewTitle}</DialogDescription>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ReviewStage
            src={mediaUrl(file.s3Key)}
            alt={file.name}
            comments={comments}
            selected={selected}
            draft={draft}
            tool={tool}
            color={color}
            size={size}
            onTool={setTool}
            onColor={setColor}
            onSize={setSize}
            onDraftShapes={(shapes) => setDraft((d) => (d ? { ...d, shapes } : d))}
          />
          <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-foreground/[0.07] md:w-[340px] md:border-l md:border-t-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[12.5px] text-ws-4">{comments.length}</span>
              <button
                type="button"
                disabled={Boolean(draft) || !data}
                onClick={() => {
                  setSelected(null)
                  setTool((tl) => (tl === "pan" ? "pen" : tl))
                  setDraft({ body: "", shapes: [] })
                }}
                className="flex h-8 items-center gap-1 rounded-[9px] bg-ws-accent px-3 text-[13px] font-medium text-background hover:bg-ws-accent/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {t.productionReviewAdd}
              </button>
            </div>
            {draft ? (
              <div className="space-y-2 border-y border-foreground/[0.07] bg-ws-control/40 px-3 py-3">
                <textarea
                  autoFocus
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void accept()
                  }}
                  placeholder={t.productionReviewPlaceholder}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-foreground/10 bg-background px-2.5 py-2 text-[13px] text-ws-1 outline-none focus:border-ws-accent/60"
                />
                <p className="text-[11.5px] text-ws-4">{t.productionReviewDrawHint}</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="h-8 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
                  >
                    {t.productionReviewCancel}
                  </button>
                  <button
                    type="button"
                    disabled={saving || !draft.body.trim()}
                    onClick={() => void accept()}
                    className="flex h-8 items-center gap-1.5 rounded-[9px] bg-success px-3 text-[13px] font-medium text-background hover:bg-success/90 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {t.productionReviewAccept}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {!data ? (
                loadFailed ? (
                  <p className="px-2 py-6 text-center text-[12.5px] text-ws-4">{t.productionReviewLoadFailed}</p>
                ) : (
                  <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-ws-4" />
                )
              ) : comments.length === 0 && !draft ? (
                <p className="px-2 py-6 text-center text-[12.5px] text-ws-4">{t.productionReviewEmpty}</p>
              ) : (
                <ul className="space-y-1.5">
                  {comments.map((comment, index) => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      index={index + 1}
                      me={data.me}
                      selected={selected === comment.id}
                      saving={saving}
                      onSelect={() => setSelected((s) => (s === comment.id ? null : comment.id))}
                      onResolve={(resolved) => void send("PATCH", { commentId: comment.id, resolved })}
                      onEdit={async (body) => Boolean(await send("PATCH", { commentId: comment.id, body }))}
                      onDelete={() => {
                        if (!window.confirm(t.productionReviewDeleteConfirm)) return
                        if (selected === comment.id) setSelected(null)
                        void send("DELETE", undefined, `?commentId=${encodeURIComponent(comment.id)}`)
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Пометка в списке ─────────────────────────────────────────────────────

function CommentItem({
  comment,
  index,
  me,
  selected,
  saving,
  onSelect,
  onResolve,
  onEdit,
  onDelete,
}: {
  comment: ReviewComment
  index: number
  me: ReviewView["me"]
  selected: boolean
  saving: boolean
  onSelect: () => void
  onResolve: (resolved: boolean) => void
  onEdit: (body: string) => Promise<boolean>
  onDelete: () => void
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const ref = useRef<HTMLLIElement>(null)
  const mine = comment.authorId === me.userId
  const resolved = Boolean(comment.resolvedAt)
  const time = new Date(comment.createdAt).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-lg border px-2.5 py-2 text-[13px]",
        selected ? "border-ws-accent/60 bg-ws-accent/10" : "border-transparent hover:bg-ws-hover",
        resolved && !selected && "opacity-60",
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ws-4">
          <span className="tabular-nums">#{index}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-ws-2">{comment.authorName}</span>
          <span className="shrink-0">{time}</span>
        </span>
        {editing === null ? (
          <span className={cn("mt-0.5 block whitespace-pre-wrap break-words text-ws-1", resolved && "line-through decoration-ws-4")}>
            {comment.body}
            {comment.editedAt ? <span className="ml-1 text-[11px] text-ws-5">({t.productionReviewEdited})</span> : null}
          </span>
        ) : null}
      </button>
      {editing !== null ? (
        <div className="mt-1 space-y-1.5">
          <textarea
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-foreground/10 bg-background px-2 py-1.5 text-[13px] text-ws-1 outline-none focus:border-ws-accent/60"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-7 rounded-md border border-foreground/10 px-2 text-[12px] text-ws-2 hover:bg-ws-hover"
            >
              {t.productionReviewCancel}
            </button>
            <button
              type="button"
              disabled={saving || !editing.trim()}
              onClick={() => void onEdit(editing.trim()).then((ok) => ok && setEditing(null))}
              className="h-7 rounded-md bg-ws-accent px-2 text-[12px] font-medium text-background disabled:opacity-50"
            >
              {t.productionReviewSave}
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-1 flex items-center gap-1">
        {me.canResolve ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ws-3">
            <input
              type="checkbox"
              checked={resolved}
              disabled={saving}
              onChange={(e) => onResolve(e.target.checked)}
              className="h-3.5 w-3.5 accent-success"
            />
            {resolved && comment.resolvedByName ? tf(t.productionReviewResolvedBy, { name: comment.resolvedByName }) : t.productionReviewResolved}
          </label>
        ) : resolved ? (
          <span className="flex items-center gap-1 text-[12px] text-success">
            <Check className="h-3.5 w-3.5" />
            {comment.resolvedByName ? tf(t.productionReviewResolvedBy, { name: comment.resolvedByName }) : t.productionReviewResolved}
          </span>
        ) : null}
        <span className="flex-1" />
        {mine && editing === null ? (
          <button
            type="button"
            title={t.productionReviewEdit}
            aria-label={t.productionReviewEdit}
            onClick={() => setEditing(comment.body)}
            className="flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-ws-1"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {mine || me.isOwner ? (
          <button
            type="button"
            title={t.productionReviewDelete}
            aria-label={t.productionReviewDelete}
            disabled={saving}
            onClick={onDelete}
            className="flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  )
}

// ─── Картинка, зум и рисунок ──────────────────────────────────────────────

function ReviewStage({
  src,
  alt,
  comments,
  selected,
  draft,
  tool,
  color,
  size,
  onTool,
  onColor,
  onSize,
  onDraftShapes,
}: {
  src: string
  alt: string
  comments: ReviewComment[]
  selected: string | null
  draft: { body: string; shapes: ReviewShape[] } | null
  tool: Tool
  color: string
  size: number
  onTool: (tool: Tool) => void
  onColor: (color: string) => void
  onSize: (size: number) => void
  onDraftShapes: (shapes: ReviewShape[]) => void
}) {
  const { t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  const [space, setSpace] = useState(false)
  /** Фигура, которую рисуют прямо сейчас. */
  const [current, setCurrent] = useState<ReviewShape | null>(null)
  /** Текст, который вводят: место в долях картинки. */
  const [textAt, setTextAt] = useState<ReviewPoint | null>(null)
  const [textValue, setTextValue] = useState("")
  const drag = useRef<{ kind: "pan"; startX: number; startY: number; from: View } | { kind: "draw"; origin: ReviewPoint } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Пробел — временно «двигать», если фокус не в поле ввода.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  const fit = natural && box.w && box.h ? Math.min(box.w / natural.w, box.h / natural.h) : 0
  const width = natural ? natural.w * fit * view.zoom : 0
  const height = natural ? natural.h * fit * view.zoom : 0
  const left = (box.w - width) / 2 + view.x
  const top = (box.h - height) / 2 + view.y

  // Колесо — зум вокруг курсора; слушатель не пассивный, чтобы не листать окно.
  const geometry = useRef({ left, top, width, height, box })
  geometry.current = { left, top, width, height, box }
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const g = geometry.current
      if (!g.width) return
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const zoom = Math.min(12, Math.max(0.2, v.zoom * Math.exp(-e.deltaY * 0.0015)))
        const k = zoom / v.zoom
        const w2 = g.width * k
        const h2 = g.height * k
        const left2 = mx - (mx - g.left) * k
        const top2 = my - (my - g.top) * k
        return { zoom, x: left2 - (g.box.w - w2) / 2, y: top2 - (g.box.h - h2) / 2 }
      })
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])

  const drafting = draft !== null
  const panning = !drafting || tool === "pan" || space

  const toPoint = (e: React.PointerEvent): ReviewPoint => {
    const rect = svgRef.current!.getBoundingClientRect()
    return [clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height)]
  }

  const commitText = () => {
    if (textAt && textValue.trim() && draft) {
      onDraftShapes([...draft.shapes, { id: uid(), kind: "text", color, size, at: textAt, text: textValue.trim() }])
    }
    setTextAt(null)
    setTextValue("")
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (textAt) commitText()
    if (panning || e.button === 1) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0 || !natural || !svgRef.current) return
    const p = toPoint(e)
    if (tool === "text") {
      setTextAt(p)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind: "draw", origin: p }
    const style = { id: uid(), color, size }
    setCurrent(
      tool === "pen"
        ? { ...style, kind: "pen", points: [p] }
        : { ...style, kind: tool as "arrow" | "line" | "rect" | "ellipse", a: p, b: p },
    )
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + e.clientX - d.startX, y: d.from.y + e.clientY - d.startY })
      return
    }
    if (!current || !natural) return
    const p = toPoint(e)
    if (current.kind === "pen") {
      const last = current.points[current.points.length - 1]!
      // Точки чаще полпикселя экрана не нужны.
      if (Math.hypot((p[0] - last[0]) * width, (p[1] - last[1]) * height) < 1.5) return
      setCurrent({ ...current, points: [...current.points, p] })
    } else if (current.kind !== "text") {
      let b = p
      if (e.shiftKey) {
        // Shift — как в редакторе картинки: 45° и квадрат, в пикселях картинки.
        const c = constrain(
          current.kind,
          { x: d.origin[0] * natural.w, y: d.origin[1] * natural.h },
          { x: p[0] * natural.w, y: p[1] * natural.h },
        )
        b = [c.x / natural.w, c.y / natural.h]
      }
      setCurrent({ ...current, b })
    }
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind !== "draw" || !current || !draft) {
      setCurrent(null)
      return
    }
    const tiny =
      current.kind !== "pen" && current.kind !== "text" && Math.hypot((current.b[0] - current.a[0]) * width, (current.b[1] - current.a[1]) * height) < 3
    if (!tiny) onDraftShapes([...draft.shapes, current])
    setCurrent(null)
  }

  const unit = natural ? Math.max(natural.w, natural.h) / 500 : 1
  const groupOpacity = (comment: ReviewComment) => {
    // Пока рисуют новую пометку, прежние тусклые; выбранную в списке видно ярче.
    if (drafting) return selected === comment.id ? 0.8 : 0.3
    if (selected) return selected === comment.id ? 1 : 0.15
    return comment.resolvedAt ? 0.35 : 1
  }

  const tools: { id: Tool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: "pan", icon: Hand, label: t.productionReviewToolPan },
    { id: "pen", icon: PenLine, label: t.productionReviewToolPen },
    { id: "arrow", icon: MoveUpRight, label: t.productionReviewToolArrow },
    { id: "line", icon: Minus, label: t.productionReviewToolLine },
    { id: "rect", icon: Square, label: t.productionReviewToolRect },
    { id: "ellipse", icon: Circle, label: t.productionReviewToolEllipse },
    { id: "text", icon: Type, label: t.productionReviewToolText },
  ]

  return (
    <div className="relative flex min-h-[240px] min-w-0 flex-1 flex-col bg-black/90">
      {drafting ? (
        <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-foreground/10 bg-background/95 p-1 shadow">
          {tools.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onTool(id)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-ws-3 hover:bg-ws-hover hover:text-ws-1",
                tool === id && "bg-ws-select/50 text-ws-1",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-foreground/10" />
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => onColor(c)}
              className={cn("h-5 w-5 rounded-full border border-foreground/20", color === c && "ring-2 ring-ws-accent ring-offset-1 ring-offset-background")}
              style={{ background: c }}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-foreground/10" />
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              title={t.productionReviewSize}
              onClick={() => onSize(s)}
              className={cn(
                "flex h-7 w-6 items-center justify-center rounded-md hover:bg-ws-hover",
                size === s && "bg-ws-select/50",
              )}
            >
              <span className="rounded-full bg-ws-1" style={{ width: 2 + s * 2, height: 2 + s * 2 }} />
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-foreground/10" />
          <button
            type="button"
            title={t.productionReviewUndo}
            aria-label={t.productionReviewUndo}
            disabled={!draft || draft.shapes.length === 0}
            onClick={() => draft && onDraftShapes(draft.shapes.slice(0, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ws-3 hover:bg-ws-hover hover:text-ws-1 disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        title={t.productionReviewFit}
        aria-label={t.productionReviewFit}
        onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
        className="absolute bottom-2 right-2 z-10 flex h-7 items-center gap-1 rounded-md bg-background/90 px-2 text-[11.5px] tabular-nums text-ws-2 hover:bg-background"
      >
        <Maximize className="h-3.5 w-3.5" />
        {Math.round(view.zoom * 100)}%
      </button>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onAuxClick={(e) => e.preventDefault()}
        className={cn(
          "relative min-h-0 flex-1 touch-none select-none overflow-hidden",
          panning ? (drag.current?.kind === "pan" ? "cursor-grabbing" : "cursor-grab") : tool === "text" ? "cursor-text" : "cursor-crosshair",
        )}
      >
        <div className="absolute" style={{ left, top, width, height }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          {natural ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${natural.w} ${natural.h}`}
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            >
              {comments.map((comment) => (
                <g key={comment.id} opacity={groupOpacity(comment)}>
                  {comment.shapes.map((shape) => (
                    <ShapeView key={shape.id} shape={shape} w={natural.w} h={natural.h} unit={unit} />
                  ))}
                </g>
              ))}
              {draft ? (
                <g>
                  {draft.shapes.map((shape) => (
                    <ShapeView key={shape.id} shape={shape} w={natural.w} h={natural.h} unit={unit} />
                  ))}
                  {current ? <ShapeView shape={current} w={natural.w} h={natural.h} unit={unit} /> : null}
                </g>
              ) : null}
            </svg>
          ) : null}
          {textAt ? (
            <input
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText()
                if (e.key === "Escape") {
                  e.stopPropagation()
                  setTextAt(null)
                  setTextValue("")
                }
              }}
              onBlur={commitText}
              placeholder={t.productionReviewTextPlaceholder}
              className="absolute min-w-[140px] rounded border border-ws-accent bg-background/90 px-1.5 py-0.5 text-[13px] text-ws-1 outline-none"
              style={{ left: `${textAt[0] * 100}%`, top: `${textAt[1] * 100}%`, color }}
            />
          ) : null}
        </div>
        {!natural ? <Loader2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/60" /> : null}
      </div>
    </div>
  )
}

/** Фигура в пикселях картинки: доли умножаются на её размер. */
function ShapeView({ shape, w, h, unit }: { shape: ReviewShape; w: number; h: number; unit: number }) {
  const px = (p: ReviewPoint) => ({ x: p[0] * w, y: p[1] * h })
  const stroke = unit * (0.8 + shape.size * 0.9)
  const common = {
    stroke: shape.color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  }
  if (shape.kind === "pen") {
    const points = shape.points.map(px)
    if (points.length === 1) return <circle cx={points[0]!.x} cy={points[0]!.y} r={stroke / 2} fill={shape.color} />
    return <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} {...common} />
  }
  if (shape.kind === "text") {
    const at = px(shape.at)
    const font = unit * (8 + shape.size * 5)
    return (
      <text
        x={at.x}
        y={at.y}
        fill={shape.color}
        fontSize={font}
        dominantBaseline="hanging"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        paintOrder="stroke"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={font * 0.08}
      >
        {shape.text}
      </text>
    )
  }
  const a = px(shape.a)
  const b = px(shape.b)
  if (shape.kind === "line") return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
  if (shape.kind === "rect") {
    return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...common} />
  }
  if (shape.kind === "ellipse") {
    return <ellipse cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} {...common} />
  }
  // Стрелка: линия до основания и залитый наконечник — как в редакторе картинки.
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const head = Math.max(stroke * 4, unit * 7)
  const base = { x: b.x - Math.cos(angle) * head * 0.8, y: b.y - Math.sin(angle) * head * 0.8 }
  const tip = [
    `${b.x},${b.y}`,
    `${b.x - head * Math.cos(angle - 0.45)},${b.y - head * Math.sin(angle - 0.45)}`,
    `${b.x - head * Math.cos(angle + 0.45)},${b.y - head * Math.sin(angle + 0.45)}`,
  ].join(" ")
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={base.x} y2={base.y} {...common} />
      <polygon points={tip} fill={shape.color} />
    </g>
  )
}

/** Для меню и просмотра: можно ли открыть пометки этого файла (пока — картинки). */
export function reviewable(file: { name: string; contentType: string }): boolean {
  return /^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.contentType) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)
}

