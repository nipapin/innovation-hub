"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Loader2, Pencil, X } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { cn } from "@/lib/utils"
import { SourcePicker } from "./source-picker"
import { SrtEditor } from "./srt/srt-editor"
import { VoiceEditor } from "./voice/voice-editor"
import { useToolTitle } from "./tools-list"
import { useTools, type ToolInstance } from "./tools-context"

type TreeEntry = {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
  sizeBytes: number | null
}

/** Разобранная папка задачи: документ и то, что вокруг него. */
type TaskState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready"
      doc: {
        tracks: { id: string; no: number; name: string; audio: string | null }[]
        cues: { id: string; trackId: string; startMs: number; endMs: number }[]
        media: { video: string | null; peaks: string | null; durationMs: number }
        languages: { original: string; targets: string[] }
      }
      files: string[]
    }

/**
 * Загрузка папки задачи: читаем дерево, находим `dialog.json`, разбираем его.
 *
 * Пока это проверка сквозного пути «папка проекта → документ в интерфейсе».
 * Сам редактор (таймлиния, список реплик, превью) встаёт сюда следующим шагом,
 * поведение описано в docs/TOOLS_SRT_EDITOR_PLAN.md §13–§18.
 */
function useTask(tool: ToolInstance) {
  const [state, setState] = useState<TaskState>({ kind: "idle" })
  const { t } = useWorkspace()
  const tRef = useRef(t)
  tRef.current = t

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null

  const load = useCallback(async () => {
    if (!projectId || !folderPath) {
      setState({ kind: "idle" })
      return
    }
    setState({ kind: "loading" })
    try {
      const res = await fetch(
        `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}&prefix=${encodeURIComponent(folderPath)}`,
      )
      if (!res.ok) {
        setState({ kind: "error", message: tRef.current.driveUnavailable })
        return
      }
      const data = await res.json()
      const entries = (data.entries ?? []) as TreeEntry[]
      const docEntry = entries.find(
        (e) => !e.isFolder && e.name === "dialog.json" && e.folderPath === folderPath,
      )
      if (!docEntry) {
        setState({ kind: "error", message: "dialog.json" })
        return
      }
      const fileRes = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/drive/files/${encodeURIComponent(docEntry.id)}`,
      )
      if (!fileRes.ok) {
        setState({ kind: "error", message: tRef.current.driveUnavailable })
        return
      }
      const doc = await fileRes.json()
      setState({
        kind: "ready",
        doc,
        files: entries.filter((e) => !e.isFolder).map((e) => `${e.folderPath}/${e.name}`),
      })
    } catch {
      setState({ kind: "error", message: tRef.current.driveUnavailable })
    }
  }, [folderPath, projectId])

  useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load }
}

/** Сводка документа — временная заглушка на месте редактора. */
function TaskSummary({ tool }: { tool: ToolInstance }) {
  const { t } = useWorkspace()
  const { state } = useTask(tool)

  if (state.kind === "idle") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="max-w-[420px] text-center text-[14px] leading-relaxed text-ws-4">
          {t.toolNoSource} — {t.toolPickSource.toLowerCase()}
        </p>
      </div>
    )
  }
  if (state.kind === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ws-4" />
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="flex max-w-[460px] items-start gap-2.5 text-center text-[13.5px] leading-relaxed text-ws-3">
          <AlertTriangle className="mt-[2px] h-[17px] w-[17px] shrink-0 text-ws-out" />
          <span>{state.message}</span>
        </p>
      </div>
    )
  }

  const { doc } = state
  const tracks = doc.tracks ?? []
  const cues = doc.cues ?? []
  const seconds = Math.round((doc.media?.durationMs ?? 0) / 1000)

  return (
    <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[900px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "tracks", value: tracks.length },
            { label: "cues", value: cues.length },
            { label: "sec", value: seconds },
            { label: "lang", value: doc.languages?.targets?.length ?? 0 },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[12px] border border-foreground/[0.08] bg-ws-panel px-4 py-3"
            >
              <p className="text-[22px] font-semibold tabular-nums text-ws-1">{s.value}</p>
              <p className="mt-0.5 text-[11.5px] uppercase tracking-[1.2px] text-ws-5">
                {s.label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-[12px] border border-foreground/[0.08]">
          {tracks.map((track) => {
            const own = cues.filter((c) => c.trackId === track.id)
            return (
              <div
                key={track.id}
                className="flex items-center gap-3 border-b border-foreground/[0.06] px-4 py-2.5 last:border-b-0"
              >
                <span className="w-7 shrink-0 text-[12.5px] tabular-nums text-ws-5">
                  {String(track.no).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ws-1">
                  {track.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-[2px] text-[11.5px]",
                    track.audio
                      ? "border-ws-out/40 bg-ws-out/10 text-ws-out"
                      : "border-foreground/[0.10] text-ws-5",
                  )}
                >
                  {track.audio ? "audio" : "srt"}
                </span>
                <span className="w-14 shrink-0 text-right text-[12.5px] tabular-nums text-ws-3">
                  {own.length}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-ws-5">
          {state.files.length} files · {doc.media?.video ?? "no video"} ·{" "}
          {doc.media?.peaks ?? "no peaks"}
        </p>
      </div>
    </div>
  )
}

/**
 * Область открытого инструмента.
 *
 * У инструмента с собственным рабочим местом (редактор титров) вся область, с
 * топбаром включительно, — его: топбар несёт счётчики, переключатель языка и
 * экспорт, которые знает только он. Остальным достаётся общая шапка с
 * источником и сводка документа.
 */
export function ToolHost({ tool }: { tool: ToolInstance }) {
  const { t } = useWorkspace()
  const { closeTool, renameTool } = useTools()
  const title = useToolTitle()

  const rename = useCallback(() => {
    const next = window.prompt(t.toolNamePrompt, title(tool))
    if (next === null) return
    void renameTool(tool.id, next.trim())
  }, [renameTool, t.toolNamePrompt, title, tool])

  if (tool.toolKey === "srt-editor") return <SrtEditor tool={tool} />
  if (tool.toolKey === "voice-over") return <VoiceEditor tool={tool} />

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Имя инструмента и путь живут в топбаре раздела; здесь — источник. */}
      <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-foreground/[0.07] px-4 py-2.5 md:px-6">
        <SourcePicker tool={tool} />
        <button
          type="button"
          title={t.toolRename}
          onClick={rename}
          className="rounded-md p-1.5 text-ws-5 hover:text-ws-2"
        >
          <Pencil className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          title={t.toolClose}
          onClick={closeTool}
          className="ml-auto rounded-md p-1.5 text-ws-4 hover:text-ws-1"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </header>

      <TaskSummary tool={tool} />
    </section>
  )
}
