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
  pipelineId: string
  readOnly: boolean
  /** Черновик: только в нём папкой этапа можно указать `$pipelineName`. */
  isDraft: boolean
  people: PersonOption[]
  /** Свои папки владельца пайплайна — для выбора папки этапа. */
  projects: { id: string; name: string }[]
  /** Типы файлов из словаря установки — для строк формы. */
  fileTypes: string[]
  /** Инструменты, доступные этому человеку, — для выбора в ноде «Инструмент». */
  toolKeys: string[]
  /** Назвать этап, а занятое имя дополнить числом: «Форма 1», «Форма 2»… */
  nameStage: (id: string, name: string) => void
  /**
   * Названия строк, которые уже есть в пайплайне: строки форм и имена, которые
   * ждёт обработка в автоматике (форма программы в её проекте). Подсказки к
   * названию строки формы — с нодами, где имя встречается.
   */
  rowNames: { label: string; nodeId: string; nodeName: string }[]
  /** Правка данных ноды — функцией от прежних, чтобы не потерять параллельную. */
  updateNode: (id: string, fn: (node: PipelineNode) => PipelineNode) => void
  removeNode: (id: string) => void
  /** Ноды с ошибками проверки — для красной рамки. */
  nodeHasError: (id: string) => boolean
  /** Есть ли у ноды исходящие связи: последнему этапу автоприёмка запрещена. */
  hasNext: (id: string) => boolean
}

const EditorContext = createContext<EditorApi | null>(null)

export const EditorProvider = EditorContext.Provider

export function useEditor(): EditorApi {
  const api = useContext(EditorContext)
  if (!api) throw new Error("useEditor outside the pipeline editor")
  return api
}
