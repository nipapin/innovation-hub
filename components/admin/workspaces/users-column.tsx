"use client"

import { useMemo, useState } from "react"
import { ChevronRight, Loader2, Search, UserX } from "lucide-react"
import { toast } from "sonner"

import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { UserHistory } from "@/components/admin/shared/user-history"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { cn } from "@/lib/utils"

export type PipelineUserDto = {
  id: string
  fullName: string
  email: string
  automationEnabled: boolean
  isActive: boolean
  projectCount: number
  watchedCount: number
  archivedCount: number
  lastActivityAt: string | null
  /** NULL — общий раздел. По нему список разбивается на области. */
  companyId: string | null
  companyTitle: string | null
}

export type CompanyPickDto = { id: string; title: string }

/** Где браузер помнит свёрнутые области. Рядом с шириной колонки. */
const COLLAPSED_KEY = "ffworks-workspaces-collapsed-areas"

type Props = {
  users: PipelineUserDto[]
  /** Все компании установки, включая безлюдные — см. `groups`. */
  companies: CompanyPickDto[]
  loading: boolean
  selectedUserId: string | null
  onSelectUser: (userId: string) => void
  onToggle: (userId: string, enabled: boolean) => void
}

/**
 * Колонка 1 «Конвейера»: кто участвует в обработке.
 *
 * Тумблер здесь — гейт уровня пользователя: он снимает со слежения все проекты
 * сразу, но не меняет их собственные флаги. Поэтому рядом с ним показываем, из
 * чего состоит его список: сколько проектов под слежением и сколько в архиве —
 * иначе непонятно, почему у включённого пользователя ничего не обрабатывается.
 */
