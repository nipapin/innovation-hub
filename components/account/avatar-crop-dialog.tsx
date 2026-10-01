"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

const SOURCE_TYPES = ["image/png", "image/jpeg", "image/webp"]
/** Исходник в хранилище не едет — режем в браузере, поэтому предел щедрый. */
const SOURCE_MAX_BYTES = 25 * 1024 * 1024
/** Сторона окна кадрирования, px. */
const VIEW = 280
/** Сторона итогового файла: с запасом под retina в самом крупном кружке. */
const OUTPUT = 512
const MAX_ZOOM = 4

type Loaded = { url: string; width: number; height: number }

/**
 * Миниредактор аватара: файл кнопкой или перетаскиванием прямо в окно, круглая
 * маска, сдвиг мышью/пальцем и масштаб. Наружу отдаётся только вырезанный
 * квадрат — исходник никуда не заливается.
 */
export function AvatarCropDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (blob: Blob) => Promise<boolean>
}) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [image, setImage] = useState<Loaded | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)

  // Масштаб, при котором картинка ровно закрывает окно короткой стороной.
  const baseScale = image ? VIEW / Math.min(image.width, image.height) : 1
  const scale = baseScale * zoom

  const clamp = useCallback(
    (x: number, y: number, s: number) => {
      if (!image) return { x, y }
      const w = image.width * s
      const h = image.height * s
      return {
        x: Math.min(0, Math.max(VIEW - w, x)),
        y: Math.min(0, Math.max(VIEW - h, y)),
      }
    },
    [image],
  )

  // Ссылку на прежний исходник освобождаем при замене и закрытии.
  useEffect(() => {
    if (!image) return
    return () => URL.revokeObjectURL(image.url)
  }, [image])

  useEffect(() => {
    if (!open) {
      setImage(null)
      setDragOver(false)
    }
  }, [open])

  const loadFile = (file: File) => {
    if (!SOURCE_TYPES.includes(file.type) || file.size > SOURCE_MAX_BYTES) {
      toast.error(t.avatarType)
      return
    }
    const url = URL.createObjectURL(file)
    const probe = new Image()
    probe.onload = () => {
      const s = VIEW / Math.min(probe.naturalWidth, probe.naturalHeight)
      setImage({ url, width: probe.naturalWidth, height: probe.naturalHeight })
      setZoom(1)
      // Сразу по центру.
      setPos({
        x: (VIEW - probe.naturalWidth * s) / 2,
        y: (VIEW - probe.naturalHeight * s) / 2,
      })
    }
    probe.onerror = () => {
      URL.revokeObjectURL(url)
      toast.error(t.avatarType)
    }
    probe.src = url
  }

  /** Масштаб держим относительно центра окна, чтобы лицо не уезжало. */
  const applyZoom = (next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    const nextScale = baseScale * z
    const cx = (VIEW / 2 - pos.x) / scale
    const cy = (VIEW / 2 - pos.y) / scale
    setZoom(z)
    setPos(clamp(VIEW / 2 - cx * nextScale, VIEW / 2 - cy * nextScale, nextScale))
  }

  const save = async () => {
    const img = imgRef.current
    if (!image || !img) return
    const canvas = document.createElement("canvas")
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT)
    // Safari не умеет WebP из canvas и молча отдаёт PNG — это тоже годится.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    )
    if (!blob) {
      toast.error(t.avatarFailed)
      return
    }
    setSaving(true)
    const ok = await onSave(blob)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(380px,94vw)] gap-4">
        <DialogTitle className="text-[16px] font-semibold">{t.avatarChange}</DialogTitle>

        <div
          className={cn(
            "relative mx-auto overflow-hidden rounded-2xl border border-dashed",
            dragOver ? "border-primary bg-primary/10" : "border-foreground/15 bg-foreground/[0.03]",
          )}
          style={{ width: VIEW, height: VIEW }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            event.dataTransfer.dropEffect = "copy"
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            const file = event.dataTransfer.files?.[0]
            if (file) loadFile(file)
          }}
        >
          {image ? (
            <div
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { id: event.pointerId, x: event.clientX - pos.x, y: event.clientY - pos.y }
              }}
              onPointerMove={(event) => {
                const d = drag.current
                if (!d || d.id !== event.pointerId) return
                setPos(clamp(event.clientX - d.x, event.clientY - d.y, scale))
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onWheel={(event) => applyZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- локальный blob: */}
              <img
                ref={imgRef}
                src={image.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                style={{
                  width: image.width * scale,
                  height: image.height * scale,
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                }}
              />
              {/* Затемнение вне круга — так фото будет выглядеть в аватарке. */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80"
                style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-muted-foreground hover:text-foreground"
            >
              <ImagePlus className="h-8 w-8" />
              {t.avatarDrop}
            </button>
          )}
        </div>

        {image ? (
          <div className="flex items-center gap-3 px-1">
            <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Slider
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={[zoom]}
              onValueChange={([v]) => applyZoom(v)}
              aria-label={t.avatarZoom}
            />
            <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept={SOURCE_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) loadFile(file)
          }}
        />

        <div className="flex items-center gap-2">
          {image ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => fileRef.current?.click()}
            >
              {t.avatarPickOther}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>
              {t.cancel}
            </Button>
            <Button size="sm" disabled={!image || saving} onClick={() => void save()} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t.saveChanges}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
