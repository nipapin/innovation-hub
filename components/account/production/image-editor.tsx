"use client"

import { useEffect, useRef, useState } from "react"
import {
  Circle,
  Crop,
  Droplet,
  FlipHorizontal,
  Highlighter,
  Loader2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Redo2,
  RotateCw,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

/**
 * Правка картинки в браузере — как Яндекс Скриншоты: стрелки, текст, фигуры,
 * маркер, размытие и обрезка; плюс поворот, отражение, яркость, контраст и
 * насыщенность. Всё считается на canvas, без машин, и сохраняется тем же
 * форматом поверх файла.
 *
 * Каждая пометка — объект: его можно выделить, перетащить, потянуть за ручки,
 * поменять цвет, толщину, прозрачность (у текста — шрифт и размер), удалить.
 * Координаты — в пикселях повёрнутой картинки; поворот и отражение
 * пересчитывают их. Обрезка — рамка поверх, правится ручками и применяется
 * только при сохранении. Отмена и повтор — по всему документу: пометки,
 * поворот, обрезка.
 *
 * Shift: маркер рисует по одной оси (по первому движению), стрелка и линия
 * ложатся по 45°, прямоугольник и эллипс — квадрат и круг.
 */

type P = { x: number; y: number }
type Style = { color: string; size: number; opacity: number }
type TwoPoint = Style & { id: string; kind: "arrow" | "line" | "rect" | "ellipse" | "blur"; a: P; b: P }
type Marker = Style & { id: string; kind: "marker"; points: P[] }
type Text = Style & { id: string; kind: "text"; at: P; text: string; font: FontId }
type Obj = TwoPoint | Marker | Text
type Rect = { x: number; y: number; w: number; h: number }
type Doc = { objs: Obj[]; rotation: number; flip: boolean; crop: Rect | null }
type ShapeKind = "rect" | "ellipse" | "line"
type Tool = "select" | "arrow" | "text" | "shape" | "marker" | "blur" | "crop"

type FontId = "sans" | "serif" | "mono" | "display"
const FONTS: { id: FontId; label: string; css: (px: number) => string }[] = [
  { id: "sans", label: "Sans", css: (px) => `600 ${px}px system-ui, -apple-system, sans-serif` },
  { id: "serif", label: "Serif", css: (px) => `600 ${px}px Georgia, "Times New Roman", serif` },
  { id: "mono", label: "Mono", css: (px) => `600 ${px}px ui-monospace, Menlo, monospace` },
  { id: "display", label: "Impact", css: (px) => `${px}px Impact, "Arial Black", sans-serif` },
]
const fontOf = (id: FontId) => FONTS.find((f) => f.id === id) ?? FONTS[0]!

export const PALETTE = ["#1c1c1e", "#ffffff", "#8e8e93", "#0a84ff", "#ffd60a", "#ff3b30", "#30d158", "#bf5af2"]

const uid = () => Math.random().toString(36).slice(2, 10)

function mapObj(o: Obj, f: (p: P) => P): Obj {
  if (o.kind === "marker") return { ...o, points: o.points.map(f) }
  if (o.kind === "text") return { ...o, at: f(o.at) }
  return { ...o, a: f(o.a), b: f(o.b) }
}

function norm(a: P, b: P): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const inside = (p: P, r: Rect, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

/** Форматы, которые браузер умеет и прочитать, и записать. */
export function editableImageMime(name: string): string | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  return null
}

type Drag =
  | { mode: "create"; id: string; start: P; axis: "x" | "y" | null }
  | { mode: "move"; id: string; start: P; snapshot: Obj }
  | { mode: "handle"; id: string; which: "a" | "b" | "scale"; start: P; snapshot: Obj; box: Rect }
  | { mode: "crop-new"; start: P }
  | { mode: "crop-move"; start: P; snapshot: Rect }
  | { mode: "crop-edge"; edges: string; snapshot: Rect }

export function ImageEditor({
  src,
  mime,
  onSave,
  onCancel,
}: {
  src: string
  mime: string
  onSave: (blob: Blob) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [doc, setDoc] = useState<Doc>({ objs: [], rotation: 0, flip: false, crop: null })
  const [past, setPast] = useState<Doc[]>([])
  const [future, setFuture] = useState<Doc[]>([])
  const [adjust, setAdjust] = useState({ brightness: 100, contrast: 100, saturation: 100 })
  const [tool, setTool] = useState<Tool>("arrow")
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect")
  const [style, setStyle] = useState<Style>({ color: "#ff3b30", size: 3, opacity: 100 })
  const [textStyle, setTextStyle] = useState<{ size: number; font: FontId }>({ size: 4, font: "sans" })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Сколько пикселей картинки в одном пикселе экрана — для ручек и допусков. */
  const [scale, setScale] = useState(1)
  const drag = useRef<Drag | null>(null)
  const before = useRef<Doc | null>(null)
  const textBoxes = useRef(new Map<string, Rect>())
  /** Курсор над холстом: рука — тащить, стрелки — менять размер. */
  const [cursor, setCursor] = useState<string | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setImage(img)
    img.onerror = () => setFailed(true)
    img.src = src
  }, [src])

  const turned = doc.rotation % 180 !== 0
  const W = image ? (turned ? image.naturalHeight : image.naturalWidth) : 0
  const H = image ? (turned ? image.naturalWidth : image.naturalHeight) : 0
  const unit = Math.max(W, H)
  const thickness = (size: number) => Math.max(1, (size * unit) / 400)
  const textPx = (size: number) => Math.max(8, unit * (0.01 + size * 0.006))

  // ─── История ─────────────────────────────────────────────────────────

  /** Правка документа одним шагом истории. */
  const commit = (next: (d: Doc) => Doc) => {
    setPast((p) => [...p.slice(-80), doc])
    setFuture([])
    setDoc(next(doc))
  }
  /** Перетаскивание: шаг истории пишется один раз — по отпусканию. */
  const live = (next: (d: Doc) => Doc) => setDoc(next)
  const startLive = () => {
    before.current = doc
  }
  const endLive = () => {
    const prev = before.current
    before.current = null
    if (!prev || prev === doc) return
    setPast((p) => [...p.slice(-80), prev])
    setFuture([])
  }
  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [doc, ...f])
    setDoc(prev)
    setSelected(null)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setFuture((f) => f.slice(1))
    setPast((p) => [...p, doc])
    setDoc(next)
    setSelected(null)
  }

  const patchObj = (id: string, patch: (o: Obj) => Obj) =>
    commit((d) => ({ ...d, objs: d.objs.map((o) => (o.id === id ? patch(o) : o)) }))
  const removeObj = (id: string) => {
    commit((d) => ({ ...d, objs: d.objs.filter((o) => o.id !== id) }))
    setSelected(null)
  }

  // ─── Отрисовка ───────────────────────────────────────────────────────

  const drawBase = (ctx: CanvasRenderingContext2D, extraFilter = "") => {
    if (!image) return
    ctx.save()
    ctx.filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%) ${extraFilter}`
    ctx.translate(W / 2, H / 2)
    ctx.rotate((doc.rotation * Math.PI) / 180)
    if (doc.flip) ctx.scale(-1, 1)
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    ctx.restore()
  }

  const drawObj = (ctx: CanvasRenderingContext2D, o: Obj) => {
    ctx.save()
    ctx.globalAlpha = o.opacity / 100
    ctx.strokeStyle = ctx.fillStyle = o.color
    ctx.lineCap = ctx.lineJoin = "round"
    const w = thickness(o.size)
    ctx.lineWidth = w
    if (o.kind === "blur") {
      const r = norm(o.a, o.b)
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.rect(r.x, r.y, r.w, r.h)
      ctx.clip()
      drawBase(ctx, `blur(${Math.max(2, (o.size * unit) / 300)}px)`)
    } else if (o.kind === "marker") {
      ctx.beginPath()
      o.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      if (o.points.length === 1) ctx.lineTo(o.points[0]!.x + 0.1, o.points[0]!.y)
      ctx.stroke()
    } else if (o.kind === "line") {
      ctx.beginPath()
      ctx.moveTo(o.a.x, o.a.y)
      ctx.lineTo(o.b.x, o.b.y)
      ctx.stroke()
    } else if (o.kind === "arrow") {
      const angle = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x)
      const head = Math.max(w * 4, unit / 70)
      const base = { x: o.b.x - Math.cos(angle) * head * 0.8, y: o.b.y - Math.sin(angle) * head * 0.8 }
      ctx.beginPath()
      ctx.moveTo(o.a.x, o.a.y)
      ctx.lineTo(base.x, base.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(o.b.x, o.b.y)
      ctx.lineTo(o.b.x - head * Math.cos(angle - 0.45), o.b.y - head * Math.sin(angle - 0.45))
      ctx.lineTo(o.b.x - head * Math.cos(angle + 0.45), o.b.y - head * Math.sin(angle + 0.45))
      ctx.closePath()
      ctx.fill()
    } else if (o.kind === "rect") {
      const r = norm(o.a, o.b)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    } else if (o.kind === "ellipse") {
      const r = norm(o.a, o.b)
      ctx.beginPath()
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (o.kind === "text") {
      const px = textPx(o.size)
      ctx.font = fontOf(o.font).css(px)
      ctx.textBaseline = "top"
      const lines = o.text.split("\n")
      let width = 0
      lines.forEach((line, i) => {
        width = Math.max(width, ctx.measureText(line).width)
        if (o.id !== editing) ctx.fillText(line, o.at.x, o.at.y + i * px * 1.2)
      })
      textBoxes.current.set(o.id, { x: o.at.x, y: o.at.y, w: Math.max(width, px), h: lines.length * px * 1.2 })
    }
    ctx.restore()
  }

  const boxOf = (o: Obj): Rect => {
    if (o.kind === "text") return textBoxes.current.get(o.id) ?? { x: o.at.x, y: o.at.y, w: 10, h: 10 }
    if (o.kind === "marker") {
      const xs = o.points.map((p) => p.x)
      const ys = o.points.map((p) => p.y)
      const pad = thickness(o.size) / 2
      return {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + pad * 2,
        h: Math.max(...ys) - Math.min(...ys) + pad * 2,
      }
    }
    return norm(o.a, o.b)
  }

  const handleR = 6 * scale

  const paint = (ctx: CanvasRenderingContext2D, forSave: boolean) => {
    ctx.clearRect(0, 0, W, H)
    drawBase(ctx)
    for (const o of doc.objs) drawObj(ctx, o)
    if (forSave) return
    if (doc.crop) {
      const c = doc.crop
      ctx.save()
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.rect(c.x, c.y, c.w, c.h)
      ctx.fill("evenodd")
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 1.5 * scale
      ctx.setLineDash([6 * scale, 4 * scale])
      ctx.strokeRect(c.x, c.y, c.w, c.h)
      if (tool === "crop") {
        ctx.setLineDash([])
        ctx.fillStyle = "#fff"
        for (const p of cropHandles(c)) ctx.fillRect(p.x - handleR, p.y - handleR, handleR * 2, handleR * 2)
      }
      // Размер кадра после обрезки — в пикселях картинки, плашкой над рамкой
      // (или внутри у верхнего края, если сверху места нет).
      const label = `${Math.round(c.w)} × ${Math.round(c.h)}`
      ctx.setLineDash([])
      ctx.font = `600 ${12 * scale}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width + 12 * scale
      const th = 20 * scale
      const lx = Math.min(Math.max(0, c.x), W - tw)
      const ly = c.y - th - 6 * scale >= 0 ? c.y - th - 6 * scale : c.y + 6 * scale
      ctx.fillStyle = "rgba(0,0,0,0.75)"
      ctx.fillRect(lx, ly, tw, th)
      ctx.fillStyle = "#fff"
      ctx.textBaseline = "middle"
      ctx.fillText(label, lx + 6 * scale, ly + th / 2)
      ctx.restore()
    }
    const sel = doc.objs.find((o) => o.id === selected)
    if (sel && sel.id !== editing) {
      ctx.save()
      ctx.strokeStyle = "#0a84ff"
      ctx.lineWidth = 1.5 * scale
      ctx.setLineDash([5 * scale, 4 * scale])
      const b = boxOf(sel)
      ctx.strokeRect(b.x - 4 * scale, b.y - 4 * scale, b.w + 8 * scale, b.h + 8 * scale)
      ctx.setLineDash([])
      ctx.fillStyle = "#fff"
      const handles: P[] =
        sel.kind === "text"
          ? [{ x: b.x + b.w + 4 * scale, y: b.y + b.h + 4 * scale }]
          : sel.kind === "marker"
            ? []
            : [sel.a, sel.b]
      for (const h of handles) {
        ctx.beginPath()
        ctx.arc(h.x, h.y, handleR, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx || !image) return
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H
    paint(ctx, false)
  })

  // Масштаб экрана к картинке — для ручек, допусков и поля ввода текста.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !W) return
    const update = () => setScale(W / Math.max(1, canvas.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [W, image])

  // ─── Указатель ───────────────────────────────────────────────────────

  const toImage = (event: React.PointerEvent<HTMLCanvasElement>): P => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(W, Math.max(0, ((event.clientX - box.left) / box.width) * W)),
      y: Math.min(H, Math.max(0, ((event.clientY - box.top) / box.height) * H)),
    }
  }

  const cropHandles = (c: Rect): (P & { edges: string })[] => [
    { x: c.x, y: c.y, edges: "nw" },
    { x: c.x + c.w / 2, y: c.y, edges: "n" },
    { x: c.x + c.w, y: c.y, edges: "ne" },
    { x: c.x + c.w, y: c.y + c.h / 2, edges: "e" },
    { x: c.x + c.w, y: c.y + c.h, edges: "se" },
    { x: c.x + c.w / 2, y: c.y + c.h, edges: "s" },
    { x: c.x, y: c.y + c.h, edges: "sw" },
    { x: c.x, y: c.y + c.h / 2, edges: "w" },
  ]

  const hit = (p: P): Obj | null => {
    const tol = 6 * scale
    for (let i = doc.objs.length - 1; i >= 0; i -= 1) {
      const o = doc.objs[i]!
      const w = thickness(o.size) / 2 + tol
      if (o.kind === "marker") {
        if (o.points.some((q, j) => segDist(p, j ? o.points[j - 1]! : q, q) <= w)) return o
      } else if (o.kind === "arrow" || o.kind === "line") {
        if (segDist(p, o.a, o.b) <= w) return o
      } else if (inside(p, boxOf(o), tol)) {
        return o
      }
    }
    return null
  }

  /** Ручка выделенного объекта под указателем. */
  const handleAt = (p: P): "a" | "b" | "scale" | null => {
    const sel = doc.objs.find((o) => o.id === selected)
    if (!sel) return null
    const near = (q: P) => Math.hypot(p.x - q.x, p.y - q.y) <= handleR * 1.6
    if (sel.kind === "text") {
      const b = boxOf(sel)
      return near({ x: b.x + b.w + 4 * scale, y: b.y + b.h + 4 * scale }) ? "scale" : null
    }
    if (sel.kind === "marker") return null
    if (near(sel.b)) return "b"
    if (near(sel.a)) return "a"
    return null
  }

  /** Что можно утащить в текущем инструменте: в «Выборе» — всё, иначе — своё и выделенное. */
  const movable = (o: Obj) =>
    tool === "select" || o.id === selected || tool === o.kind || (tool === "shape" && ["rect", "ellipse", "line"].includes(o.kind))

  /** Стрелки по диагонали ручки: куда растёт объект, тянущийся за неё. */
  const diagonal = (from: P, to: P) => ((to.x - from.x) * (to.y - from.y) >= 0 ? "nwse-resize" : "nesw-resize")

  const CROP_CURSOR: Record<string, string> = {
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  }

  /** Курсор для точки без нажатия; null — курсор инструмента. */
  const hoverCursor = (p: P): string | null => {
    if (editing) return null
    if (tool === "crop") {
      const c = doc.crop
      if (!c) return null
      const edge = cropHandles(c).find((h) => Math.hypot(p.x - h.x, p.y - h.y) <= handleR * 1.8)
      if (edge) return CROP_CURSOR[edge.edges] ?? null
      return inside(p, c) ? "grab" : null
    }
    const handle = handleAt(p)
    const sel = doc.objs.find((o) => o.id === selected)
    if (handle && sel) {
      if (sel.kind === "text") return "nwse-resize"
      if (sel.kind !== "marker") return handle === "a" ? diagonal(sel.b, sel.a) : diagonal(sel.a, sel.b)
    }
    const target = hit(p)
    return target && movable(target) ? "grab" : null
  }

  const newText = (at: P) => {
    const o: Text = { id: uid(), kind: "text", at, text: "", font: textStyle.font, color: style.color, size: textStyle.size, opacity: style.opacity }
    commit((d) => ({ ...d, objs: [...d.objs, o] }))
    setSelected(o.id)
    setEditing(o.id)
  }

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (editing) {
      finishText()
      return
    }
    const p = toImage(event)
    event.currentTarget.setPointerCapture(event.pointerId)

    if (tool === "crop") {
      const c = doc.crop
      const edge = c ? cropHandles(c).find((h) => Math.hypot(p.x - h.x, p.y - h.y) <= handleR * 1.8) : null
      startLive()
      if (c && edge) drag.current = { mode: "crop-edge", edges: edge.edges, snapshot: c }
      else if (c && inside(p, c)) {
        drag.current = { mode: "crop-move", start: p, snapshot: c }
        setCursor("grabbing")
      }
      else {
        drag.current = { mode: "crop-new", start: p }
        live((d) => ({ ...d, crop: { x: p.x, y: p.y, w: 0, h: 0 } }))
      }
      return
    }

    // Ручки и перетаскивание работают в любом инструменте — как в скриншотах.
    const handle = handleAt(p)
    const sel = doc.objs.find((o) => o.id === selected)
    if (handle && sel) {
      startLive()
      drag.current = { mode: "handle", id: sel.id, which: handle, start: p, snapshot: sel, box: boxOf(sel) }
      return
    }
    const target = hit(p)
    if (target && movable(target)) {
      setSelected(target.id)
      setCursor("grabbing")
      startLive()
      drag.current = { mode: "move", id: target.id, start: p, snapshot: target }
      return
    }
    if (tool === "select") {
      setSelected(target?.id ?? null)
      return
    }
    if (tool === "text") {
      newText(p)
      return
    }
    const id = uid()
    const kind = tool === "shape" ? shapeKind : tool
    const o: Obj =
      kind === "marker"
        ? { id, kind, points: [p], ...style }
        : { id, kind: kind as TwoPoint["kind"], a: p, b: p, ...style, ...(kind === "blur" ? { size: 5, opacity: 100 } : {}) }
    startLive()
    live((d) => ({ ...d, objs: [...d.objs, o] }))
    setSelected(id)
    drag.current = { mode: "create", id, start: p, axis: null }
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current
    let p = toImage(event)
    if (!g) {
      setCursor(hoverCursor(p))
      return
    }
    const shift = event.shiftKey

    if (g.mode === "crop-new") {
      live((d) => ({ ...d, crop: norm(g.start, p) }))
      return
    }
    if (g.mode === "crop-move") {
      const s = g.snapshot
      const x = Math.min(W - s.w, Math.max(0, s.x + p.x - g.start.x))
      const y = Math.min(H - s.h, Math.max(0, s.y + p.y - g.start.y))
      live((d) => ({ ...d, crop: { ...s, x, y } }))
      return
    }
    if (g.mode === "crop-edge") {
      const s = g.snapshot
      let x1 = s.x
      let y1 = s.y
      let x2 = s.x + s.w
      let y2 = s.y + s.h
      if (g.edges.includes("w")) x1 = p.x
      if (g.edges.includes("e")) x2 = p.x
      if (g.edges.includes("n")) y1 = p.y
      if (g.edges.includes("s")) y2 = p.y
      live((d) => ({ ...d, crop: norm({ x: x1, y: y1 }, { x: x2, y: y2 }) }))
      return
    }

    const replace = (o: Obj) => live((d) => ({ ...d, objs: d.objs.map((x) => (x.id === o.id ? o : x)) }))
    const current = doc.objs.find((o) => o.id === g.id)
    if (!current) return

    if (g.mode === "move") {
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      replace(mapObj(g.snapshot, (q) => ({ x: q.x + dx, y: q.y + dy })))
      return
    }
    if (g.mode === "handle") {
      const s = g.snapshot
      if (s.kind === "text") {
        // От размера в начале перетаскивания, а не от текущего — иначе рост ускоряется.
        const ratio = Math.max(0.2, (g.box.h + (p.y - g.start.y)) / Math.max(1, g.box.h))
        replace({ ...s, size: Math.max(1, Math.min(40, Math.round(s.size * ratio * 10) / 10)) })
      } else if (s.kind !== "marker") {
        const other = g.which === "a" ? s.b : s.a
        if (shift) p = constrain(s.kind, other, p)
        replace({ ...s, [g.which]: p } as Obj)
      }
      return
    }
    // create
    if (current.kind === "marker") {
      const first = current.points[0]!
      if (shift) {
        // Ось — по первому заметному движению; дальше только по ней.
        if (!g.axis && Math.hypot(p.x - first.x, p.y - first.y) > 3 * scale) {
          g.axis = Math.abs(p.x - first.x) >= Math.abs(p.y - first.y) ? "x" : "y"
        }
        if (g.axis === "x") p = { x: p.x, y: first.y }
        if (g.axis === "y") p = { x: first.x, y: p.y }
      } else {
        g.axis = null
      }
      replace({ ...current, points: [...current.points, p] })
    } else if (current.kind !== "text") {
      replace({ ...current, b: shift ? constrain(current.kind, current.a, p) : p })
    }
  }

  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current
    drag.current = null
    if (!g) return
    setCursor(hoverCursor(toImage(event)))
    if (g.mode === "crop-new" || g.mode === "crop-edge") {
      // Случайный щелчок вместо рамки — обрезки нет.
      setDoc((d) => (d.crop && (d.crop.w < 4 || d.crop.h < 4) ? { ...d, crop: g.mode === "crop-edge" ? g.snapshot : null } : d))
    }
    if (g.mode === "create") {
      // Щелчок без движения фигурой не считается.
      setDoc((d) => ({
        ...d,
        objs: d.objs.filter((o) => {
          if (o.id !== g.id || o.kind === "marker" || o.kind === "text") return true
          return Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y) > 3 * scale
        }),
      }))
    }
    endLive()
  }

  const dblClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const p = { x: ((event.clientX - box.left) / box.width) * W, y: ((event.clientY - box.top) / box.height) * H }
    const target = hit(p)
    if (target?.kind === "text") {
      setSelected(target.id)
      setEditing(target.id)
    }
  }

  const finishText = () => {
    const id = editing
    setEditing(null)
    if (!id) return
    setDoc((d) => ({ ...d, objs: d.objs.filter((o) => !(o.id === id && o.kind === "text" && !o.text.trim())) }))
  }

  // ─── Клавиши ─────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing) return
      // Клавиши в полях свойств (ползунки, цвет, шрифт) — им, а не холсту.
      const el = event.target as HTMLElement | null
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault()
        removeObj(selected)
      } else if (event.key === "Escape" && selected) {
        event.stopPropagation()
        setSelected(null)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  // ─── Поворот, отражение, сохранение ──────────────────────────────────

  /** Повернуть на 90° по часовой: пометки едут вместе с картинкой, обрезка сбрасывается. */
  const rotate = () =>
    commit((d) => ({
      ...d,
      objs: d.objs.map((o) => mapObj(o, (p) => ({ x: H - p.y, y: p.x }))),
      rotation: (d.rotation + 90) % 360,
      crop: null,
    }))

  const mirror = () =>
    commit((d) => ({
      ...d,
      objs: d.objs.map((o) => mapObj(o, (p) => ({ x: W - p.x, y: p.y }))),
      // Отражение после поворота на 90/270 — это отражение по другой оси исходника.
      rotation: turned ? (d.rotation + 180) % 360 : d.rotation,
      flip: !d.flip,
      crop: null,
    }))

  const save = async () => {
    if (!image) return
    setSelected(null)
    setEditing(null)
    const full = document.createElement("canvas")
    full.width = W
    full.height = H
    paint(full.getContext("2d")!, true)
    const area = doc.crop ?? { x: 0, y: 0, w: W, h: H }
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(area.w))
    out.height = Math.max(1, Math.round(area.h))
    const ctx = out.getContext("2d")!
    // У JPEG нет прозрачности: без подложки прозрачное стало бы чёрным.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, out.width, out.height)
    }
    ctx.drawImage(full, area.x, area.y, area.w, area.h, 0, 0, out.width, out.height)
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, mime, 0.92))
    if (!blob) return
    setSaving(true)
    try {
      await onSave(blob)
    } finally {
      setSaving(false)
    }
  }

  // ─── Свойства ────────────────────────────────────────────────────────

  const sel = doc.objs.find((o) => o.id === selected) ?? null
  const ctxKind: Obj["kind"] | "select" | "crop" = sel ? sel.kind : tool === "shape" ? shapeKind : tool
  const isText = ctxKind === "text"
  const curSize = sel ? sel.size : isText ? textStyle.size : ctxKind === "blur" ? 5 : style.size
  const curOpacity = sel ? sel.opacity : style.opacity
  const curColor = sel ? sel.color : style.color
  const curFont = sel?.kind === "text" ? sel.font : textStyle.font

  /** Свойство — выделенному объекту и в умолчания следующего. */
  const setProp = (patch: Partial<Style> & { font?: FontId }) => {
    if (sel) patchObj(sel.id, (o) => ({ ...o, ...patch }) as Obj)
    if (isText) {
      setTextStyle((s) => ({ size: patch.size ?? s.size, font: patch.font ?? s.font }))
      setStyle((s) => ({ ...s, color: patch.color ?? s.color, opacity: patch.opacity ?? s.opacity }))
    } else if (ctxKind !== "blur") {
      setStyle((s) => ({ ...s, ...(patch.color ? { color: patch.color } : {}), ...(patch.size ? { size: patch.size } : {}), ...(patch.opacity ? { opacity: patch.opacity } : {}) }))
    }
  }

  const setShape = (kind: ShapeKind) => {
    setShapeKind(kind)
    if (sel && (sel.kind === "rect" || sel.kind === "ellipse" || sel.kind === "line")) patchObj(sel.id, (o) => ({ ...o, kind }) as Obj)
  }

  const changed =
    doc.objs.length > 0 || doc.rotation !== 0 || doc.flip || doc.crop !== null ||
    adjust.brightness !== 100 || adjust.contrast !== 100 || adjust.saturation !== 100

  if (failed) return <p className="py-8 text-center text-[13px] text-ws-4">{t.productionPreviewUnsupported}</p>
  if (!image) {
    return (
      <div className="flex h-40 items-center justify-center text-ws-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 className="h-4 w-4" />, label: t.productionImageSelect },
    { id: "arrow", icon: <MoveUpRight className="h-4 w-4" />, label: t.productionImageArrow },
    { id: "text", icon: <Type className="h-4 w-4" />, label: t.productionImageText },
    { id: "shape", icon: <Shapes className="h-4 w-4" />, label: t.productionImageShapes },
    { id: "marker", icon: <Highlighter className="h-4 w-4" />, label: t.productionImageMarker },
    { id: "blur", icon: <Droplet className="h-4 w-4" />, label: t.productionImageBlur },
    { id: "crop", icon: <Crop className="h-4 w-4" />, label: t.productionImageCrop },
  ]

  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ws-2 hover:bg-ws-hover hover:text-ws-1 disabled:opacity-35"
    >
      {icon}
    </button>
  )

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, suffix = "") => (
    <label className="flex items-center gap-2 text-[12px] text-ws-3">
      <span className="shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-24 accent-[hsl(var(--success))]"
      />
      <span className="w-9 text-right tabular-nums">
        {Math.round(value * 10) / 10}
        {suffix}
      </span>
    </label>
  )

  const editingText = doc.objs.find((o): o is Text => o.id === editing && o.kind === "text")

  return (
    <div className="flex flex-col gap-2">
      {/* Инструменты — как в Яндекс Скриншотах; справа поворот, отражение, отмена. */}
      <div className="flex flex-wrap items-center gap-1 rounded-[10px] border border-foreground/10 bg-ws-control p-1">
        {tools.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-pressed={tool === item.id}
            onClick={() => {
              setTool(item.id)
              if (item.id === "crop") setSelected(null)
            }}
            className={cn(
              "flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-2 text-[11px]",
              tool === item.id ? "bg-ws-select/35 text-ws-1" : "text-ws-3 hover:bg-ws-hover hover:text-ws-1",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <span className="mx-1 h-8 w-px bg-foreground/10" />
        {iconButton(t.productionImageRotate, <RotateCw className="h-4 w-4" />, rotate)}
        {iconButton(t.productionImageFlip, <FlipHorizontal className="h-4 w-4" />, mirror)}
        <span className="ml-auto" />
        {iconButton(t.productionImageUndo, <Undo2 className="h-4 w-4" />, undo, past.length === 0)}
        {iconButton(t.productionImageRedo, <Redo2 className="h-4 w-4" />, redo, future.length === 0)}
      </div>

      {/* Свойства выбранного инструмента или выделенного объекта. */}
      <div className="flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-foreground/10 px-3 py-1.5">
        {ctxKind === "crop" ? (
          <>
            <span className="text-[12px] text-ws-4">{t.productionImageCropHint}</span>
            {doc.crop ? (
              <button type="button" onClick={() => commit((d) => ({ ...d, crop: null }))}
                className="h-7 rounded-[7px] border border-foreground/15 px-2.5 text-[12px] text-ws-2 hover:bg-ws-hover">
                {t.productionImageCropReset}
              </button>
            ) : null}
          </>
        ) : ctxKind === "select" ? (
          <span className="text-[12px] text-ws-4">{t.productionImageSelectHint}</span>
        ) : (
          <>
            {tool === "shape" || ctxKind === "rect" || ctxKind === "ellipse" || ctxKind === "line" ? (
              <div className="flex gap-1">
                {([["rect", <Square key="r" className="h-4 w-4" />], ["ellipse", <Circle key="e" className="h-4 w-4" />], ["line", <Minus key="l" className="h-4 w-4" />]] as const).map(([kind, icon]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setShape(kind)}
                    aria-pressed={(sel?.kind ?? shapeKind) === kind}
                    className={cn(
                      "flex h-7 w-8 items-center justify-center rounded-[7px] border",
                      (sel?.kind ?? shapeKind) === kind ? "border-ws-select bg-ws-select/35 text-ws-1" : "border-foreground/10 text-ws-3 hover:text-ws-1",
                    )}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            ) : null}
            {isText ? (
              <select
                value={curFont}
                onChange={(event) => setProp({ font: event.target.value as FontId })}
                className="h-7 rounded-[7px] border border-foreground/15 bg-ws-control px-2 text-[12px] text-ws-1 outline-none"
              >
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            ) : null}
            {slider(
              isText ? t.productionImageSize : ctxKind === "blur" ? t.productionImageStrength : t.productionImageThickness,
              curSize,
              1,
              isText ? 30 : 10,
              isText ? 0.5 : 0.5,
              (v) => setProp({ size: v }),
            )}
            {ctxKind !== "blur" ? (
              <>
                {slider(t.productionImageOpacity, curOpacity, 10, 100, 5, (v) => setProp({ opacity: v }), "%")}
                <div className="flex items-center gap-1">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={c}
                      onClick={() => setProp({ color: c })}
                      style={{ background: c }}
                      className={cn(
                        "h-6 w-6 rounded-full border",
                        curColor.toLowerCase() === c ? "border-ws-1 ring-2 ring-ws-select" : "border-foreground/20",
                      )}
                    />
                  ))}
                  <input
                    type="color"
                    value={curColor}
                    onChange={(event) => setProp({ color: event.target.value })}
                    title={t.productionImageColor}
                    aria-label={t.productionImageColor}
                    className="h-6 w-7 cursor-pointer rounded border border-foreground/20 bg-transparent p-0"
                  />
                </div>
              </>
            ) : null}
            {sel ? (
              <button type="button" onClick={() => removeObj(sel.id)} title={t.productionImageDelete} aria-label={t.productionImageDelete}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-[7px] border border-foreground/15 text-ws-3 hover:border-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="flex max-h-[58vh] items-center justify-center overflow-hidden rounded-lg bg-black">
        <div className="relative inline-block leading-[0]">
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={() => !drag.current && setCursor(null)}
            style={cursor ? { cursor } : undefined}
            onDoubleClick={dblClick}
            className={cn(
              "max-h-[58vh] max-w-full touch-none",
              tool === "select" ? "cursor-default" : tool === "text" ? "cursor-text" : "cursor-crosshair",
            )}
          />
          {editingText ? (
            <textarea
              autoFocus
              value={editingText.text}
              onChange={(event) => {
                const text = event.target.value
                setDoc((d) => ({ ...d, objs: d.objs.map((o) => (o.id === editingText.id ? { ...o, text } : o)) }))
              }}
              onBlur={finishText}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
                  event.preventDefault()
                  finishText()
                }
              }}
              rows={Math.max(1, editingText.text.split("\n").length)}
              style={{
                left: editingText.at.x / scale,
                top: editingText.at.y / scale,
                font: fontOf(editingText.font).css(textPx(editingText.size) / scale),
                lineHeight: 1.2,
                color: editingText.color,
                opacity: editingText.opacity / 100,
                width: `${Math.max(3, ...editingText.text.split("\n").map((l) => l.length + 2))}ch`,
              }}
              className="absolute z-10 m-0 resize-none overflow-hidden whitespace-pre border border-dashed border-info bg-transparent p-0 outline-none"
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3 sm:gap-4">
        {(["brightness", "contrast", "saturation"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2 text-[12px] text-ws-3">
            <span className="w-24 shrink-0">
              {key === "brightness" ? t.productionImageBrightness : key === "contrast" ? t.productionImageContrast : t.productionImageSaturation}
            </span>
            <input
              type="range"
              min={0}
              max={200}
              value={adjust[key]}
              onChange={(event) => setAdjust((prev) => ({ ...prev, [key]: Number(event.target.value) }))}
              className="min-w-0 flex-1 accent-[hsl(var(--success))]"
            />
            <span className="w-10 text-right tabular-nums">{adjust[key]}%</span>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="h-8 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover">
          {t.productionEditCancel}
        </button>
        <button type="button" disabled={!changed || saving} onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-[9px] bg-success px-3 text-[13px] font-medium text-background hover:bg-success/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t.productionEditSave}
        </button>
      </div>
    </div>
  )
}

/**
 * Shift: стрелка и линия — по 45°, прямоугольник, эллипс и размытие — квадрат и
 * круг. `origin` — неподвижная точка.
 */
export function constrain(kind: Obj["kind"], origin: P, p: P): P {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  if (kind === "arrow" || kind === "line") {
    const len = Math.hypot(dx, dy)
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len }
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: origin.x + Math.sign(dx || 1) * side, y: origin.y + Math.sign(dy || 1) * side }
}
