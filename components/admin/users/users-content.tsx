"use client"

import { useMemo, useState } from "react"
import { Plus, Users } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { AdminUserRow } from "@/components/admin/admin-user-row"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { SearchInput } from "@/components/admin/shared/search-input"
import { isElevated } from "@/lib/admin-roles"
import type { AdminUser } from "@/components/admin/admin-types"
import type { UserRole } from "@/lib/domain-types"

type Filter = "all" | "admins" | "members" | "suspended"

/** Одна ступень вниз по лестнице; обычному пользователю — вверх, до админа. */
function nextRoleDown(role: UserRole): UserRole {
  if (role === "SUPERADMIN") return "ADMIN"
  if (role === "ADMIN") return "USER"
  return "ADMIN"
}

export function UsersContent() {
  const {
    users,
    loading,
    currentUserId,
    canManageRoles,
    openCreateUser,
    openEditUser,
    openCapabilities,
    can,
    patchUser,
    confirmDeleteUser,
  } = useAdminData()
  const { t: page } = useI18n()
  const t = useAdminI18n()

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  /**
   * Человек — это его вход; профили в компаниях висят под ним. Отдельной
   * строкой подпрофиль выглядел дублем того же человека. Подпрофиль без
   * входа в списке (не должно быть, но данные бывают всякими) остаётся
   * самостоятельной строкой, чтобы не пропасть.
   */
  const groups = useMemo(() => {
    const logins = new Set(users.filter((u) => !u.loginUserId).map((u) => u.id))
    const profiles = new Map<string, AdminUser[]>()
    for (const u of users) {
      if (!u.loginUserId || !logins.has(u.loginUserId)) continue
      const list = profiles.get(u.loginUserId) ?? []
      list.push(u)
      profiles.set(u.loginUserId, list)
    }
    return users
      .filter((u) => !u.loginUserId || !logins.has(u.loginUserId))
      .map((user) => ({ user, profiles: profiles.get(user.id) ?? [] }))
  }, [users])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (user: AdminUser) => {
      if (filter === "admins" && !isElevated(user.role)) return false
      if (filter === "members" && user.role !== "USER") return false
      if (filter === "suspended" && user.isActive) return false
      if (!q) return true
      return (
        user.fullName.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        (user.companyTitle ?? "").toLowerCase().includes(q)
      )
    }
    // Группа видна, если подходит вход или любой его профиль: заблокированный
    // профиль в компании иначе не нашёлся бы фильтром «Заблокированы».
    return groups.filter((g) => matches(g.user) || g.profiles.some(matches))
  }, [groups, query, filter])

  const counts = {
    all: groups.length,
    admins: groups.filter((g) => isElevated(g.user.role)).length,
    members: groups.filter((g) => g.user.role === "USER").length,
    suspended: groups.filter(
      (g) => !g.user.isActive || g.profiles.some((p) => !p.isActive),
    ).length,
  }

  const toggleProfiles = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderRow = (user: AdminUser, extra: Partial<RowExtra> = {}) => (
    <AdminUserRow
      key={user.id}
      user={user}
      isCurrent={user.id === currentUserId}
      canManageRoles={canManageRoles}
      canManageUsers={can("users.manage")}
      onEdit={() => openEditUser(user)}
      onOpenCapabilities={() => openCapabilities(user)}
      onToggleRole={() =>
        void patchUser(user.id, {
          // Ступень вниз, а не сразу в самый низ: понижение суперадмина
          // до админа — рабочий сценарий (этап 5 плана), а вот сброс его
          // до обычного пользователя одним щелчком почти всегда промах.
          // Произвольная роль ставится в диалоге.
          role: nextRoleDown(user.role),
        })
      }
      onToggleActive={() =>
        void patchUser(user.id, { isActive: !user.isActive })
      }
      onDelete={() => confirmDeleteUser(user)}
      {...extra}
    />
  )

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={page.adminPeopleEyebrow}
        title={page.adminPeopleTitle}
        description={page.adminPeopleDesc}
        actions={
          // Страница открыта по users.read, а заводить людей даёт users.manage:
          // теги разные, и кнопка не должна обещать того, чего нет.
          can("users.manage") ? (
            <Button onClick={openCreateUser} className="gap-2 rounded-full">
              <Plus className="h-4 w-4" />
              {page.adminPeopleNew}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t.searchPeople}
        />
        <FilterPills value={filter} onChange={setFilter} counts={counts} />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title={users.length === 0 ? t.noPeopleYet : t.nothingMatches}
          description={
            users.length === 0 ? t.peopleEmptyDesc : t.peopleNoMatchDesc
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(({ user, profiles }) => {
            const open = expanded.has(user.id)
            return (
              <div key={user.id} className="space-y-2">
                {renderRow(user, {
                  profilesCount: profiles.length,
                  profilesOpen: open,
                  onToggleProfiles: () => toggleProfiles(user.id),
                })}
                {open
                  ? profiles.map((p) => renderRow(p, { nested: true }))
                  : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type RowExtra = {
  nested: boolean
  profilesCount: number
  profilesOpen: boolean
  onToggleProfiles: () => void
}

type FilterPillsProps = {
  value: Filter
  onChange: (value: Filter) => void
  counts: Record<Filter, number>
}

function FilterPills({ value, onChange, counts }: FilterPillsProps) {
  const t = useAdminI18n()
  const items: { id: Filter; label: string }[] = [
    { id: "all", label: t.all },
    { id: "admins", label: t.filterAdmins },
    { id: "members", label: t.filterMembers },
    { id: "suspended", label: t.filterSuspended },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card/40 p-1">
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
            <span
              className={`ml-1.5 rounded px-1.5 text-[10px] tabular-nums ${
                active
                  ? "bg-background/15 text-background"
                  : "bg-muted/50 text-muted-foreground"
              }`}
            >
              {counts[item.id]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
