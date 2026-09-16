"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronRight, FolderOpen, Loader2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import type { Project } from "@/components/account/workspace/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { projectRules, taskItems } from "./shared/project-rules"
import { useTools, type ToolInstance } from "./tools-context"

/** Запись дерева хранилища — нужно то, что лежит прямо в `sourceRoot`. */
type TreeEntry = {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
  updatedAt: string | null
}

/**
 * Какие проекты показываем в выпадающем списке.
 *
 * Пауза и архив отсекаются всегда: работать с ними нечего. Остальное — решение
 * пользователя, оно живёт в настройках экземпляра (`settings.hiddenProjectIds`),
 * а не в общих настройках аккаунта: у второго инструмента список может быть свой.
 */
export function pickableProjects(projects: Project[], tool: ToolInstance): Project[] {
  const hidden = new Set(
    Array.isArray(tool.settings?.hiddenProjectIds)
      ? (tool.settings.hiddenProjectIds as string[])
      : [],
  )
  return projects.filter(
    (p) => !p.isPaused && !p.isArchived && !p.deletedAt && !hidden.has(p.id),
  )
}

export function toolSourceRoot(tool: ToolInstance): string {
  const root = tool.settings?.sourceRoot
  return typeof root === "string" && root.trim() ? root.trim() : "OUT"
}

/** Подменю одного проекта: папки задач внутри `sourceRoot`. */
function ProjectSubmenu({
  project,
  tool,
  onPick,
}: {
  project: Project
  tool: ToolInstance
  onPick: (project: Project, folderName: string) => void
}) {
  const { t } = useWorkspace()
  const root = toolSourceRoot(tool)
  const rule = projectRules(tool).for(project.id)
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [folders, setFolders] = useState<string[]>([])
  // Ключ загрузки, а не флаг: правило чтения папки меняется в настройках, и
  // подменю должно перечитать корень, а не показать прежний список.
  const loadedRef = useRef("")

  const load = useCallback(async () => {
    const key = `${root}|${rule.rule}`
    if (loadedRef.current === key) return
    loadedRef.current = key
    setState("loading")
    try {
      const res = await fetch(
        `/api/storage/v1/tree?projectId=${encodeURIComponent(project.id)}&prefix=${encodeURIComponent(root)}`,
      )
      if (!res.ok) {
        setState("error")
        return
      }
      const data = await res.json()
      const entries = (data.entries ?? []) as TreeEntry[]
      // Что считать задачей — решает правило проекта: раскладку `OUT` задаёт
      // граф обработки, и она у каждого своя (§8 плана).
      setFolders(
        taskItems(
          entries.map((e) => ({
            name: e.name,
            folderPath: e.folderPath,
            isFolder: e.isFolder,
            modifiedAt: e.updatedAt,
          })),
          root,
          rule,
        ),
      )
      setState("ready")
    } catch {
      setState("error")
    }
  }, [project.id, root, rule.rule])

  return (
    <DropdownMenuSub onOpenChange={(open) => open && void load()}>
      <DropdownMenuSubTrigger className="cursor-pointer gap-2 focus:bg-foreground/10">
        <FolderOpen className="h-[15px] w-[15px] shrink-0 text-ws-4" />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.sharedWithMe ? (
          <span className="shrink-0 text-[11px] text-ws-5">{t.groupShared}</span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="max-h-[60vh] min-w-[240px] overflow-y-auto">
          {state === "loading" ? (
            <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-ws-4">
              <Loader2 className="h-[15px] w-[15px] animate-spin" />
              {t.loading}
            </div>
          ) : state === "error" ? (
            <div className="px-2 py-2 text-[13px] text-ws-4">{t.driveUnavailable}</div>
          ) : folders.length === 0 ? (
            <div className="px-2 py-2 text-[13px] text-ws-4">
              {tf(t.toolNoTasks, { root })}
            </div>
          ) : (
            folders.map((name) => (
              <DropdownMenuItem
                key={name}
                onClick={() => onPick(project, name)}
                className="cursor-pointer gap-2 focus:bg-foreground/10"
              >
                <span className="truncate">{name}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

/**
 * Выбор источника: проект → папка задачи. Два уровня, второй раскрывается
 * справа от первого (§6 плана).
 */
export function SourcePicker({ tool }: { tool: ToolInstance }) {
  const { t, projects } = useWorkspace()
  const { patchSource } = useTools()
  const root = toolSourceRoot(tool)
  const list = pickableProjects(projects, tool)
  const hiddenCount = projects.length - list.length

  const [open, setOpen] = useState(false)

  const pick = useCallback(
    (project: Project, folderName: string) => {
      setOpen(false)
      void patchSource(tool.id, {
        projectId: project.id,
        folderPath: `${root}/${folderName}`,
        label: `${project.name} / ${root} / ${folderName}`,
      })
    },
    [patchSource, root, tool.id],
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-[38px] min-w-0 max-w-[420px] items-center gap-2 rounded-[10px] border border-foreground/10 bg-ws-control px-3 text-[13.5px] text-ws-2 hover:border-foreground/20 hover:text-ws-1",
          )}
        >
          <FolderOpen className="h-[16px] w-[16px] shrink-0 text-ws-4" />
          <span className="min-w-0 flex-1 truncate text-left">
            {tool.source?.label ?? t.toolPickSource}
          </span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0 rotate-90 text-ws-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuLabel className="text-[11.5px] uppercase tracking-[1.4px] text-ws-5">
          {t.breadcrumbProjects}
        </DropdownMenuLabel>
        {list.length === 0 ? (
          <div className="px-2 py-2 text-[13px] text-ws-4">{t.toolNoProjects}</div>
        ) : (
          list.map((p) => (
            <ProjectSubmenu key={p.id} project={p} tool={tool} onPick={pick} />
          ))
        )}
        {hiddenCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11.5px] text-ws-5">
              {tf(t.toolProjectsHidden, { count: hiddenCount })}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
