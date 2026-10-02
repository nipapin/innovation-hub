"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { TextFile } from "@/components/text-viewer/text-file"
import { isTextual, previewKind } from "./preview-kind"
import type { DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"

/** Правка текста в превью — что нужно кнопке и самому просмотрщику. */
export type TextEdit = {
  /** Кнопку «Редактировать» показывать: право записи и текст прочитался. */
  canEdit: boolean
  editing: boolean
  start: () => void
  cancel: () => void
  save: (text: string) => Promise<boolean>
  setReady: (ready: boolean) => void
  /** Номер сохранения — в адрес, чтобы просмотрщик перечитал новые байты. */
  version: number
}

/**
 * Номер сохранения по id файла — общий для всех просмотрщиков страницы.
 * Вкладка превью и окно держат каждый свой `useTextEdit`; счётчик в модуле
 * нужен, чтобы сохранение в одном перечитывало и другой. `modifiedAt` из
 * списка тут не помогает: это время заливки, перезапись его не меняет.
 */
const savedVersions = new Map<string, number>()
const versionListeners = new Set<() => void>()

function bumpVersion(fileId: string) {
  savedVersions.set(fileId, (savedVersions.get(fileId) ?? 0) + 1)
  for (const listener of versionListeners) listener()
}

function subscribeVersions(listener: () => void) {
  versionListeners.add(listener)
  return () => {
    versionListeners.delete(listener)
  }
}

/**
 * Правка файла проекта поверх него — шаг 4 docs/TEXT_FORMATS_PLAN.md.
 *
 * Право — то же, что у заливки в папку (`can.upload`: роль и источник), плюс
 * у источника должен быть адрес записи. xlsx сюда не попадает: его вид
 * `unsupported`, а не текстовый. Сервер проверяет право сам (`editor`).
 */
export function useTextEdit(file: DriveFile | null): TextEdit {
  const { t, can, source, selectedId, refreshDrive } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [ready, setReady] = useState(false)
  const fileId = file?.id ?? null
  const version = useSyncExternalStore(
    subscribeVersions,
    () => (fileId ? savedVersions.get(fileId) ?? 0 : 0),
    () => 0,
  )

  // Другой файл — правка обрывается, отметка готовности сбрасывается.
  useEffect(() => {
    setEditing(false)
    setReady(false)
  }, [fileId])

  const writable = Boolean(
    file &&
      !file.isFolder &&
      selectedId &&
      source.fileContentUrl &&
      can.upload &&
      isTextual(previewKind(file)),
  )

  const save = useCallback(
    async (text: string) => {
      if (!fileId || !selectedId || !source.fileContentUrl) return false
      try {
        await saveOver(
          source.fileContentUrl(selectedId, fileId),
          new Blob([text], { type: "text/plain;charset=utf-8" }),
        )
        toast.success(t.productionEditSaved)
        bumpVersion(fileId)
        setEditing(false)
        await refreshDrive()
        return true
      } catch {
        toast.error(t.productionEditSaveFailed)
        return false
      }
    },
    [fileId, selectedId, source, t, refreshDrive],
  )

  return {
    canEdit: writable && ready && !editing,
    editing: writable && editing,
    start: () => setEditing(true),
    cancel: () => setEditing(false),
    save,
    setReady,
    version,
  }
}

/** presign → PUT в ключ файла → complete; та же пара, что у этапа конвейера. */
async function saveOver(base: string, blob: Blob): Promise<void> {
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

/**
 * Превью текстового файла проекта — общий просмотрщик `TextFile`.
 *
 * Адрес — роут файла **без** `inline=1`: с ним роут отвечает редиректом на
 * хранилище, а это чужой источник, и CORS закрыл бы чтение тела. Без него тело
 * идёт через Next, то есть тот же origin. `v` — сброс кэша: адрес тот же, байты
 * новые; номер общий для файла, так что перечитывают все его просмотрщики.
 */
export function TextPreview({
  file,
  url,
  className,
  edit,
}: {
  file: DriveFile
  url: string
  className?: string
  edit?: TextEdit
}) {
  return (
    <TextFile
      url={edit?.version ? `${url}?v=${edit.version}` : url}
      name={file.name}
      mimeType={file.mimeType}
      sizeBytes={file.sizeBytes}
      className={className}
      editing={edit?.editing ?? false}
      onSave={edit?.save}
      onCancelEdit={edit?.cancel}
      onReady={edit?.setReady}
    />
  )
}
