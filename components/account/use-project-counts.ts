"use client"

import { useCallback, useEffect, useState } from "react"

import { TOOLS_CHANGED_EVENT } from "@/components/account/tools/tools-context"
import { PROJECTS_CHANGED_EVENT } from "@/components/account/workspace/workspace-context"
import type { ProjectTab } from "@/components/account/workspace/workspace-context"

type Counts = Record<ProjectTab, number>

const EMPTY: Counts = { projects: 0, tools: 0, archive: 0, trash: 0 }

/**
 * Числа для разделов бокового меню.
 *
 * Меню живёт в шелле — выше страницы проектов, поэтому её контекст ему недоступен
 * и список приходится запрашивать своим запросом. Чтобы числа не отставали после
 * создания или архивации, страница шлёт событие `PROJECTS_CHANGED_EVENT`.
 */
export function useProjectCounts() {
  const [counts, setCounts] = useState<Counts>(EMPTY)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects?archived=all")
      if (!res.ok) return
      const data = await res.json()
      const acc: Counts = { ...EMPTY }
      for (const raw of data.projects ?? []) {
        const p = raw as {
          isArchived?: boolean
          groupName?: string
          sharedWithMe?: boolean
          deletedAt?: string | null
        }
        if (p.deletedAt) acc.trash += 1
        // Расшаренные — группа внутри «Проектов», своего раздела у них нет.
        else if (p.sharedWithMe) acc.projects += 1
        else if (p.isArchived) acc.archive += 1
        else acc.projects += 1
      }
      // Инструменты — не проекты: у них свой список (user_tools), поэтому
      // считаем отдельным запросом. Прежнее значение group_name='tools'
      // осталось в базе, но в меню больше не участвует.
      try {
        const toolsRes = await fetch("/api/account/tools")
        if (toolsRes.ok) {
          const toolsData = await toolsRes.json()
          acc.tools = (toolsData.tools ?? []).length
        }
      } catch {
        // счётчик не критичен
      }
      setCounts(acc)
    } catch {
      // счётчики не критичны — молча оставляем прежние
    }
  }, [])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(PROJECTS_CHANGED_EVENT, onChange)
    window.addEventListener(TOOLS_CHANGED_EVENT, onChange)
    return () => {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, onChange)
      window.removeEventListener(TOOLS_CHANGED_EVENT, onChange)
    }
  }, [load])

  return counts
}
