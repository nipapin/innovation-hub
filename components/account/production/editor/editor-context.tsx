"use client"

import { createContext, useContext } from "react"
import type { PipelineNode } from "@/lib/production/graph"
import type { PersonOption } from "@/lib/production/people-types"

/**
 * Что редактор даёт нодам: правку своих данных и людей для выбора.
 * Контекст, а не пропсы через `data`: xyflow пересоздаёт объекты нод на
 * каждом шаге перетаскивания, и функции в `data` рвали бы мемоизацию.
 */
export type EditorApi = {
  readOnly: boolean
  /** Черновик: только в нём папкой этапа можно указать `$pipelineName`. */
  isDraft: boolean
  people: PersonOption[]
  /** Свои папки владельца пайплайна — для выбора папки этапа. */
  projects: { id: string; name: string }[]
  /** Типы файлов из словаря установки — для строк формы. */
  fileTypes: string[]
  /** Правка данных ноды — функцией от прежних, чтобы не потерять параллельную. */
  updateNode: (id: string, fn: (node: PipelineNode) => PipelineNode) => void
  removeNode: (id: string) => void
  /** Ноды с ошибками проверки — для красной рамки. */
  nodeHasError: (id: string) => boolean
}

const EditorContext = createContext<EditorApi | null>(null)

export const EditorProvider = EditorContext.Provider

export function useEditor(): EditorApi {
  const api = useContext(EditorContext)
  if (!api) throw new Error("useEditor outside the pipeline editor")
  return api
}
