"use client"

import { Files, Loader2, Plus, Search, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { cn } from "@/lib/utils"
import { fmtDateTime, TRASH_RETENTION_DAYS } from "./format"
import { ProjectCard } from "./project-card"
import { ProjectGroups } from "./project-groups"
import { sectionHeading, sectionEmptyText } from "./sections"
import { useWorkspace } from "./workspace-context"

/**
 * Строка «вся корзина» — начало списка и путь назад из любого проекта.
 *
 * Показывается только когда в корзине есть файлы: когда их нет, предлагать
 * «посмотреть все удалённые файлы» не на что.
 */
function TrashAllFilesRow() {
  const { t, trashProjects, trashProjectId, selectedId, selectTrashProject } =
    useWorkspace()

  if (trashProjects.length === 0) return null

  const active = !selectedId && trashProjectId === null

  return (
    <button
      type="button"
      onClick={() => selectTrashProject(null)}
      className={cn(
        "mb-[7px] flex w-full items-center gap-2.5 rounded-lg border px-[7px] py-2.5 text-left",
        active
          ? "border-ws-select/55 bg-ws-select/[0.16] text-ws-1"
          : "border-transparent text-ws-3 hover:border-foreground/15",
      )}
    >
      <Files className="h-5 w-5 shrink-0 text-ws-4" />
      <span className="min-w-0 flex-1 truncate text-[15px]">
        {t.trashAllFiles}
      </span>
    </button>
  )
}

/**
 * Живой проект, из которого удаляли файлы, — такая же строка корзины.
 *
 * Отдельной группы под такие проекты нет намеренно: удалённое из проекта — это
 * тот же проект, просто в корзине лежит не он целиком, а часть его файлов, и со
 * своими путями. Поэтому строка отличается не местом в списке, а пометкой:
 * значок файлов вместо корзины и число вместо «Восстановить» — восстанавливать
 * целиком нечего, сам проект никуда не делся.
 */
function TrashFilesCard({
  row,
}: {
  row: { id: string; name: string; count: number; lastDeletedAt: string }
}) {
  const {
    t,
    lang,
    selectedId,
    trashProjectId,
    trashHighlightId,
    selectTrashProject,
  } = useWorkspace()

  const active = !selectedId && trashProjectId === row.id
  // Выбранный в общем списке файл подсвечивает свой проект: «откуда это» —
  // первый вопрос к строке, лежащей вперемешку с чужими.
  const hinted = !active && trashHighlightId === row.id

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => selectTrashProject(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          selectTrashProject(row.id)
        }
      }}
      className={cn(
        "relative mb-[7px] cursor-pointer rounded-lg border px-[5px] py-2.5",
        active
          ? "border-ws-select/55 bg-gradient-to-b from-ws-select/[0.22] to-ws-select/[0.06] shadow-ws-inset"
          : hinted
            ? "border-ws-accent/45 bg-ws-accent/[0.08]"
            : "border-foreground/10 hover:border-foreground/20",
      )}
    >
      {active ? (
        <span className="absolute bottom-[9px] left-0 top-[7px] w-[3px] rounded-[3px] bg-ws-select" />
      ) : null}

      <div className="flex items-center gap-2.5 leading-tight">
        <Files className="h-5 w-5 shrink-0 text-ws-4" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[16px]",
            active ? "text-ws-1" : "text-ws-3",
          )}
        >
          {row.name}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-ws-5">
          {tf(t.trashDeletedOn, { date: fmtDateTime(row.lastDeletedAt, lang) })}
        </span>
        <span className="shrink-0 rounded-full border border-foreground/[0.12] px-2.5 py-[3px] text-[11px] tabular-nums text-ws-4">
          {tf(t.trashFilesCount, { count: row.count })}
        </span>
      </div>
    </div>
  )
}

/**
 * Колонка проектов полного режима.
 *
 * Раздел выбирается в боковом меню. Список внутри плоский, кроме «Проектов»
 * при наличии расшаренных: там свои и чужие идут двумя сворачиваемыми
 * группами. Ширина тянется за правый край.
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
    trashProjects,
    emptyTrash,
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
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-foreground/[0.08] bg-ws-well"
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
            className="h-[38px] w-full rounded-[9px] border border-foreground/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loadingProjects ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visibleProjects.length === 0 && !(isTrash && trashProjects.length) ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">
            {source.splitByTab
              ? sectionEmptyText(projectTab, t)
              : /* В админке проекты не создают — предлагать «создайте первый»
                   неуместно, тут это просто отсутствие проектов у пользователя. */
                t.userHasNoProjects}
          </p>
        ) : (
          <>
            {/* Корзина — один список: сначала «всё», потом удалённые проекты,
                потом живые проекты с удалённым внутри. Выбор в нём один. */}
            {isTrash ? <TrashAllFilesRow /> : null}
            {visibleProjects.length ? (
              <ProjectGroups
                size="column"
                renderItems={(items) => (
                  <div className="pt-1">
                    {items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        groupName={p.groupName}
                      />
                    ))}
                  </div>
                )}
              />
            ) : null}
            {isTrash
              ? trashProjects.map((row) => (
                  <TrashFilesCard key={row.id} row={row} />
                ))
              : null}
          </>
        )}
      </div>

      {isTrash ? (
        <div className="shrink-0 border-t border-foreground/[0.07] px-4 py-3">
          {/* Очистка — про проекты: у файлов свои корзины внутри живых проектов,
              и сносить их кнопкой на общем разделе было бы не тем действием. */}
          {source.projectPurgeUrl && counts.trash > 0 ? (
            <button
              type="button"
              onClick={emptyTrash}
              className="mb-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-destructive/35 text-[13px] text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              {t.emptyTrashAction}
            </button>
          ) : null}
          <p className="text-[11.5px] leading-relaxed text-ws-5">
            {tf(t.trashRetention, { days: TRASH_RETENTION_DAYS })}
          </p>
        </div>
      ) : source.can.createProject ? (
        <div className="shrink-0 border-t border-foreground/[0.07] p-3">
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
