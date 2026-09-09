"use client"

import {
  Archive,
  Folder,
  MessageCircle,
  AlertTriangle,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Users,
  Wrench,
} from "lucide-react"

import { tf } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { fmtDate, trashDaysLeft } from "./format"
import { GiftBadge } from "./gift-badge"
import type { Project } from "./types"
import { useWorkspace } from "./workspace-context"

/**
 * Карточка проекта в корзине.
 *
 * Открывается как обычная — заглянуть в удалённый проект можно, файлы на месте
 * до истечения срока. Отличается тем, чего на ней нет: паузы и чата. Тумблер
 * обработки удалённому проекту не к чему (конвейер его не берёт), а писать в
 * чат нельзя — роль зажата до читателя. Вместо них срок и «Восстановить».
 */
function TrashProjectCard({ project }: { project: Project }) {
  const { t, lang, selectedId, selectProject, restoreProject, openMenu, menu } =
    useWorkspace()

  const deletedAt = project.deletedAt as string
  const daysLeft = trashDaysLeft(deletedAt)
  const selected = project.id === selectedId
  const isMenuTarget = menu?.kind === "project" && menu.project?.id === project.id

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => selectProject(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          selectProject(project.id)
        }
      }}
      onContextMenu={(e) => openMenu("project", e, { project })}
      className={cn(
        "relative mb-[7px] cursor-pointer rounded-lg border px-[5px] py-2.5",
        isMenuTarget
          ? "border-ws-accent/75"
          : selected
            ? "border-ws-select/55 bg-gradient-to-b from-ws-select/[0.22] to-ws-select/[0.06] shadow-ws-inset"
            : "border-white/10 hover:border-white/20",
      )}
    >
      {selected ? (
        <span className="absolute bottom-[9px] left-0 top-[7px] w-[3px] rounded-[3px] bg-ws-select" />
      ) : null}

      <div className="flex items-center gap-2.5 leading-tight">
        <Trash2 className="h-5 w-5 shrink-0 text-ws-4" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[16px]",
            selected ? "text-ws-1" : "text-ws-3",
          )}
        >
          {project.name}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-ws-5">
          {tf(t.trashDeletedOn, { date: fmtDate(deletedAt, lang) })}
          {" · "}
          {daysLeft === 0
            ? t.trashLastDay
            : tf(t.trashDaysLeft, { days: daysLeft })}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            restoreProject(project)
          }}
          className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.12] px-2.5 py-[3px] text-[11px] text-ws-2 hover:brightness-125"
        >
          <RotateCcw className="h-3 w-3" />
          {t.mRestore}
        </button>
      </div>
    </div>
  )
}

