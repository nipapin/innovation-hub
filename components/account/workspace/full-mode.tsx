"use client"

import { useEffect, useMemo, useState } from "react"
import { FolderOpen, Loader2, Pause, Plus, RefreshCw, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { BottomPanel } from "./bottom-panel"
import { Breadcrumbs, FileBrowser } from "./file-browser"
import { TRASH_RETENTION_DAYS } from "./format"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import {
  buildTrashTree,
  flatTrashFiles,
  sortTrashFiles,
  sortTrashTree,
  trashSubtitle,
  type TrashItem,
} from "./trash-model"
import { TrialCta } from "./trial-cta"
import type { DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"
import { FlatSwitch, TrashSortSwitch, ViewSwitch } from "./workspace-topbar"

/** Список удалённых файлов одной группы — своя область со своим деревом. */
function TrashFiles({
  items,
  scoped,
}: {
  items: TrashItem[]
  /** Смотрим корзину одного проекта: тогда сохраняем структуру и ходим по ней. */
  scoped: boolean
}) {
  const { lang, view, trashSort } = useWorkspace()
  const [path, setPath] = useState<DriveFile[]>([])

  // Сменился проект — путь внутри прежнего смысла не имеет.
  useEffect(() => {
    setPath([])
  }, [items])

  const subtitleOf = useMemo(() => {
    const byId = new Map(items.map((i) => [i.fileId, trashSubtitle(i)]))
    return (file: DriveFile) => byId.get(file.id) ?? null
  }, [items])

  const root = useMemo(
    () =>
      scoped
        ? sortTrashTree(buildTrashTree(items), trashSort, lang)
        : sortTrashFiles(flatTrashFiles(items), trashSort, lang),
    [items, scoped, trashSort, lang],
  )

  return (
    <>
      {scoped ? (
        <div className="mt-2 flex-none">
          <Breadcrumbs rootLabel="/" path={path} onNavigate={setPath} />
        </div>
      ) : null}
      <div className="relative mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-foreground/[0.07] bg-ws-panel shadow-ws-panel">
        <FileBrowser
          root={root}
          path={scoped ? path : []}
          view={view}
          // Корень корзины плоский всегда: файлы в нём из разных проектов, и
          // общего дерева, по которому ходить, у них просто нет.
          flat={scoped ? undefined : true}
          subtitleOf={scoped ? undefined : subtitleOf}
          onNavigate={setPath}
        />
      </div>
    </>
  )
}

/**
 * Правая область корзины: удалённые файлы, а не только удалённые проекты.
 *
 * Корень показывает всё удалённое сразу, вперемешку по проектам — «я же их
 * удалил» относится и к файлам тоже, и искать их по проектам поодиночке значило
 * бы знать заранее, где искать. Выбор проекта слева сужает список до него
 * одного: уходим вглубь, а не наружу.
 */
function TrashPane() {
  const {
    t,
    lang,
    trashScoped,
    trashProjects,
    trashProjectId,
    loadingTrash,
    groupProjects,
    reloadTrash,
  } = useWorkspace()

  const scopedName =
    trashProjects.find((p) => p.id === trashProjectId)?.name ?? ""

  /** Разбивка корня по проектам — если её попросили и проектов больше одного. */
  const groups = useMemo(() => {
    if (trashProjectId || !groupProjects) return null
    const byId = new Map<string, TrashItem[]>()
    for (const item of trashScoped) {
      // Корень плоский — папки в нём не рисуются, и считать их в заголовке
      // группы нельзя: получалась группа «1» без единой строки под ней.
      if (item.isFolder) continue
      const list = byId.get(item.projectId)
      if (list) list.push(item)
      else byId.set(item.projectId, [item])
    }
    return [...byId.entries()]
      .map(([id, items]) => ({
        id,
        name: items[0]?.projectName ?? "",
        items,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, lang))
  }, [trashScoped, trashProjectId, groupProjects, lang])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[15px] pl-2.5 pr-3 pt-5 md:pr-5">
      <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Trash2 className="h-5 w-5 shrink-0 text-ws-3" />
          <h3 className="truncate text-[20px] font-bold text-ws-1">
            {trashProjectId
              ? tf(t.trashProjectFiles, { name: scopedName })
              : t.trashAllFiles}
          </h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <TrashSortSwitch />
          <ViewSwitch />
          <FlatSwitch />
          <button
            type="button"
            onClick={reloadTrash}
            className="flex items-center gap-1.5 text-[13px] text-ws-2 hover:text-ws-1"
          >
            <RefreshCw className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">{t.refresh}</span>
          </button>
        </div>
      </div>

      <p className="mt-1.5 flex-none text-[12px] text-ws-5">
        {tf(t.trashRetention, { days: TRASH_RETENTION_DAYS })}
      </p>

      {loadingTrash && trashScoped.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-ws-4">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : trashScoped.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-ws-5">
          {t.trashNoFiles}
        </div>
      ) : groups ? (
        <div className="scrollbar-elegant mt-2.5 min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id} className="mb-4 flex flex-col">
              <div className="flex items-baseline gap-2">
                <span className="h-0.5 w-4 shrink-0 rounded bg-ws-accent" />
                <span className="truncate text-[13px] font-semibold uppercase tracking-[1.4px] text-ws-accent">
                  {group.name}
                </span>
                <span className="text-[12px] text-ws-5">
                  {group.items.length}
                </span>
              </div>
              <TrashFiles items={group.items} scoped={false} />
            </div>
          ))}
        </div>
      ) : (
        <TrashFiles items={trashScoped} scoped={Boolean(trashProjectId)} />
      )}
    </div>
  )
}

function NoProjectSelected() {
  const { t, source, projectTab, createProject, creating } = useWorkspace()

  if (projectTab === "trash") return <TrashPane />

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/[0.04]">
        <FolderOpen className="h-7 w-7 text-ws-3" />
      </span>
      <div className="space-y-1.5">
        <p className="text-[20px] font-semibold text-ws-1">{t.pickProject}</p>
        <p className="max-w-[420px] text-[14px] text-ws-3">{t.pickProjectSub}</p>
      </div>
      {/* Пробный период — только там, где проекты свои: в админском источнике
          («Конвейер») это чужой кабинет, и личный подарок предлагать не из чего. */}
      {source.can.createProject ? (
        <>
          <button
            type="button"
            onClick={createProject}
            disabled={creating}
            className="flex h-10 items-center gap-2 rounded-[10px] bg-ws-action px-5 text-[14px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-60"
          >
            <Plus className="h-[18px] w-[18px]" />
            {creating ? t.creatingProject : t.newProject}
          </button>
          <TrialCta size="empty" />
        </>
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
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-foreground/[0.14] px-2.5 py-[3px] text-[12px] text-ws-3">
                <Pause className="h-3.5 w-3.5" />
                {t.paused}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ViewSwitch />
            <FlatSwitch />
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
        <div className="relative mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-foreground/[0.07] bg-ws-panel shadow-ws-panel">
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
