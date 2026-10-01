"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { isImage, isVideo, mediaUrl } from "./chat/upload"
import { ImageEditor, TextEditor, editableImageMime } from "./image-editor"

export type PreviewFile = { id?: string; name: string; s3Key: string; contentType: string }

/** Правка поверх файла этапа: подпись на PUT в его ключ, байты, событие. */
async function saveOver(stepId: string, fileId: string, blob: Blob): Promise<void> {
  const base = `/api/production/steps/${encodeURIComponent(stepId)}/files/${encodeURIComponent(fileId)}/replace`
  const presignRes = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "presign", sizeBytes: blob.size }),
  })
  const presign = (await presignRes.json().catch(() => null)) as { url?: string; contentType?: string } | null
  if (!presignRes.ok || !presign?.url) throw new Error("presign")
  const put = await fetch(presign.url, {
    method: "PUT",
    headers: { "Content-Type": presign.contentType ?? blob.type },
    body: blob,
  })
  if (!put.ok) throw new Error("put")
  const done = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "complete" }),
  })
  if (!done.ok) throw new Error("complete")
}

function isAudio(contentType: string, name: string): boolean {
  return contentType.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)
}

function isText(contentType: string, name: string): boolean {
  return contentType.startsWith("text/") || /\.(txt|srt|vtt|lrc|json|csv|tsv|md)$/i.test(name)
}

/** Текст больше этого не тянем целиком — его открывают скачиванием. */
const TEXT_LIMIT = 512 * 1024

/**
 * Встроенный просмотр файла этапа: картинка, видео, звук, текст. Остальное —
 * скачать. С `edit` картинку (jpg/png/webp) и текст можно поправить в браузере и
 * сохранить поверх файла; видео и звук — через машину, docs/PRODUCTION_MEDIA_EDIT_PLAN.md.
 */
export function FilePreviewDialog({
  file,
  onClose,
  edit,
}: {
  file: PreviewFile | null
  onClose: () => void
  /** Можно править: файл рабочей папки этапа и право загружать в него. */
  edit?: { stepId: string; onSaved: () => void } | null
}) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  /** Сброс кэша картинки после сохранения: адрес тот же, байты новые. */
  const [version, setVersion] = useState(0)
  useEffect(() => setEditing(false), [file])
  const url = file ? mediaUrl(file.s3Key) : ""
  const textual = file ? isText(file.contentType, file.name) : false

  useEffect(() => {
    setText(null)
    if (!file || !textual) return
    const controller = new AbortController()
    void fetch(`${url}?raw=1&v=${version}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const size = Number(res.headers.get("content-length") ?? 0)
        setText(!res.ok ? "" : size > TEXT_LIMIT ? t.productionPreviewTooBig : await res.text())
      })
      .catch(() => {})
    return () => controller.abort()
  }, [file, textual, url, t, version])

  if (!file) return null
  const kind = isVideo(file.contentType, file.name)
    ? "video"
    : isImage(file.contentType, file.name)
      ? "image"
      : isAudio(file.contentType, file.name)
        ? "audio"
        : textual
          ? "text"
          : null

  const imageMime = kind === "image" ? editableImageMime(file.name) : null
  const canEdit = Boolean(edit && file.id && (imageMime || (kind === "text" && text !== null && text !== t.productionPreviewTooBig)))
  const save = async (blob: Blob) => {
    try {
      await saveOver(edit!.stepId, file.id!, blob)
      toast.success(t.productionEditSaved)
      setVersion((v) => v + 1)
      setEditing(false)
      edit!.onSaved()
    } catch {
      toast.error(t.productionEditSaveFailed)
    }
  }
  const raw = `${url}?raw=1&v=${version}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
        <DialogDescription className="sr-only">{t.elementPreview}</DialogDescription>
        {editing && imageMime ? (
          <ImageEditor src={raw} mime={imageMime} onSave={save} onCancel={() => setEditing(false)} />
        ) : editing && kind === "text" && text !== null ? (
          <TextEditor initial={text} onSave={save} onCancel={() => setEditing(false)} />
        ) : kind === "video" ? (
          <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-lg bg-black">
            <video src={url} controls autoPlay className="max-h-[75vh] max-w-full" />
          </div>
        ) : kind === "image" ? (
          <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={raw} alt={file.name} className="max-h-[75vh] max-w-full object-contain" />
          </div>
        ) : kind === "audio" ? (
          <audio src={url} controls autoPlay className="w-full" />
        ) : kind === "text" ? (
          text === null ? (
            <div className="flex h-40 items-center justify-center text-ws-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <pre className="scrollbar-elegant max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-foreground/10 bg-ws-control p-3 text-[13px] text-ws-1">
              {text}
            </pre>
          )
        ) : (
          <p className="py-8 text-center text-[13px] text-ws-4">{t.productionPreviewUnsupported}</p>
        )}
        {editing ? null : (
        <div className="flex justify-end gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
            >
              <Pencil className="h-4 w-4" />
              {t.productionEdit}
            </button>
          ) : null}
          <a
            href={url}
            download={file.name}
            className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
          >
            <Download className="h-4 w-4" />
            {t.productionChatDownload}
          </a>
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
