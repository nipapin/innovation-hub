"use client"

import { useEffect, useState } from "react"
import { Copy, Download, MessageSquarePlus, Pencil } from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { downloadHref, useDownloadChoice } from "@/components/text-viewer/download-choice"
import { TextFile } from "@/components/text-viewer/text-file"
import { confirmDiscardEdits } from "@/components/text-viewer/unsaved"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { textKind } from "@/lib/text-formats/kind"
import { isImage, isVideo, mediaUrl, uploadChatFile, type UploadedFile } from "./chat/upload"
import { ImageEditor, editableImageMime } from "./image-editor"
import { reviewable, useReview } from "./review/review-dialog"

export type PreviewFile = { id?: string; name: string; s3Key: string; contentType: string }

/** Правка поверх файла этапа: подпись на PUT в его ключ, байты, событие. */
export async function saveOver(stepId: string, fileId: string, blob: Blob): Promise<void> {
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

/**
 * Встроенный просмотр файла этапа: картинка, видео, звук, текст. Остальное —
 * скачать. С `edit` картинку (jpg/png/webp) и текст можно поправить в браузере и
 * сохранить поверх файла; видео и звук — через машину, docs/PRODUCTION_MEDIA_EDIT_PLAN.md.
 */
export function FilePreviewDialog({
  file,
  onClose,
  edit,
  copyEdit,
  saveAsNew,
  editOnOpen = false,
  actions,
}: {
  file: PreviewFile | null
  onClose: () => void
  /** Можно править: файл рабочей папки этапа и право загружать в него. */
  edit?: { stepId: string; onSaved: () => void } | null
  /**
   * Входной файл (только чтение): «Редактировать копию» — сервер копирует его
   * в рабочую папку этапа, `onCopied` открывает копию.
   */
  copyEdit?: { stepId: string; onCopied: (file: PreviewFile & { id: string; sizeBytes: number }) => void } | null
  /**
   * Вложение чата: правка сохраняется не поверх, а новым файлом в корне рабочей
   * папки («Из чата») под исходным свободным именем; в форму сама не встаёт.
   */
  saveAsNew?: { stepId: string; onSaved: (file: UploadedFile) => void } | null
  /** Открыть сразу в правке — копия, только что сделанная «Редактировать копию», или «Редактировать» из меню. */
  editOnOpen?: boolean
  /** Свои кнопки окна (например, «Принять этот вариант» в чате) — перед «Скачать». */
  actions?: React.ReactNode
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  /** Текст загружен и годится в правку — сообщает общий просмотрщик. */
  const [textReady, setTextReady] = useState(false)
  /** Сброс кэша после сохранения: адрес тот же, байты новые. */
  const [version, setVersion] = useState(0)
  const { download, dialog: downloadDialog } = useDownloadChoice()
  /** Ждём, пока текст загрузится, чтобы открыть его сразу в правке. */
  const [pendingEdit, setPendingEdit] = useState(false)
  const [copying, setCopying] = useState(false)
  /** Инструмент пометок этапа; вне этапа (обзор ролика) его нет. */
  const review = useReview()
  // По id и ключу, а не по объекту: перерисовка родителя (перечитали файлы
  // после копии) не должна сбрасывать или снова включать правку.
  useEffect(() => setEditing(false), [file?.id, file?.s3Key])
  useEffect(() => setPendingEdit(editOnOpen), [file?.id, editOnOpen])
  const url = file ? mediaUrl(file.s3Key) : ""
  // Вид текста решает общий `textKind` — тот же, что в проектах и чате.
  const textual = file ? textKind(file.name, file.contentType) : null

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
  const canEdit = Boolean((edit || saveAsNew) && file.id && (imageMime || (kind === "text" && textual !== "unsupported" && textReady)))
  if (pendingEdit && canEdit) {
    setPendingEdit(false)
    setEditing(true)
  }
  const canCopy = Boolean(copyEdit && file.id && kind === "text" && textual !== "unsupported")
  const copyForEdit = async () => {
    setCopying(true)
    try {
      const res = await fetch(`/api/production/steps/${encodeURIComponent(copyEdit!.stepId)}/files/copy-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      })
      const data = (await res.json().catch(() => null)) as { file?: PreviewFile & { id: string; sizeBytes: number } } | null
      if (!res.ok || !data?.file) throw new Error("copy")
      copyEdit!.onCopied(data.file)
    } catch {
      toast.error(t.productionEditCopyFailed)
    } finally {
      setCopying(false)
    }
  }
  const save = async (blob: Blob) => {
    try {
      if (saveAsNew) {
        // Имя считает сервер: приставка места снимается, занятое — «(2)».
        const fresh = await uploadChatFile(
          saveAsNew.stepId,
          new File([blob], file.name, { type: blob.type || file.contentType }),
          () => {},
          undefined,
          undefined,
          true,
        )
        toast.success(tf(t.productionEditSavedAsNew, { name: fresh.name }))
        setEditing(false)
        saveAsNew.onSaved(fresh)
        return true
      }
      await saveOver(edit!.stepId, file.id!, blob)
      toast.success(t.productionEditSaved)
      setVersion((v) => v + 1)
      setEditing(false)
      edit!.onSaved()
      return true
    } catch {
      toast.error(t.productionEditSaveFailed)
      return false
    }
  }
  const raw = `${url}?raw=1&v=${version}`
  const saveText = (value: string) =>
    save(new Blob([value], { type: "text/plain;charset=utf-8" }))

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && confirmDiscardEdits(t.textUnsavedDiscard)) onClose()
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
        <DialogDescription className="sr-only">{t.elementPreview}</DialogDescription>
        {editing && imageMime ? (
          <ImageEditor
            src={raw}
            mime={imageMime}
            onSave={async (blob) => {
              await save(blob)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : kind === "text" ? (
          // Показ и правка — общим просмотрщиком: txt с оформлением, json
          // деревом, прочее текстом. Сохранение — прежний `saveOver`.
          <TextFile
            url={raw}
            name={file.name}
            mimeType={file.contentType}
            className="h-[70vh] rounded-lg border border-foreground/10"
            editing={editing}
            onSave={saveText}
            onCancelEdit={() => setEditing(false)}
            onReady={setTextReady}
          />
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
        ) : (
          <p className="py-8 text-center text-[13px] text-ws-4">{t.productionPreviewUnsupported}</p>
        )}
        {editing ? null : (
        <div className="flex justify-end gap-2">
          {canCopy ? (
            <button
              type="button"
              disabled={copying}
              onClick={() => void copyForEdit()}
              title={t.productionEditCopyHint}
              className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              {t.productionEditCopy}
            </button>
          ) : null}
          {review && file.id && kind === "image" && reviewable(file) ? (
            <button
              type="button"
              onClick={() => {
                // Окно просмотра уступает место пометкам: два окна разом — лишнее.
                const target = { id: file.id!, name: file.name, s3Key: file.s3Key, contentType: file.contentType }
                onClose()
                review(target)
              }}
              className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {t.productionComment}
            </button>
          ) : null}
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
          <button
            type="button"
            onClick={() =>
              download({
                name: file.name,
                textUrl: raw,
                asIs: () => downloadHref(url, file.name),
              })
            }
            className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
          >
            <Download className="h-4 w-4" />
            {t.productionChatDownload}
          </button>
          {actions}
        </div>
        )}
        {downloadDialog}
      </DialogContent>
    </Dialog>
  )
}
