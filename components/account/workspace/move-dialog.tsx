"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { itemsAtPath } from "./format"
import type { DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"

/**
 * Выбор папки назначения: слева проекты пользователя, справа их папки.
 *
 * Внутри проекта перенос — `/api/storage/v1/rename`, между проектами —
 * `/api/storage/v1/move`: копия туда и оригинал в корзину одной работой
 * (lib/storage/move.ts). Во втором случае нужна запись и в проекте-получателе.
 */
export function MoveDialog() {
  const {
    t,
    projects,
    selectedId,
    rootFiles,
    moveTargets,
    closeMoveDialog,
    moveItems,
    source,
    capabilitiesFor,
  } = useWorkspace()

  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null)
  const [tree, setTree] = useState<DriveFile[]>([])
  const [loadingTree, setLoadingTree] = useState(false)
  const [path, setPath] = useState<DriveFile[]>([])
  const [busy, setBusy] = useState(false)

  const open = moveTargets !== null

  // Открываем на текущем проекте и его корне.
  useEffect(() => {
    if (!open) return
    setPickedProjectId(selectedId)
    setTree(rootFiles)
    setPath([])
  }, [open, selectedId, rootFiles])

  // Дерево чужого проекта подгружаем отдельно.
  useEffect(() => {
    if (!open || !pickedProjectId || pickedProjectId === selectedId) return
    let cancelled = false
    setLoadingTree(true)
    setPath([])
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${pickedProjectId}/drive`)
        const data = res.ok ? await res.json() : null
        if (!cancelled) setTree(data?.available ? (data.files ?? []) : [])
      } finally {
        if (!cancelled) setLoadingTree(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pickedProjectId, selectedId])

  const folders = useMemo(
    () => itemsAtPath(tree, path).filter((f) => f.isFolder),
    [tree, path],
  )

  const destFolderPath = path.map((n) => n.name).join("/")
  const sameProject = pickedProjectId === selectedId
  const movedIds = new Set((moveTargets ?? []).map((f) => f.id))

  // Папку нельзя положить внутрь себя же или своего потомка.
  const intoItself = path.some((n) => movedIds.has(n.id))

  const pickedProject = projects.find((p) => p.id === pickedProjectId) ?? null

  const blockedReason = sameProject
    ? intoItself
      ? t.moveIntoItself
      : null
    : !source.crossProjectMoveUrl
      ? t.moveCrossProject
      : !capabilitiesFor(pickedProject).move
        ? t.moveNoWriteAccess
        : null

  const submit = async () => {
    if (!moveTargets || blockedReason) return
    setBusy(true)
    try {
      await moveItems(moveTargets, destFolderPath, {
        to: pickedProjectId ?? undefined,
      })
      closeMoveDialog()
    } finally {
      setBusy(false)
    }
  }

  const count = moveTargets?.length ?? 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeMoveDialog()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-2xl border-border/60 bg-ws-raised p-0"
      >
        <DialogHeader className="border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold text-ws-1">
            {t.moveTitle}
            {count > 1 ? ` (${count})` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[340px] min-h-0">
          <div className="scrollbar-elegant w-[200px] shrink-0 overflow-y-auto border-r border-foreground/[0.07] p-2">
            {projects
              .filter((p) => !p.isArchived)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPickedProjectId(p.id)}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]",
                    p.id === pickedProjectId
                      ? "bg-ws-select/[0.18] text-ws-1"
                      : "text-ws-2 hover:bg-foreground/5",
                  )}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-ws-4" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
              ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-none flex-wrap items-center gap-1 border-b border-foreground/[0.07] px-3 py-2">
              <button
                type="button"
                onClick={() => setPath([])}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[12px] hover:bg-foreground/5",
                  path.length === 0 ? "text-ws-2" : "text-ws-4",
                )}
              >
                {t.projectRoot}
              </button>
              {path.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  <span className="text-[12px] text-ws-5">/</span>
                  <button
                    type="button"
                    onClick={() => setPath(path.slice(0, i + 1))}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[12px] hover:bg-foreground/5",
                      i === path.length - 1 ? "text-ws-2" : "text-ws-4",
                    )}
                  >
                    {node.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto p-2">
              {loadingTree ? (
                <div className="flex justify-center py-12 text-ws-4">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : folders.length === 0 ? (
                <p className="px-3 py-10 text-center text-[12.5px] text-ws-5">
                  {t.moveNoFolders}
                </p>
              ) : (
                folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={movedIds.has(f.id)}
                    onClick={() => setPath([...path, f])}
                    className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ws-2 hover:bg-foreground/5 disabled:opacity-40"
                  >
                    <Folder className="h-[18px] w-[18px] shrink-0 text-ws-2" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ws-4" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t border-foreground/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 flex-1 truncate text-[12.5px] text-ws-4">
            {blockedReason ?? `${t.moveDestination}: ${destFolderPath || "/"}`}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="ghost"
              className="text-ws-2"
              onClick={closeMoveDialog}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!!blockedReason || busy}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.moveTitle}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
