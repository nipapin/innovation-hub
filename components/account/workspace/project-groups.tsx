"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Project } from "./types"
import { useWorkspace } from "./workspace-context"

type GroupKey = "own" | "shared"
type Size = "column" | "page"

const COLLAPSED_KEY = "ffworks-ws-collapsed-groups"

/**
 * Какие группы свёрнуты. Одно состояние на оба режима: в полном и упрощённом
 * это тот же список, только разного размера, и свёрнутое в одном не должно
 * внезапно раскрыться в другом. Хранится в браузере, как режим и вид файлов.
 */
function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Partial<Record<GroupKey, boolean>>>(
    {},
  )

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY)
      if (raw) setCollapsed(JSON.parse(raw))
    } catch {
      // битое значение — просто всё раскрыто
    }
  }, [])

  const toggle = useCallback((key: GroupKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { collapsed, toggle }
}

function GroupHeader({
  size,
  label,
  count,
  open,
  onToggle,
}: {
  size: Size
  label: string
  count: number
  open: boolean
  onToggle: () => void
}) {
  const page = size === "page"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex w-full items-center gap-2 rounded-md py-1.5 text-left",
        page ? "px-0.5" : "px-1",
      )}
    >
      <ChevronRight
        className={cn(
          "shrink-0 text-ws-4 transition-transform",
          page ? "h-[18px] w-[18px]" : "h-4 w-4",
          open && "rotate-90",
        )}
      />
      <span
        className={cn(
          // Те же буквы, что и у заголовка раздела «Проекты», на шаг мельче:
          // группа — это ступень под ним, а не отдельный вид надписи.
          "whitespace-nowrap font-semibold uppercase text-ws-accent",
          page ? "text-[15px] tracking-[1.4px]" : "text-[12px] tracking-[1.4px]",
        )}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-foreground/[0.07]" />
      <span
        className={cn("tabular-nums text-ws-4", page ? "text-[13px]" : "text-[12px]")}
      >
        {count}
      </span>
    </button>
  )
}

/**
 * Свои и расшаренные проекты — один раздел «Проекты», внутри две группы.
 *
 * Раньше это были два пункта бокового меню, и чужой проект, в котором человек
 * работает каждый день, жил отдельно от своих. Инструменты остаются своим
 * разделом: это не проекты.
 *
 * Пустой список вызывающий показывает сам — тексты у колонки и витрины разные.
 * Сюда приходит только непустой, и как рисовать сами проекты, решает
 * `renderItems`.
 */
export function ProjectGroups({
  size,
  renderItems,
}: {
  /** Колонка полного режима или витрина упрощённого и мобильного. */
  size: Size
  renderItems: (items: Project[]) => ReactNode
}) {
  const { t, source, projects, visibleProjects, projectTab, query } =
    useWorkspace()
  const { collapsed, toggle } = useCollapsedGroups()

  // Делить есть что не всегда: у большинства расшаренных нет, и заголовок над
  // единственной группой был бы шумом. Смотрим на весь список, а не на
  // найденное, — иначе заголовки прыгали бы при наборе в поиске.
  const grouped =
    source.splitByTab &&
    projectTab === "projects" &&
    projects.some((p) => p.sharedWithMe && !p.deletedAt)
  if (!grouped) return <>{renderItems(visibleProjects)}</>

  // Поиск раскрывает свёрнутое: найденное не должно прятаться за заголовком.
  const searching = query.trim() !== ""
  const groups = [
    {
      key: "own" as const,
      label: t.ownGroup,
      items: visibleProjects.filter((p) => !p.sharedWithMe),
    },
    {
      key: "shared" as const,
      label: t.sharedGroup,
      items: visibleProjects.filter((p) => p.sharedWithMe),
    },
  ]

  return (
    <>
      {groups.map((g) => {
        // При поиске пустая группа не нужна. Без поиска пустыми бывают только
        // свои — у человека одни расшаренные, и ему стоит видеть, где появятся
        // собственные.
        if (g.items.length === 0 && searching) return null
        const open = searching || !collapsed[g.key]
        return (
          <div
            key={g.key}
            className={size === "page" ? "flex flex-col gap-4" : "mb-2"}
          >
            <GroupHeader
              size={size}
              label={g.label}
              count={g.items.length}
              open={open}
              onToggle={() => toggle(g.key)}
            />
            {!open ? null : g.items.length > 0 ? (
              renderItems(g.items)
            ) : (
              <p
                className={cn(
                  "text-ws-4",
                  size === "page"
                    ? "py-6 text-[14px]"
                    : "px-3 py-3 text-[13px]",
                )}
              >
                {t.emptyProjects}
              </p>
            )}
          </div>
        )
      })}
    </>
  )
}
