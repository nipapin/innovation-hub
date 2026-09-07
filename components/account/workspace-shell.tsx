"use client"
import { SITE_NAME } from "@/lib/site"
import { isElevated } from "@/lib/admin-roles"
import { useDisabledAdminTools } from "@/components/admin/shell/features-context"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  KeyRound,
  Trash2,
  Users,
  Wrench,
  type LucideIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Wallet,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/domain-types"
import { BalanceWidget } from "@/components/account/balance-widget"
import { isKeysPath } from "@/components/account/keys/keys-shell"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { useProjectCounts } from "@/components/account/use-project-counts"
import { useAdminChatUnread } from "@/components/admin/use-admin-chat-unread"
import type { ProjectTab } from "@/components/account/workspace/workspace-context"
import {
  I18nProvider,
  avatarInitials,
  formatBalance,
  useI18n,
} from "@/components/account/i18n"
import {
  areaHref,
  isAreaActive,
  visibleAreas,
} from "@/components/admin/shell/nav-config"
import type { AdminCapability } from "@/lib/admin-capabilities"

/** Ширины боковой панели: свёрнутая, развёрнутая по умолчанию и минимум развёрнутой. */
const SIDEBAR_COLLAPSED = 72
const SIDEBAR_EXPANDED = 248
const SIDEBAR_MIN_EXPANDED = 200
/** Ниже этой ширины панель показывается свёрнутой. */
const SIDEBAR_SNAP = 150

/**
 * Разделы списка проектов — плоские кнопки бокового меню.
 * Все ведут на одну страницу, отличается только `?tab=`.
 */
const PROJECT_SECTIONS: {
  tab: ProjectTab
  labelKey: "projects" | "sharedTab" | "toolsTab" | "archiveTab" | "trashTab"
  icon: LucideIcon
}[] = [
  { tab: "projects", labelKey: "projects", icon: FolderOpen },
  { tab: "shared", labelKey: "sharedTab", icon: Users },
  { tab: "tools", labelKey: "toolsTab", icon: Wrench },
  { tab: "archive", labelKey: "archiveTab", icon: Archive },
  { tab: "trash", labelKey: "trashTab", icon: Trash2 },
]

export type WorkspaceUser = {
  email: string
  fullName: string
  role: UserRole
  /** Теги админа: по ним фильтруется свёртка «Админка» в боковом меню. */
  capabilities: AdminCapability[]
  balanceCents: number
}

type ShellProps = WorkspaceUser & {
  children: React.ReactNode
}

function NavItem({
  href,
  active,
  icon,
  label,
  collapsed,
  nested,
  count,
  badge,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
  collapsed: boolean
  nested?: boolean
  /** Число справа. Пустой раздел показывается приглушённым, но остаётся кликабельным. */
  count?: number
  /**
   * Непрочитанное. Не то же самое, что `count`: там «сколько всего лежит в
   * разделе» и ноль гасит пункт, здесь «сколько ждёт человека» — ноль просто
   * не рисуется, и раздел от этого не тускнеет. В свёрнутом меню число не
   * помещается, поэтому от него остаётся точка на значке: сигнал «есть новое»
   * обязан переживать сворачивание панели.
   */
  badge?: number
}) {
  const dimmed = count === 0 && !active
  const unread = badge && badge > 0 ? badge : 0

  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-colors",
        collapsed && "justify-center px-2",
        nested && !collapsed && "py-2 text-[13px]",
        active
          ? "bg-[rgba(45,131,206,0.16)] text-[#eef1f6]"
          : "text-[#c3c8d2] hover:bg-white/5 hover:text-[#eef1f6]",
        dimmed && "opacity-45",
      )}
    >
      {active && (
        <span className="absolute bottom-[9px] left-0 top-[9px] w-[3px] rounded-[3px] bg-[#2f80ed]" />
      )}
      <span
        className={cn(
          "relative",
          active ? "text-[#6aa5e8]" : "text-[#8b909c]",
        )}
      >
        {icon}
        {unread > 0 && collapsed ? (
          <span className="absolute -right-1 -top-1 h-[9px] w-[9px] rounded-full bg-ws-action ring-2 ring-ws-panel" />
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 whitespace-nowrap">{label}</span>
          {unread > 0 ? (
            <span className="shrink-0 rounded-full bg-ws-action px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : typeof count === "number" && count > 0 ? (
            <span className="shrink-0 text-[12.5px] tabular-nums text-[#7c8290]">
              {count}
            </span>
          ) : null}
        </>
      )}
    </Link>
  )
}

