"use client"

import {
  AlignJustify,
  ArrowDownAZ,
  ArrowLeft,
  CalendarDays,
  Columns3,
  FolderTree,
  HardDrive,
  LayoutGrid,
  List,
  Rows2,
  Rows3,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { TrashSort } from "./trash-model"
import type { Density, ViewMode } from "./types"
import { useWorkspace } from "./workspace-context"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

function SegButton({
  active,
  icon: Icon,
  label,
  iconOnly,
  onClick,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  iconOnly?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={cn(
        "flex h-7 items-center justify-center gap-1.5 rounded-md text-[13px] transition-colors",
        iconOnly ? "w-[30px]" : "px-3",
        active ? "bg-ws-select/35 text-ws-1" : "text-ws-3 hover:text-ws-1",
      )}
    >
      <Icon className={iconOnly ? "h-[18px] w-[18px]" : "h-[17px] w-[17px]"} />
      {iconOnly ? null : label}
    </button>
  )
}

/**
 * Переключатель режима рабочей области.
 *
 * Только с `lg`: ниже этого порога раскладка всегда мобильная
 * (`MobileWorkspace`, см. `workspace-page.tsx`), режим на неё не влияет вовсе, и
 * переключатель занимал место в узкой шапке, ничего при этом не переключая.
 */
export function DensitySwitch() {
  const { t, density, setDensity } = useWorkspace()
  const options: { id: Density; icon: LucideIcon; label: string }[] = [
    { id: "full", icon: Rows3, label: t.compact },
    { id: "simple", icon: Rows2, label: t.cozy },
  ]
  return (
    <div className="hidden shrink-0 gap-[3px] rounded-[9px] border border-foreground/10 bg-ws-control p-[3px] lg:flex">
      {options.map((o) => (
        <SegButton
          key={o.id}
          active={density === o.id}
          icon={o.icon}
          label={o.label}
          onClick={() => setDensity(o.id)}
        />
      ))}
    </div>
  )
}

/** Список / плитка / колонки. */
export function ViewSwitch({ className }: { className?: string }) {
  const { t, view, setView } = useWorkspace()
  const options: { id: ViewMode; icon: LucideIcon; label: string }[] = [
    { id: "list", icon: List, label: t.viewList },
    { id: "grid", icon: LayoutGrid, label: t.viewGrid },
    { id: "columns", icon: Columns3, label: t.viewColumns },
  ]
  return (
    <div
      className={cn(
        "flex shrink-0 gap-0.5 rounded-[9px] border border-foreground/10 bg-ws-control p-[3px]",
        className,
      )}
    >
      {options.map((o) => (
        <SegButton
          key={o.id}
          active={view === o.id}
          icon={o.icon}
          label={o.label}
          iconOnly
          onClick={() => setView(o.id)}
        />
      ))}
    </div>
  )
}

/**
 * «Без папок» — поправка к виду, а не отдельный вид.
 *
 * Стоит рядом с переключателем списка и плитки, но в своей рамке: он с ними не
 * спорит, а сочетается — плоским бывает и список, и плитка. Колонки при нём
 * гаснут сами (см. FileBrowser): ходить по уровням, когда уровней нет, нечем.
 */
export function FlatSwitch() {
  const { t, flat, setFlat } = useWorkspace()
  return (
    <div className="flex shrink-0 gap-0.5 rounded-[9px] border border-foreground/10 bg-ws-control p-[3px]">
      <SegButton
        active={flat}
        icon={AlignJustify}
        label={t.viewFlat}
        iconOnly
        onClick={() => setFlat(!flat)}
      />
    </div>
  )
}

/**
 * Порядок строк корзины и разбивка по проектам.
 *
 * «По проектам» показывается только в корне: когда смотрят корзину одного
 * проекта, группировать не по чему — группа будет ровно одна, и кнопка бы
 * обещала действие, которого не произойдёт.
 */
export function TrashSortSwitch() {
  const {
    t,
    trashSort,
    setTrashSort,
    trashProjectId,
    groupProjects,
    setGroupProjects,
  } = useWorkspace()
  const options: { id: TrashSort; icon: LucideIcon; label: string }[] = [
    { id: "date", icon: CalendarDays, label: t.sortByDate },
    { id: "name", icon: ArrowDownAZ, label: t.sortByName },
    { id: "size", icon: HardDrive, label: t.sortBySize },
  ]
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex shrink-0 gap-0.5 rounded-[9px] border border-foreground/10 bg-ws-control p-[3px]">
        {options.map((o) => (
          <SegButton
            key={o.id}
            active={trashSort === o.id}
            icon={o.icon}
            label={o.label}
            iconOnly
            onClick={() => setTrashSort(o.id)}
          />
        ))}
      </div>
      {trashProjectId ? null : (
        <div className="flex shrink-0 gap-0.5 rounded-[9px] border border-foreground/10 bg-ws-control p-[3px]">
          <SegButton
            active={groupProjects}
            icon={FolderTree}
            label={t.groupByProject}
            iconOnly
            onClick={() => setGroupProjects(!groupProjects)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Верхняя панель рабочей области: путь, переключатель режима и ссылка на сайт.
 * Рендерится всегда — даже когда проект не выбран.
 */
export function WorkspaceTopbar() {
  const { t, density, selected, clearSelection } = useWorkspace()
  const rootLabel = density === "simple" ? t.allProjectsCrumb : t.breadcrumbProjects

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={clearSelection}
          aria-label={t.allProjectsCrumb}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <ArrowLeft className="h-[19px] w-[19px]" />
        </button>
        <button
          type="button"
          onClick={clearSelection}
          className="hidden rounded-lg px-2 py-1 text-[16px] font-medium text-ws-3 hover:bg-foreground/5 hover:text-ws-1 sm:block"
        >
          {/* Ниже lg режима не существует, поэтому и его подпись там не нужна:
              крошка всегда «Проекты», как и сам корень, к которому она ведёт. */}
          <span className="lg:hidden">{t.breadcrumbProjects}</span>
          <span className="hidden lg:inline">{rootLabel}</span>
        </button>
        {selected ? (
          <>
            <span className="hidden text-[16px] text-ws-5 sm:inline">/</span>
            <span className="truncate text-[15px] font-semibold text-ws-1 md:text-[16px]">
              {selected.name}
            </span>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 md:gap-4">
        <DensitySwitch />
        <ProcessingIndicator />
      </div>
    </header>
  )
}
