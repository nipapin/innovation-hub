"use client"

import { Loader2, Plus, Search } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { TRASH_RETENTION_DAYS } from "./format"
import { ProjectCard } from "./project-card"
import { sectionHeading, sectionEmptyText } from "./sections"
import { useWorkspace } from "./workspace-context"

/**
 * Колонка проектов полного режима.
 *
 * Раздел выбирается в боковом меню, поэтому внутри — плоский список
 * без групп и без раскрывающихся заголовков. Ширина тянется за правый край.
 */
export function ProjectsColumn() {
  const {
    t,
    source,
    visibleProjects,
    counts,
    projectTab,
    loadingProjects,
    query,
    setQuery,
    creating,
    createProject,
  } = useWorkspace()

  // «Корзина» — раздел кабинета; у источника без разделов его не существует.
  // Отличается только подвалом: заводить проект в корзине незачем, а срок
  // хранения человеку знать надо.
  const isTrash = source.splitByTab && projectTab === "trash"

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 300,
    min: 220,
    max: 520,
    axis: "x",
    storageKey: "ffworks-ws-projects-width",
  })

  return (
    <section
      style={{ width: size }}
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well"
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-ws-accent" />
            <span className="truncate text-[14px] font-semibold uppercase tracking-[1.6px] text-ws-accent">
              {sectionHeading(projectTab, t)}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-ws-4">
            {source.splitByTab ? counts[projectTab] : visibleProjects.length}
          </span>
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ws-4"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchProjects}
            className="h-[38px] w-full rounded-[9px] border border-white/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loadingProjects ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visibleProjects.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">
            {source.splitByTab
              ? sectionEmptyText(projectTab, t)
              : /* В админке проекты не создают — предлагать «создайте первый»
                   неуместно, тут это просто отсутствие проектов у пользователя. */
                t.userHasNoProjects}
          </p>
        ) : (
          <div className="pt-1">
            {visibleProjects.map((p) => (
              <ProjectCard key={p.id} project={p} groupName={p.groupName} />
            ))}
          </div>
        )}
      </div>

      {isTrash ? (
        <p className="shrink-0 border-t border-white/[0.07] px-4 py-3 text-[11.5px] leading-relaxed text-ws-5">
          {tf(t.trashRetention, { days: TRASH_RETENTION_DAYS })}
        </p>
      ) : source.can.createProject ? (
        <div className="shrink-0 border-t border-white/[0.07] p-3">
          <button
            type="button"
            onClick={createProject}
            disabled={creating}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-ws-action text-[14px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-60"
          >
            <Plus className="h-[18px] w-[18px]" />
            {creating ? t.creatingProject : t.newProject}
          </button>
        </div>
      ) : null}

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.projectsHeading}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}