function SidebarContent({
  user,
  collapsed,
  onToggle,
  onNavigate,
}: {
  user: WorkspaceUser
  collapsed: boolean
  onToggle?: () => void
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t, lang, setLang } = useI18n()
  const disabledAdminTools = useDisabledAdminTools()
  const initials = avatarInitials(user.fullName, user.email)

  const counts = useProjectCounts()
  /**
   * Непрочитанное в чатах проектов. Считается только для админов — внутри
   * хука по тегу `projects.access`, тому же, по которому раздел вообще виден.
   */
  const chatUnread = useAdminChatUnread(user.role, user.capabilities)

  // Статистика подсвечивает дашборд, а не себя: своего пункта в меню у неё нет
  // намеренно (docs/STATISTICS_PLAN.md §7.4) — она продолжает сводку дашборда,
  // и вход в неё оттуда же. Погасшее меню на такой странице читается как «я
  // куда-то вышел», хотя человек внутри того же раздела.
  const isDash =
    pathname === "/account" || pathname.startsWith("/account/statistics")
  const inProjects = pathname.startsWith("/account/projects")
  // Все разделы — одна страница проектов, отличается только ?tab=…
  const tab = searchParams.get("tab") ?? "projects"
  const isTab = (name: ProjectTab) => inProjects && tab === name
  const isProfile = pathname.startsWith("/account/profile")
  // Разделы, поднятые из «Админки» на верхний уровень, подсвечивают сами себя:
  // свёртка при них не считается активной и не раскрывается.
  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5 px-3.5",
          collapsed && "h-auto flex-col justify-center gap-1.5 px-2 pb-2 pt-3.5",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? t.sidebarExpand : t.sidebarCollapse}
          aria-label={collapsed ? t.sidebarExpand : t.sidebarCollapse}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[rgba(91,155,224,0.4)] bg-gradient-to-br from-[#1f3a63] to-[#16273f] text-[12px] font-bold tracking-wide text-[#7fb0f0]"
        >
          FF
        </button>
        {collapsed ? (
          onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              title={t.sidebarExpand}
              aria-label={t.sidebarExpand}
              className="flex h-[22px] w-[34px] shrink-0 items-center justify-center rounded-md text-[#9aa0ac] hover:bg-white/5 hover:text-[#eef1f6]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null
        ) : (
          <>
            <span className="flex-1 whitespace-nowrap text-[16px] font-semibold text-[#eef1f6]">
              {SITE_NAME}
            </span>
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                title={t.sidebarCollapse}
                aria-label={t.sidebarCollapse}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#9aa0ac] hover:bg-white/5 hover:text-[#eef1f6]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Прокручиваемая середина панели: при низком окне пункты меню не
          обрезаются, а листаются колесом. Шапка и подвал с профилем
          остаются на месте. */}
      <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="shrink-0 px-3 pb-1 pt-1.5">
          <div
            className={cn(
              "rounded-xl border border-[rgba(91,155,224,0.28)] bg-gradient-to-br from-[rgba(45,131,206,0.16)] to-[rgba(45,131,206,0.03)]",
              collapsed ? "p-2.5" : "p-3.5",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2",
                collapsed && "justify-center",
              )}
            >
              <Wallet className="h-[19px] w-[19px] text-[#8fb8ea]" />
              {!collapsed && (
                <span className="flex-1 text-[10.5px] font-semibold tracking-[1.4px] text-[#8fb8ea]">
                  {t.balance}
                </span>
              )}
            </div>
            {!collapsed && (
              <>
                {/* Число берётся из кошельков биллинга, а не из пропса: `balanceCents`
                    — наследие, оно ничем не подкреплено, а истина здесь сумма ленты
                    транзакций. Тот же компонент стоит на дашборде, чтобы две
                    цифры не разошлись. */}
                <BalanceWidget
                  className="mt-2"
                  href="/account/billing"
                  action={
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[12px] text-[#eef1f6] hover:bg-white/[0.18]"
                    >
                      {t.topup}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>

        <nav className="flex shrink-0 flex-col gap-1 px-3 py-2">
          {!collapsed && (
            <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold tracking-[1.4px] text-[#5a606e]">
              {t.workspaceSection}
            </div>
          )}
          <div onClick={onNavigate}>
            <NavItem
              href="/account"
              active={isDash}
              collapsed={collapsed}
              icon={<LayoutDashboard className="h-5 w-5" />}
              label={t.dashboard}
            />
          </div>
          {PROJECT_SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <div key={section.tab} onClick={onNavigate}>
                <NavItem
                  href={
                    section.tab === "projects"
                      ? "/account/projects"
                      : `/account/projects?tab=${section.tab}`
                  }
                  active={isTab(section.tab)}
                  collapsed={collapsed}
                  icon={<Icon className="h-5 w-5" />}
                  label={t[section.labelKey]}
                  count={counts[section.tab]}
                />
              </div>
            )
          })}
          {/* Чужие секреты человека: ключи сервисов и аккаунты площадок.
              Отдельным пунктом, а не полем в настройках проекта, — и то и
              другое у него ОДНО на все проекты, и заводить их изнутри проекта
              означало бы «найди тот проект, где я это вводил» при заведении,
              при замене и при отзыве.

              Пункт один, инструментов внутри два: их различают в колонке
              раздела (KeysShell). Двумя пунктами меню это было бы честно, но
              боковое меню кабинета — про рабочее место, и секретам в нём место
              одно. */}
          <div onClick={onNavigate}>
            <NavItem
              href="/account/vendor-keys"
              active={isKeysPath(pathname)}
              collapsed={collapsed}
              icon={<KeyRound className="h-5 w-5" />}
              label={t.keysAreaNav}
            />
          </div>
        </nav>

        <div className="flex-1" />

        <nav className="flex shrink-0 flex-col gap-1 px-3 pb-2">
          {isElevated(user.role) && (
            <div className="flex flex-col gap-0.5">
              {/* Отбивка: админская зона отделена от рабочего места.
                  Свёртки здесь нет намеренно — разделы админки лежат так же
                  плоско, как разделы кабинета выше, а что внутри раздела,
                  показывает вторая колонка. Свёртка добавляла клик перед каждым
                  переходом и прятала половину админки от глаз. */}
              <div
                className={cn(
                  "mb-1 h-px bg-white/10",
                  collapsed ? "mx-1" : "mx-2.5",
                )}
              />
              {!collapsed ? (
                <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">
                  {t.adminPanel}
                </p>
              ) : null}
              {visibleAreas(user.role, user.capabilities, disabledAdminTools).map((area) => {
                const Icon = area.icon
                return (
                  <div key={area.key} onClick={onNavigate}>
                    <NavItem
                      // Не `area.href`: у «Конвейера» и «Автопостинга» хаб —
                      // сам инструмент со своим тегом, и кнопка должна вести
                      // туда, куда этого человека пустят.
                      href={areaHref(
                        area,
                        user.role,
                        user.capabilities,
                        disabledAdminTools,
                      )}
                      active={isAreaActive(area, pathname)}
                      collapsed={collapsed}
                      icon={<Icon className="h-5 w-5" />}
                      label={t[area.labelKey]}
                      badge={area.key === "chats" ? chatUnread : undefined}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </nav>
      </div>

      <div className={cn("shrink-0 px-3 pt-2.5", collapsed && "px-2")}>
        <div
          className={cn(
            "flex gap-1 rounded-[9px] border border-white/10 bg-[#0d121c] p-[3px]",
            collapsed ? "flex-col" : "flex-row",
          )}
        >
          {(["ru", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              title={l === "ru" ? "Русский" : "English"}
              onClick={() => setLang(l)}
              className={cn(
                "rounded-md text-[13px] font-semibold tracking-wide",
                collapsed ? "h-7 w-full" : "h-7 flex-1",
                lang === l
                  ? "bg-[rgba(45,131,206,0.35)] text-[#eef1f6]"
                  : "bg-transparent text-[#8b909c] hover:text-[#eef1f6]",
              )}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("shrink-0 p-3", collapsed && "px-2")}>
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl border p-2.5",
            isProfile
              ? "border-[rgba(91,155,224,0.45)] bg-[rgba(45,131,206,0.12)]"
              : "border-white/10 bg-transparent",
            collapsed && "justify-center p-1.5",
          )}
        >
          <Link
            href="/account/profile"
            onClick={onNavigate}
            className={cn(
              "flex min-w-0 items-center gap-2.5",
              collapsed ? "justify-center" : "flex-1",
            )}
          >
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7fb0f0] to-[#4a7fd6] text-[13px] font-bold text-[#0d1626]">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13.5px] text-[#eef1f6]">
                  {user.fullName || user.email}
                </div>
                <div className="truncate text-[11.5px] text-[#7c8290]">
                  {user.email}
                </div>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              title={t.logout}
              onClick={signOut}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#8b909c] hover:bg-white/10 hover:text-[#eef1f6]"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkspaceShellInner({
  email,
  fullName,
  role,
  capabilities,
  balanceCents,
  children,
}: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const user: WorkspaceUser = {
    email,
    fullName,
    role,
    capabilities,
    balanceCents,
  }
  const { t } = useI18n()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /**
   * Свёрнутость — это не отдельный флаг, а просто узкая ширина.
   * Тогда край панели тянется в обе стороны: утащили влево — свернулась,
   * потянули вправо — раскрылась, отдельная кнопка не нужна.
   */
  const sidebar = useDragSize({
    initial: SIDEBAR_EXPANDED,
    min: SIDEBAR_COLLAPSED,
    max: 420,
    axis: "x",
    storageKey: "ffworks-sidebar-width",
  })

  const collapsed = sidebar.size < SIDEBAR_SNAP
  const sidebarWidth = collapsed
    ? SIDEBAR_COLLAPSED
    : Math.max(SIDEBAR_MIN_EXPANDED, sidebar.size)

  const toggleCollapsed = () =>
    sidebar.setSize(collapsed ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED)

  const title =
    pathname === "/account"
      ? t.dashboard
      : pathname.startsWith("/account/statistics")
        ? t.statsAdvanced
        : pathname.startsWith("/account/projects")
          ? searchParams.get("tab") === "archive"
            ? t.archiveTab
            : t.projects
          : pathname.startsWith("/account/profile")
            ? t.profileTitle
            : pathname.startsWith("/admin")
              ? t.adminPanel
              : SITE_NAME

  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-[hsl(226_31%_7%)] font-[family-name:var(--font-ibm-plex)] text-[#eef1f6]"
      style={{ fontFamily: "var(--font-ibm-plex), system-ui, sans-serif" }}
    >
      {/* Desktop sidebar */}
      <aside
        style={{ width: sidebarWidth }}
        className="relative hidden shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-[hsl(226_28%_9%)] lg:flex"
      >
        <SidebarContent
          user={user}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
        <ResizeGrip
          orientation="vertical"
          side="right"
          label={collapsed ? t.sidebarExpand : t.sidebarCollapse}
          dragging={sidebar.dragging}
          onPointerDown={sidebar.onPointerDown}
          onKeyDown={sidebar.onKeyDown}
        />
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[58px] shrink-0 items-center gap-2.5 border-b border-white/[0.07] bg-[hsl(226_28%_9%)] px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-[rgba(91,155,224,0.4)] bg-gradient-to-br from-[#1f3a63] to-[#16273f] text-[12px] font-bold text-[#7fb0f0]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 text-[16px] font-semibold">{title}</span>
          <Link
            href="/account/profile"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-[#7fb0f0] to-[#4a7fd6] text-[12.5px] font-bold text-[#0d1626]"
          >
            {avatarInitials(fullName, email)}
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/60 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="flex h-full w-[274px] max-w-[82%] flex-col border-r border-white/10 bg-[hsl(226_28%_9%)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end p-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9aa0ac] hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              user={user}
              collapsed={false}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function WorkspaceShell(props: ShellProps) {
  return (
    <I18nProvider>
      <WorkspaceShellInner {...props} />
    </I18nProvider>
  )
}