/** Карточка проекта в левой колонке: имя, статус обработки и чат. */
export function ProjectCard({
  project,
  groupName,
}: {
  project: Project
  groupName: string
}) {
  const {
    t,
    source,
    selectedId,
    selectProject,
    patchProject,
    openChat,
    openMenu,
    menu,
  } = useWorkspace()

  const selected = project.id === selectedId
  const isTool = groupName === "tools"
  const inTrash = project.deletedAt != null
  const paused = project.isPaused
  /**
   * Проект остановлен биллингом. Тумблер в этом случае показывается, но
   * включиться не даст: API ответит отказом, потому что платить нечем.
   * Показываем причину рядом, иначе человек будет жать на кнопку и не понимать,
   * почему ничего не происходит.
   */
  const billingStop = paused ? (project.pausedReason ?? null) : null
  const unread = project.unreadCount > 0
  /**
   * Архив показываем пометкой только там, где список не разделён по разделам:
   * в кабинете архивные лежат в своём разделе, и подпись была бы шумом, а в
   * админке они идут вперемешку с остальными и различать их нужно.
   */
  const showArchivedBadge = !source.splitByTab && project.isArchived
  /** Скольким расшарен. Ноль не показываем — большинство проектов личные. */
  const sharedWith = project.memberCount > 0 ? project.memberCount : null
  const isMenuTarget = menu?.kind === "project" && menu.project?.id === project.id
  const Icon = isTool ? Wrench : Folder

  if (inTrash) return <TrashProjectCard project={project} />

  const chatPill = (
    <button
      type="button"
      title={t.openChat}
      onClick={(e) => {
        e.stopPropagation()
        openChat(project.id)
      }}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] hover:brightness-125",
        unread
          ? "border-ws-select/50 bg-ws-select/[0.12] text-primary"
          : "border-white/[0.12] text-ws-3",
      )}
    >
      <MessageCircle className="h-3 w-3" />
      {t.chat}
      {unread ? (
        <span className="h-[7px] w-[7px] rounded-full bg-ws-select ring-2 ring-ws-select/30" />
      ) : null}
    </button>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => selectProject(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          selectProject(project.id)
        }
      }}
      onContextMenu={(e) => openMenu("project", e, { project })}
      className={cn(
        "relative mb-[7px] cursor-pointer rounded-lg border",
        isMenuTarget
          ? "border-ws-accent/75"
          : selected
            ? "border-ws-select/55 bg-gradient-to-b from-ws-select/[0.22] to-ws-select/[0.06] shadow-ws-inset"
            : "border-white/10 hover:border-white/20",
        paused && !selected && "opacity-55",
      )}
    >
      {selected ? (
        <span className="absolute bottom-[9px] left-0 top-[7px] w-[3px] rounded-[3px] bg-ws-select" />
      ) : null}

      <div
        className={cn(
          "relative flex items-center gap-2.5 px-[5px] pt-2.5 leading-tight",
          // Нижняя строка не должна прилегать к верхней вплотную.
          isTool ? "pb-2.5" : "pb-[7px]",
        )}
      >
        <Icon
          className={cn(
            "h-5 w-5 shrink-0",
            selected ? "text-chart-3" : paused ? "text-ws-4" : "text-ws-3",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[16px]",
            selected ? "text-ws-1" : paused ? "text-ws-4" : "text-ws-2",
          )}
        >
          {project.name}
        </span>
        {/* До счётчика расшаренных: «чем оплачен» важнее «скольким виден». */}
        {project.gift ? (
          <GiftBadge gift={project.gift} size="sm" className="shrink-0" />
        ) : null}
        {sharedWith ? (
          <span
            title={tf(t.projectSharedWith, { users: sharedWith })}
            className="flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-ws-5"
          >
            <Users className="h-3 w-3" />
            {sharedWith}
          </span>
        ) : null}
        {isTool ? chatPill : null}
      </div>

      {isTool ? null : (
        <div className="relative flex items-stretch justify-between gap-2 px-[5px] pb-[9px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              title={paused ? t.resumeProject : t.pauseProject}
              onClick={(e) => {
                e.stopPropagation()
                void patchProject(project.id, { isPaused: !paused })
              }}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] hover:brightness-125",
                paused
                  ? "border-white/[0.12] text-ws-3"
                  : "border-ws-out/40 bg-ws-out/10 text-ws-out",
              )}
            >
              {paused ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {paused ? t.statusPaused : t.statusActive}
            </button>
            {billingStop ? (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-[3px] text-[11px] text-destructive"
              >
                <AlertTriangle className="h-3 w-3" />
                {billingStop === "trial-over"
                  ? t.projectPausedTrialOver
                  : billingStop === "no-vendor-key"
                    ? t.projectPausedNoVendorKey
                    : t.projectPausedNoFunds}
              </span>
            ) : null}
            {showArchivedBadge ? (
              <span
                title={t.archiveProject}
                className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.12] px-2 py-[3px] text-[11px] text-ws-4"
              >
                <Archive className="h-3 w-3" />
                {t.archiveTab}
              </span>
            ) : null}
          </div>
          {chatPill}
        </div>
      )}
    </div>
  )
}
