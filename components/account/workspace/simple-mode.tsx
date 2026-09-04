"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Download,
  FolderOpen,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Users,
} from "lucide-react"

import { tf } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { BottomPanel } from "./bottom-panel"
import { Breadcrumbs, FileBrowser } from "./file-browser"
import { fmtDate, itemsAtPath } from "./format"
import { sectionEmptyText, sectionHeading } from "./sections"
import { ResizeGrip } from "@/components/account/resize-grip"
import type { DriveFile } from "./types"
import { useDragSize } from "@/components/account/use-drag-size"
import { useWorkspace } from "./workspace-context"
import { ViewSwitch } from "./workspace-topbar"

type PaneKind = "in" | "out" | "root"

/**
 * Панель упрощённого режима.
 * IN / OUT показываются, только если такие папки реально есть в проекте;
 * если их нет — вместо них одна панель с корнем проекта.
 */
function Pane({
  kind,
  title,
  subtitle,
  root,
  path,
  basePath,
  onNavigate,
  folders,
}: {
  kind: PaneKind
  title: string
  subtitle: string
  root: DriveFile[]
  path: DriveFile[]
  /** Префикс логического пути; для корня — пусто. */
  basePath?: string
  onNavigate: (nodes: DriveFile[]) => void
  /**
   * Папки, между которыми панель переключается. Правая панель показывает не
   * только OUT: у проекта могут быть и другие папки в корне — та же `Errors
   * (дата)`, куда падение уносит исходник, — и в упрощённом режиме их иначе не
   * увидеть вовсе. Отдельной панели они не заслуживают, поэтому делят место с
   * OUT, а OUT остаётся основной и открытой по умолчанию.
   */
  folders?: {
    items: DriveFile[]
    activeId: string
    onSelect: (folder: DriveFile) => void
  }
}) {
  const { t, view } = useWorkspace()
  const Icon = kind === "in" ? Download : kind === "out" ? Upload : FolderOpen
  const items = itemsAtPath(root, path)

  /**
   * Выбор папки стоит на месте заголовка — сами имена и есть кнопки.
   *
   * Ни отдельной строкой под шапкой, ни выпадающим списком: строка занимала
   * высоту всегда и отодвигала содержимое вниз, а список прятал за клик выбор из
   * двух-трёх вариантов, которые целиком помещаются на виду. Имя показанной
   * папки при этом никуда не делось — оно просто нажатое.
   */
  const switchable = !!folders && folders.items.length > 1

  const accent =
    kind === "in"
      ? "border-ws-accent/35"
      : kind === "out"
        ? "border-ws-out/30"
        : "border-white/10"
  const iconColor =
    kind === "in"
      ? "text-ws-accent"
      : kind === "out"
        ? "text-ws-out"
        : "text-ws-3"

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border bg-ws-panel shadow-ws-panel",
        accent,
      )}
    >
      <div className="flex flex-none items-center gap-3 border-b border-white/[0.07] px-4 py-3.5">
        <span
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border bg-white/[0.04]",
            accent,
          )}
        >
          <Icon className={cn("h-[19px] w-[19px]", iconColor)} />
        </span>
        <div className="min-w-0 flex-1">
          {switchable ? (
            <div
              aria-label={t.paneFolderPick}
              className="-mx-1.5 flex items-center gap-0.5 overflow-x-auto px-1.5"
            >
              {folders.items.map((folder) => {
                const active = folder.id === folders.activeId
                return (
                  <button
                    key={folder.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => folders.onSelect(folder)}
                    className={cn(
                      "shrink-0 rounded-[8px] px-2 py-0.5 text-[15px] tracking-[0.4px] transition-colors",
                      active
                        ? "bg-white/[0.09] font-semibold text-ws-1"
                        : "font-medium text-ws-4 hover:bg-white/[0.05] hover:text-ws-2",
                    )}
                  >
                    {folder.name}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="truncate text-[15px] font-semibold tracking-[0.4px] text-ws-1">
              {title}
            </p>
          )}
          <p className="truncate text-[12px] text-ws-3">{subtitle}</p>
        </div>
        <span className="shrink-0 text-[11.5px] text-ws-4">
          {items.length} {t.itemsShort}
        </span>
      </div>

      {path.length > 0 ? (
        <div className="flex-none border-b border-white/[0.05] px-3.5 py-2">
          <Breadcrumbs rootLabel={title} path={path} onNavigate={onNavigate} />
        </div>
      ) : null}

      <FileBrowser
        root={root}
        path={path}
        basePath={basePath}
        view={view}
        size="snug"
        onNavigate={onNavigate}
      />
    </section>
  )
}

/**
 * Упрощённый режим для выбранного проекта.
 *
 * Две панели: слева IN, справа OUT. Правая при этом показывает не только OUT —
 * все прочие папки корня делят её место и выбираются переключателем в шапке.
 * Иначе они в этом режиме были бы невидимы вовсе: раньше панель знала ровно две
 * папки, и всё, что лежит в корне рядом с ними, существовало только в полном
 * режиме. Отдельной панели такая папка не заслуживает, а невидимой быть не
 * должна — та же `Errors (дата)`, куда падение обработки уносит исходник.
 *
 * Ни IN, ни других папок в корне нет — показываем одну панель с корнем проекта.
 */
export function SimpleProject() {
  const {
    t,
    selected,
    inFolder,
    outFolder,
    rootFiles,
    path,
    goToPath,
    refreshDrive,
    revealPath,
  } = useWorkspace()
  const [inPath, setInPath] = useState<DriveFile[]>([])
  /** Какую папку показывает правая панель и где мы внутри неё. */
  const [rightId, setRightId] = useState<string | null>(null)
  const [rightPath, setRightPath] = useState<DriveFile[]>([])

  /**
   * Что может показать правая панель: OUT и остальные папки корня.
   *
   * Раньше она знала только OUT, и всё, что лежит в корне рядом с ним, в
   * упрощённом режиме было невидимо — включая `Errors (дата)`, куда падение
   * уносит исходник. Заводить каждой папке свою панель незачем: OUT остаётся
   * основной, прочие делят с ней место и открываются переключателем.
   */
  const rightFolders = useMemo(() => {
    const others = rootFiles.filter(
      (f) =>
        f.isFolder && f.id !== inFolder?.id && f.id !== outFolder?.id,
    )
    return outFolder ? [outFolder, ...others] : others
  }, [rootFiles, inFolder, outFolder])

  const rightFolder =
    rightFolders.find((f) => f.id === rightId) ?? rightFolders[0] ?? null

  const showRight = (folder: DriveFile) => {
    setRightId(folder.id)
    // Путь внутренний, к прежней папке отношения не имеет.
    setRightPath([])
  }

  /**
   * Переход «открыть файл» снаружи: контекст сообщает цепочку папок от корня, а
   * уложить её должна панель — у IN и правой здесь свои локальные пути, и общий
   * `path` из контекста в этом режиме не рисуется вовсе. Без этого переход в
   * `OUT/готовое/2026-09` открывал бы просто корень OUT.
   *
   * Первый узел цепочки — сама панель, остальное её внутренний путь.
   */
  const revealDone = useRef<DriveFile[] | null>(null)
  useEffect(() => {
    if (!revealPath || revealPath.length === 0) return
    // Ровно один раз на просьбу. Список папок пересобирается на каждое чтение
    // дерева — раз в несколько секунд, — и без отметки очередное чтение
    // возвращало бы человека в присланную папку из той, куда он с тех пор ушёл.
    if (revealDone.current === revealPath) return
    revealDone.current = revealPath

    const [head, ...rest] = revealPath
    if (inFolder && head.id === inFolder.id) {
      setInPath(rest)
      return
    }
    if (rightFolders.some((f) => f.id === head.id)) {
      setRightId(head.id)
      setRightPath(rest)
    }
  }, [revealPath, inFolder, rightFolders])

  const splitPanes = !!inFolder || !!rightFolder

  const split = useDragSize({
    initial: 520,
    min: 300,
    max: 1100,
    axis: "x",
    storageKey: "ffworks-ws-in-width",
  })

  const bottom = useDragSize({
    initial: 340,
    min: 150,
    max: 700,
    axis: "y",
    invert: true,
    storageKey: "ffworks-ws-bottom-height",
  })

  if (!selected) return null

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-5 md:px-6">
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[22px] font-bold text-ws-1">
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

        {splitPanes ? (
          <div
            className={cn(
              "mt-3.5 grid min-h-0 flex-1 grid-cols-1 gap-3.5",
              inFolder && rightFolder
                ? "grid-rows-2 lg:grid-cols-[var(--in-width)_1fr] lg:grid-rows-1"
                : "grid-rows-1",
            )}
            style={{ "--in-width": `${split.size}px` } as React.CSSProperties}
          >
            {inFolder ? (
              <Pane
                kind="in"
                title="IN"
                subtitle={t.paneInSub}
                root={inFolder.children ?? []}
                path={inPath}
                basePath="IN"
                onNavigate={setInPath}
              />
            ) : null}
            {rightFolder ? (
              <div className="relative flex min-h-0 min-w-0 flex-col">
                {inFolder ? (
                  <ResizeGrip
                    orientation="vertical"
                    side="left"
                    label="IN / OUT"
                    dragging={split.dragging}
                    onPointerDown={split.onPointerDown}
                    onKeyDown={split.onKeyDown}
                    className="-left-3 max-lg:hidden"
                  />
                ) : null}
                <Pane
                  kind={rightFolder.id === outFolder?.id ? "out" : "root"}
                  title={rightFolder.name}
                  subtitle={
                    rightFolder.id === outFolder?.id
                      ? t.paneOutSub
                      : t.paneFolderSub
                  }
                  root={rightFolder.children ?? []}
                  path={rightPath}
                  basePath={rightFolder.name}
                  onNavigate={setRightPath}
                  folders={{
                    items: rightFolders,
                    activeId: rightFolder.id,
                    onSelect: showRight,
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3.5 flex min-h-0 flex-1 flex-col">
            <Pane
              kind="root"
              title={selected.name}
              subtitle={t.projectRoot}
              root={rootFiles}
              path={path}
              onNavigate={goToPath}
            />
          </div>
        )}
      </div>

      <div style={{ height: bottom.size }} className="mb-4 shrink-0 px-3 md:px-6">
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

/**
 * Витрина проектов: упрощённый режим без выбранного проекта и мобильная версия.
 * Раздел приходит из бокового меню через `?tab=…`.
 */
export function AllProjectsPage() {
  const {
    t,
    lang,
    visibleProjects,
    projectTab,
    query,
    setQuery,
    creating,
    createProject,
    selectProject,
    openChat,
    openMenu,
  } = useWorkspace()

  const isProjects = projectTab === "projects"
  const isTrash = projectTab === "trash"

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-none border-b border-white/[0.07] px-6 pb-6 pt-8 md:px-12 md:pt-11">
        <div className="mx-auto max-w-[1120px]">
          <div className="flex items-center gap-3">
            <span className="h-0.5 w-[34px] rounded bg-ws-accent" />
            <span className="text-[13px] font-semibold uppercase tracking-[2.4px] text-ws-accent">
              {sectionHeading(projectTab, t)}
            </span>
          </div>
          <h1 className="mt-5 text-[32px] font-bold tracking-tight text-ws-1 md:text-[46px]">
            {isProjects ? t.yourProjects : sectionHeading(projectTab, t)}
          </h1>
          {isProjects ? (
            <p className="mt-3.5 max-w-[680px] text-[15px] text-ws-3 md:text-[16px]">
              {t.yourProjectsSub}
            </p>
          ) : null}
          <div className={cn("mt-7 flex flex-wrap items-center gap-3.5", isTrash && "hidden")}>
            <div className="relative min-w-[240px] max-w-[600px] flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-ws-4"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchProjects}
                className="h-[52px] w-full rounded-xl border border-white/10 bg-ws-control pl-11 pr-4 text-[15px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
              />
            </div>
            {isProjects ? (
              <button
                type="button"
                onClick={createProject}
                disabled={creating}
                className="flex h-[52px] items-center gap-2 rounded-xl bg-ws-action px-[22px] text-[15px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-60"
              >
                <Plus className="h-5 w-5" />
                {creating ? t.creatingProject : t.newProject}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 py-7 md:px-12">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
          {isTrash ? (
            <p className="mx-auto max-w-[560px] py-16 text-center text-[14px] leading-relaxed text-ws-4">
              {t.trashNotWired}
            </p>
          ) : visibleProjects.length === 0 ? (
            <p className="py-16 text-center text-[14px] text-ws-4">
              {sectionEmptyText(projectTab, t)}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
              {visibleProjects.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectProject(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      selectProject(p.id)
                    }
                  }}
                  onContextMenu={(e) => openMenu("project", e, { project: p })}
                  className={cn(
                    "flex cursor-pointer flex-col gap-4 rounded-2xl border border-white/10 bg-ws-panel p-[22px] text-left hover:border-white/[0.18] hover:bg-ws-hover",
                    // Проекты на паузе не должны спорить за внимание с активными.
                    p.isPaused && "opacity-[0.45] hover:opacity-100",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={cn(
                        "flex h-[46px] w-[46px] items-center justify-center rounded-full border",
                        p.isPaused
                          ? "border-white/10 bg-white/[0.04]"
                          : "border-ws-out/30 bg-ws-out/[0.08]",
                      )}
                    >
                      <FolderOpen
                        className={cn(
                          "h-[22px] w-[22px]",
                          p.isPaused ? "text-ws-4" : "text-ws-out",
                        )}
                      />
                    </span>
                    {p.memberCount > 0 ? (
                      <span
                        title={tf(t.projectSharedWith, { users: p.memberCount })}
                        className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[12.5px] tabular-nums text-ws-4"
                      >
                        <Users className="h-[15px] w-[15px]" />
                        {p.memberCount}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <p
                      className={cn(
                        "text-[20px] font-semibold tracking-tight",
                        p.isPaused ? "text-ws-2" : "text-ws-1",
                      )}
                    >
                      {p.name}
                    </p>
                    <p className="mt-2.5 text-[13px] text-ws-4">
                      {fmtDate(p.createdAt, lang)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-[5px] text-[13px]",
                        p.isPaused
                          ? "border-white/[0.10] text-ws-4"
                          : "border-ws-out/40 bg-ws-out/10 text-ws-out",
                      )}
                    >
                      {p.isPaused ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {p.isPaused ? t.statusPaused : t.statusActive}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openChat(p.id)
                      }}
                      className="flex items-center gap-2 rounded-[9px] border border-white/10 px-3.5 py-2 text-[13px] text-ws-2 hover:bg-white/5"
                    >
                      <MessageCircle className="h-[17px] w-[17px]" />
                      {t.chat}
                      {p.unreadCount > 0 ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-ws-select" />
                      ) : null}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
