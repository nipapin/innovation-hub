"use client"

import { FolderOpen, Pause, Plus, RefreshCw, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { BottomPanel } from "./bottom-panel"
import { Breadcrumbs, FileBrowser } from "./file-browser"
import { TRASH_RETENTION_DAYS } from "./format"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { useWorkspace } from "./workspace-context"
import { ViewSwitch } from "./workspace-topbar"

function NoProjectSelected() {
  const { t, source, projectTab, createProject, creating } = useWorkspace()

  /**
   * В корзине выбирать нечего: удалённый проект не открывается, а предложение
   * завести новый в этом разделе выглядело бы ответом не на тот вопрос.
   */
  if (projectTab === "trash") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Trash2 className="h-7 w-7 text-ws-3" />
        </span>
        <div className="space-y-1.5">
          <p className="text-[20px] font-semibold text-ws-1">{t.trashTab}</p>
          <p className="max-w-[420px] text-[14px] text-ws-3">
            {tf(t.trashRetention, { days: TRASH_RETENTION_DAYS })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <FolderOpen className="h-7 w-7 text-ws-3" />
      </span>
      <div className="space-y-1.5">
        <p className="text-[20px] font-semibold text-ws-1">{t.pickProject}</p>
        <p className="max-w-[420px] text-[14px] text-ws-3">{t.pickProjectSub}</p>
      </div>
      {source.can.createProject ? (
        <button
          type="button"
          onClick={createProject}
          disabled={creating}
          className="flex h-10 items-center gap-2 rounded-[10px] bg-ws-action px-5 text-[14px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-60"
        >
          <Plus className="h-[18px] w-[18px]" />
          {creating ? t.creatingProject : t.newProject}
        </button>
      ) : null}
    </div>
  )
}

/** Полный режим: рабочая область проекта + нижняя панель. */
export function FullMode() {
  const { t, selected, view, path, rootFiles, goToPath, refreshDrive } =
    useWorkspace()

  const bottom = useDragSize({
    initial: 340,
    min: 150,
    max: 700,
    axis: "y",
    invert: true,
    storageKey: "ffworks-ws-bottom-height",
  })

  if (!selected) return <NoProjectSelected />

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[15px] pl-2.5 pr-3 pt-5 md:pr-5">
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[20px] font-bold text-ws-1">
              {selected.name}
            </h3>
            {selected.isPaused ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.14] px-2.5 py-[3px] text-[12px] text-ws-3">
                <Pause className="h-3.5 w-3.5" />
                {t.paused}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ViewSwitch />
            <button
              type="button"
              onClick={refreshDrive}
              className="flex items-center gap-1.5 text-[13px] text-ws-2 hover:text-ws-1"
            >
              <RefreshCw className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">{t.refresh}</span>
            </button>
          </div>
        </div>

        <div className="mt-2 flex-none">
          <Breadcrumbs
            rootLabel={t.projectRoot}
            path={path}
            onNavigate={goToPath}
          />
        </div>

        {/* Превью выбранного файла живёт в закладке нижней панели и в окне
            быстрого просмотра (пробел), поэтому вся ширина здесь — файлам. */}
        <div className="relative mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-ws-panel shadow-ws-panel">
          <FileBrowser
            root={rootFiles}
            path={path}
            view={view}
            onNavigate={goToPath}
          />
        </div>
      </div>

      <div
        style={{ height: bottom.size }}
        className="mb-4 ml-2.5 mr-3 shrink-0 md:mr-5"
      >
        <BottomPanel
          onResize={
            <ResizeGrip
              orientation="horizontal"
              side="top"
              label={t.tabDesc}
              dragging={bottom.dragging}
              onPointerDown={bottom.onPointerDown}
              onKeyDown={bottom.onKeyDown}
            />
          }
        />
      </div>
    </>
  )
}
