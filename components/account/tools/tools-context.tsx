"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTool } from "@/lib/tools/registry"

/** Экземпляр инструмента у пользователя — то, что лежит в `user_tools`. */
export type ToolInstance = {
  id: string
  toolKey: string
  title: string
  settings: Record<string, unknown>
  source: {
    projectId?: string | null
    folderPath?: string | null
    label?: string | null
  }
  lastOpenedAt: string | null
  createdAt: string
}

type ToolsValue = {
  tools: ToolInstance[]
  loading: boolean
  /** Открытый инструмент (из `?tool=` в адресе). */
  selected: ToolInstance | null
  /** Каталог: открыт ли, и какой инструмент в нём раскрыт. */
  catalogOpen: boolean
  openCatalog: () => void
  closeCatalog: () => void
  addingKey: string | null
  addTool: (toolKey: string) => Promise<void>
  removeTool: (id: string) => Promise<void>
  renameTool: (id: string, title: string) => Promise<void>
  openTool: (id: string) => void
  closeTool: () => void
  patchSource: (id: string, source: ToolInstance["source"]) => Promise<void>
  /** Слияние настроек экземпляра: присланные ключи поверх сохранённых. */
  patchSettings: (id: string, settings: Record<string, unknown>) => Promise<void>
  /** Уже добавленный экземпляр этого инструмента, если есть. */
  instanceOf: (toolKey: string) => ToolInstance | null
  /**
   * Каталог этой установки: ключи инструментов, которые здесь включены
   * (lib/features.ts). `null` — список ещё не пришёл.
   *
   * Приходит с сервера, а не берётся из `TOOLS`: реестр в коде отвечает на
   * вопрос «что вообще бывает», а состав установки — вопрос её настроек.
   */
  catalog: string[] | null
}

const ToolsContext = createContext<ToolsValue | null>(null)

export function useTools(): ToolsValue {
  const ctx = useContext(ToolsContext)
  if (!ctx) throw new Error("useTools must be used within ToolsProvider")
  return ctx
}

/** Событие для счётчика в боковом меню: список инструментов изменился. */
export const TOOLS_CHANGED_EVENT = "ffworks:tools-changed"

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useWorkspace()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tools, setTools] = useState<ToolInstance[]>([])
  const [catalog, setCatalog] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [addingKey, setAddingKey] = useState<string | null>(null)

  const tRef = useRef(t)
  tRef.current = t

  const selectedId = searchParams.get("tool")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/tools")
      if (!res.ok) return
      const data = await res.json()
      setTools((data.tools ?? []) as ToolInstance[])
      setCatalog((data.catalog ?? []) as string[])
    } catch {
      // Список не критичен для остальной страницы: молча оставляем прежний.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const announce = useCallback(() => {
    window.dispatchEvent(new Event(TOOLS_CHANGED_EVENT))
  }, [])

  /**
   * Адрес страницы. Инструмент живёт в отдельном параметре `?tool=`, а не в `?id=`:
   * тот занят выбранным проектом, и рабочая область попыталась бы его открыть.
   */
  const urlWithTool = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", "tools")
      if (id) params.set("tool", id)
      else params.delete("tool")
      return `/account/projects?${params.toString()}`
    },
    [searchParams],
  )

  const openTool = useCallback(
    (id: string) => {
      setCatalogOpen(false)
      router.replace(urlWithTool(id), { scroll: false })
      // Отметка открытия — для сортировки по свежести; ответ не ждём.
      void fetch(`/api/account/tools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ touch: true }),
      })
    },
    [router, urlWithTool],
  )

  const closeTool = useCallback(() => {
    router.replace(urlWithTool(null), { scroll: false })
  }, [router, urlWithTool])

  const addTool = useCallback(
    async (toolKey: string) => {
      if (findTool(toolKey)?.status !== "ready") return
      setAddingKey(toolKey)
      try {
        const res = await fetch("/api/account/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolKey }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? tRef.current.toolAddFailed)
          return
        }
        const tool = data.tool as ToolInstance
        setTools((prev) => [...prev, tool])
        announce()
        // Не открываем сразу: человек добавил инструмент себе, и дальше сам
        // решает — открыть его или продолжить смотреть каталог. В окне у этого
        // инструмента вместо «Добавить» появляются «Открыть» и «Удалить».
        toast.success(tRef.current.toolAdded)
      } catch {
        toast.error(tRef.current.toolAddFailed)
      } finally {
        setAddingKey(null)
      }
    },
    [announce],
  )

  const removeTool = useCallback(
    async (id: string) => {
      const tool = tools.find((x) => x.id === id)
      if (!tool) return
      const name = tool.title || tRef.current.toolsTab
      if (!window.confirm(tf(tRef.current.toolRemoveConfirm, { name }))) return
      try {
        const res = await fetch(`/api/account/tools/${id}`, { method: "DELETE" })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.message ?? tRef.current.toolRemoveFailed)
          return
        }
        setTools((prev) => prev.filter((x) => x.id !== id))
        announce()
        if (selectedId === id) closeTool()
      } catch {
        toast.error(tRef.current.toolRemoveFailed)
      }
    },
    [announce, closeTool, selectedId, tools],
  )

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/account/tools/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.message ?? "Failed")
      return null
    }
    const tool = data.tool as ToolInstance
    setTools((prev) => prev.map((x) => (x.id === tool.id ? tool : x)))
    return tool
  }, [])

  const renameTool = useCallback(
    async (id: string, title: string) => {
      await patch(id, { title })
    },
    [patch],
  )

  const patchSource = useCallback(
    async (id: string, source: ToolInstance["source"]) => {
      await patch(id, { source })
    },
    [patch],
  )

  const patchSettings = useCallback(
    async (id: string, settings: Record<string, unknown>) => {
      await patch(id, { settings })
    },
    [patch],
  )

  const instanceOf = useCallback(
    (toolKey: string) => tools.find((x) => x.toolKey === toolKey) ?? null,
    [tools],
  )

  const selected = useMemo(
    () => tools.find((x) => x.id === selectedId) ?? null,
    [tools, selectedId],
  )

  const value = useMemo<ToolsValue>(
    () => ({
      tools,
      catalog,
      loading,
      selected,
      catalogOpen,
      openCatalog: () => setCatalogOpen(true),
      closeCatalog: () => setCatalogOpen(false),
      addingKey,
      addTool,
      removeTool,
      renameTool,
      openTool,
      closeTool,
      patchSource,
      patchSettings,
      instanceOf,
    }),
    [
      addTool,
      addingKey,
      catalog,
      catalogOpen,
      closeTool,
      instanceOf,
      loading,
      openTool,
      patchSettings,
      patchSource,
      removeTool,
      renameTool,
      selected,
      tools,
    ],
  )

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
}