export function UsersColumn({
  users,
  companies,
  loading,
  selectedUserId,
  onSelectUser,
  onToggle,
}: Props) {
  const t = useAdminI18n()
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)

  /**
   * Свёрнутые области. Хранятся между заходами: свернул общий раздел, чтобы не
   * мешал, — он и останется свёрнутым, а не развернётся при каждом открытии.
   *
   * Читается один раз при первом рендере, а не в эффекте: иначе список успел бы
   * моргнуть развёрнутым.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // Память браузера недоступна — свёртка просто не переживёт перезагрузку.
      }
      return next
    })
  }

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 300,
    min: 240,
    max: 480,
    axis: "x",
    storageKey: "ffworks-pipeline-users-width",
  })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        // И по названию компании: «spot» оставляет её людей. Это заменяет
        // отдельный фильтр — выпадающий список в колонке шириной 300 пикселей
        // стоит дороже, чем экономит.
        (u.companyTitle ?? "").toLowerCase().includes(q),
    )
  }, [users, query])

  /**
   * Разбивка на области: общий раздел первым, дальше компании по названию.
   *
   * Порядок тот же, что на пульте конвейера: две страницы про одно и то же не
   * должны читаться по-разному.
   *
   * Компании берутся СПИСКОМ с сервера, а не выводятся из людей: заведённая, но
   * пока безлюдная компания обязана быть видна строкой «пока никого». Выведи мы
   * области из пользователей — её бы просто не было, и «завели или нет» пришлось
   * бы выяснять в другом разделе.
   *
   * При поиске пустые области скрываются: список сузили намеренно, и заголовки
   * без единой строки под ними были бы шумом ровно там, где ищут одного
   * человека.
   */
  const groups = useMemo(() => {
    const searching = query.trim().length > 0
    const byCompany = new Map<string | null, PipelineUserDto[]>()
    for (const user of visible) {
      const key = user.companyId ?? null
      const list = byCompany.get(key)
      if (list) list.push(user)
      else byCompany.set(key, [user])
    }

    const ordered = [
      {
        key: "__general__",
        title: t.pipelineAreaGeneral,
        rows: byCompany.get(null) ?? [],
      },
      ...[...companies]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((company) => ({
          key: company.id,
          title: company.title,
          rows: byCompany.get(company.id) ?? [],
        })),
    ].map((group) => ({
      ...group,
      /**
       * Во время поиска свёртка не действует.
       *
       * Иначе человек набирает фамилию, попадание есть, а на экране пусто —
       * потому что область когда-то свернули и забыли. Поиск обязан показывать
       * то, что нашёл.
       */
      collapsed: searching ? false : collapsed.has(group.key),
    }))

    return searching ? ordered.filter((g) => g.rows.length > 0) : ordered
  }, [visible, companies, query, collapsed, t])

  const enabledCount = users.filter((u) => u.automationEnabled).length

  const toggle = async (user: PipelineUserDto) => {
    setPending(user.id)
    try {
      const res = await fetch("/api/admin/workspaces/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          automationEnabled: !user.automationEnabled,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.message ?? t.pipelineUserToggleError)
        return
      }
      onToggle(user.id, !user.automationEnabled)
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setPending(null)
    }
  }

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
              {t.pipelineUsers}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-ws-4">
            {enabledCount}/{users.length}
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
            placeholder={t.pipelineUserSearch}
            className="h-[38px] w-full rounded-[9px] border border-foreground/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loading ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">
            {t.pipelineNothingFound}
          </p>
        ) : (
          groups.map((group) => (
          <div key={group.key}>
            {/* Заголовок области липкий: в длинном списке видно, чьи папки
                сейчас на экране, без прокрутки вверх. Он же кнопка свёртки —
                отдельная стрелка рядом с кликабельной строкой была бы второй
                мишенью для одного и того же действия. */}
            <div className="sticky top-0 z-10 -mx-3 bg-ws-well/95 px-3 pb-1 pt-3 backdrop-blur">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!group.collapsed}
                className="flex w-full items-baseline justify-between gap-2 rounded-[7px] px-1 py-0.5 text-left hover:bg-foreground/[0.04]"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-ws-5 transition-transform",
                      group.collapsed ? null : "rotate-90",
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-[1.2px] text-ws-4">
                    {group.title}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-ws-5">
                  {group.rows.filter((u) => u.automationEnabled).length}/
                  {group.rows.length}
                </span>
              </button>
            </div>
            {group.collapsed ? null : group.rows.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] text-ws-5">
                {t.pipelineAreaEmpty}
              </p>
            ) : (
          <ul className="pt-1">
            {group.rows.map((user) => {
              const active = user.id === selectedUserId
              const busy = pending === user.id
              return (
                <li key={user.id}>
                  <div
                    className={cn(
                      "mb-1 flex items-start gap-2.5 rounded-[10px] px-2.5 py-2.5",
                      active ? "bg-ws-hover" : "hover:bg-foreground/[0.04]",
                      // Заблокированный аккаунт и снятый гейт приглушаем: строка
                      // остаётся читаемой, но видно, что обработки по ней нет.
                      !user.isActive || !user.automationEnabled
                        ? "opacity-55"
                        : null,
                    )}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={user.automationEnabled}
                      aria-label={tf(t.pipelineWatchAria, { email: user.email })}
                      disabled={busy || !user.isActive}
                      onClick={() => void toggle(user)}
                      className={cn(
                        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
                        user.automationEnabled ? "bg-ws-action" : "bg-foreground/10",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white transition-all",
                          user.automationEnabled ? "left-[19px]" : "left-[3px]",
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectUser(user.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-[13.5px]",
                            active ? "text-ws-1" : "text-ws-2",
                          )}
                        >
                          {user.fullName || user.email}
                        </span>
                        {user.isActive ? null : (
                          <UserX
                            className="h-3.5 w-3.5 shrink-0 text-ws-5"
                            aria-label={t.pipelineSuspendedAria}
                          />
                        )}
                      </span>
                      {user.fullName ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-ws-4">
                          {user.email}
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ws-4">
                        <span>
                          {tf(t.pipelineWatchedOf, {
                            watched: user.watchedCount,
                            total: user.projectCount,
                          })}
                        </span>
                        {user.archivedCount > 0 ? (
                          <span className="text-ws-5">
                            {tf(t.pipelineArchived, {
                              count: user.archivedCount,
                            })}
                          </span>
                        ) : null}
                      </span>
                    </button>

                    {/* Вне кнопки выбора намеренно: кнопка внутри кнопки
                        невалидна, и клик по значку выбирал бы пользователя
                        вместо того, чтобы показать, что с ним делали. */}
                    <UserHistory
                      userId={user.id}
                      userLabel={user.email}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
            )}
          </div>
          ))
        )}
      </div>

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.pipelineUsers}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}
