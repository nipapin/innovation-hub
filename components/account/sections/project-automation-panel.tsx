"use client"

import { ExposedOptionsList } from "@/components/account/options/exposed-options"
import type { ExposedOptionChange } from "@/lib/options/apply"
import type { ExposedOption } from "@/lib/options/types"

/**
 * Параметры обработки на странице проекта.
 *
 * Сам список и контролы живут в `components/account/options` — их же показывает
 * вкладка «Настройки» рабочей области, а это страница из дашборда, и настройки
 * должны быть одинаковыми в обоих местах. Здесь остаётся только транспорт.
 *
 * Тумблер слежения за проектом сюда не входит: он на карточке проекта, потому
 * что работает и без `folderState.json`, а этой панели показывать нечего, пока
 * автоматизация не настроена.
 */

export type ProjectDriveFileDto = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  /** Present (possibly empty) on folders once their contents are loaded. */
  children?: ProjectDriveFileDto[]
}

export type ProjectFolderStateDto = {
  schemaVersion: number
  enabled: boolean
  disabledReason: string | null
  disabledAt: string | null
  lastActivityAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type ProjectDriveDto = {
  files: ProjectDriveFileDto[]
  folderState: ProjectFolderStateDto | null
  options: ExposedOption[]
  /** Словарь расширений конвейера: им контрол выбора файла проверяет файл
   *  до заливки. */
  fileTypes: Record<string, string[]>
}

type Props = {
  projectId: string
  options: ExposedOption[]
  fileTypes: Record<string, string[]>
}

export function ProjectAutomationPanel({
  projectId,
  options,
  fileTypes,
}: Props) {
  const save = async (
    changes: ExposedOptionChange[],
  ): Promise<ExposedOption[]> => {
    const response = await fetch(`/api/projects/${projectId}/drive/options`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    })
    const data = (await response.json().catch(() => null)) as
      | { options?: ExposedOption[]; message?: string }
      | null
    // Пустое сообщение — сигнал панели показать свой перевод: текст сервера
    // технический и на язык интерфейса не переводится.
    if (!response.ok || !data?.options) throw new Error(data?.message ?? "")
    return data.options
  }

  return (
    <ExposedOptionsList
      projectId={projectId}
      options={options}
      fileTypes={fileTypes}
      onSave={save}
      className="rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40 px-5 py-4"
    />
  )
}
