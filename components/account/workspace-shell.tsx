"use client"
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
  Trash2,
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
import type { CompanyRole, UserRole } from "@/lib/domain-types"
import type { CompanyCapability } from "@/lib/company-capabilities"
import {
  companyAreaHref,
  isCompanyAreaActive,
  visibleCompanyAreas,
} from "@/components/company/nav-config"
import { BalanceWidget } from "@/components/account/balance-widget"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useBranding } from "@/components/branding/branding-context"
import { ThemeSwitch } from "@/components/account/theme-switch"
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
  labelKey: "projects" | "toolsTab" | "archiveTab" | "trashTab"
  icon: LucideIcon
}[] = [
  // Расшаренные своего пункта не имеют: они группой внутри «Проектов».
  { tab: "projects", labelKey: "projects", icon: FolderOpen },
  { tab: "tools", labelKey: "toolsTab", icon: Wrench },
  { tab: "archive", labelKey: "archiveTab", icon: Archive },
  { tab: "trash", labelKey: "trashTab", icon: Trash2 },
]

/**
 * Всё, что меню знает о компании этого человека.
 *
 * Три строки-оси, а не готовый список пунктов: список несёт иконки, а их через
 * границу сервер→клиент не передать. Считает его `visibleCompanyAreas` здесь же
 * — ровно как админский блок ниже считает свои области по роли и тегам.
 *
 * `null` — консоли у него нет вовсе. Ответ приходит от гейта
 * (lib/company-auth.ts), а не собирается в меню: «видит ли он консоль» — вопрос
 * со сложным ответом (участник, компания на паузе, суперадмин без своей
 * компании), и второй его источник однажды разошёлся бы с первым.
 */
export type CompanyNav = {
  role: CompanyRole
  capabilities: CompanyCapability[]
  /** Набор разделов, проданный компании. `null` — все. */
  sections: string[] | null
}

/**
 * Блок консоли компании в боковом меню.
 *
 * Отдельным компонентом, потому что областей теперь несколько и их надо
 * посчитать: внутри JSX для этого негде завести имя, а звать
 * `visibleCompanyAreas` дважды — в условии и в `map` — значило бы считать одно и
 * то же по два раза и однажды разойтись между строкой условия и строкой списка.
 */
function CompanyConsoleNav({
  nav,
  collapsed,
  pathname,
  onNavigate,
}: {
  nav: CompanyNav
  collapsed: boolean
  pathname: string
  onNavigate?: () => void
}) {
  const { t } = useI18n()
  const areas = visibleCompanyAreas(nav.role, nav.capabilities, nav.sections)
  if (areas.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn("mb-1 h-px bg-foreground/10", collapsed ? "mx-1" : "mx-2.5")}
      />
      {!collapsed ? (
        <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          {t.coConsolePanel}
        </p>
      ) : null}
      {areas.map((area) => {
        const Icon = area.icon
        return (
          <div key={area.key} onClick={onNavigate}>
            <NavItem
              href={companyAreaHref(area, nav.role, nav.capabilities, nav.sections)}
              active={isCompanyAreaActive(area, pathname)}
              collapsed={collapsed}
              icon={<Icon className="h-5 w-5" />}
              label={t[area.labelKey]}
            />
          </div>
        )
      })}
    </div>
  )
}

export type WorkspaceUser = {
  email: string
  fullName: string
  role: UserRole
  /** Теги админа: по ним фильтруется свёртка «Админка» в боковом меню. */
  capabilities: AdminCapability[]
  balanceCents: number
  /** Консоль компании: чем её наполнять и наполнять ли вовсе. См. `CompanyNav`. */
  companyNav?: CompanyNav | null
  /**
   * Суперадмин зашёл в ЧУЖУЮ компанию через переключатель.
   *
   * Тогда рабочее место в меню не показывается: дашборд, папки, архив и ключи
   * — это ЕГО собственные вещи, к компании, которую он сейчас настраивает, они
   * отношения не имеют, и висят рядом с её консолью как чужие. Сотруднику
   * компании, наоборот, показываются: у него своя компания и свои проекты в ней
   * — одно рабочее место, а не два.
   *
   * Признак приходит с сервера готовым (сравнение компании из области с
   * компанией самого человека в app/company/layout.tsx), а не считается здесь:
   * то же сравнение уже решает, красить ли оболочку в цвета клиента.
   */
  companyGuest?: boolean
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
          ? "bg-primary/15 text-foreground"
          : "text-secondary-foreground hover:bg-foreground/5 hover:text-foreground",
        dimmed && "opacity-45",
      )}
    >
      {active && (
        <span className="absolute bottom-[9px] left-0 top-[9px] w-[3px] rounded-[3px] bg-primary" />
      )}
      <span
        className={cn(
          "relative",
          active ? "text-primary" : "text-muted-foreground/90",
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
            <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground/80">
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
  const branding = useBranding()
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
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/10 text-[12px] font-bold tracking-wide text-primary/90"
        >
          {/* Монограмма, а не литерал «FF»: у компании она своя. Логотип, если
              задан, вытесняет буквы целиком. */}
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.name}
              className="h-full w-full object-contain"
            />
          ) : (
            branding.monogram
          )}
        </button>
        {collapsed ? (
          onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              title={t.sidebarExpand}
              aria-label={t.sidebarExpand}
              className="flex h-[22px] w-[34px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null
        ) : (
          <>
            <span className="flex-1 whitespace-nowrap text-[16px] font-semibold text-foreground">
              {branding.name}
            </span>
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                title={t.sidebarCollapse}
                aria-label={t.sidebarCollapse}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
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
              "rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-primary/[0.03]",
              collapsed ? "p-2.5" : "p-3.5",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2",
                collapsed && "justify-center",
              )}
            >
              <Wallet className="h-[19px] w-[19px] text-primary/90" />
              {!collapsed && (
                <span className="flex-1 text-[10.5px] font-semibold tracking-[1.4px] text-primary/90">
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
                      className="shrink-0 rounded-lg bg-foreground/10 px-2.5 py-1 text-[12px] text-foreground hover:bg-foreground/[0.18]"
                    >
                      {t.topup}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>

        {/* Рабочее место прячется у гостя целиком — см. WorkspaceUser.companyGuest.
            Не гасится и не сворачивается: это не «пока недоступно», это чужие
            папки на экране настройки клиента. */}
        <nav
          className={cn(
            "flex shrink-0 flex-col gap-1 px-3 py-2",
            user.companyGuest && "hidden",
          )}
        >
          {!collapsed && (
            <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold tracking-[1.4px] text-muted-foreground/60">
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
          {/* Личных ключей в рабочем месте больше нет: внешние сервисы в
              компании общие, и подключают их в «Доступах» консоли — одно место
              на всю компанию. Пункт, ведущий в собственные ключи, обещал бы
              вторую, личную связку, которой у сотрудника компании не бывает.
              Сама страница /account/vendor-keys пока жива: на неё ссылаются
              настройки проекта. */}
        </nav>

        <div className="flex-1" />

        <nav className="flex shrink-0 flex-col gap-1 px-3 pb-2">
          {/* Консоль компании — над админкой и отдельно от неё: это разные оси
              прав (COMPANY_ACCOUNTS_PLAN.md §4). Сотрудник компании обычно
              обычный пользователь на сайте, и админского блока ниже у него нет
              вовсе; суперадмин увидит оба.

              Отбивка и подпись такие же, как у админского блока ниже, и по той
              же причине: это распоряжение, а не работа, и от рабочего места оно
              должно быть отделено видимой чертой. Раньше подпись была только у
              админки, и у сотрудника компании его консоль висела просто
              последним пунктом рабочего места — то есть выглядела его частью. */}
          {user.companyNav ? (
            <CompanyConsoleNav
              nav={user.companyNav}
              collapsed={collapsed}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ) : null}
          {isElevated(user.role) && (
            <div className="flex flex-col gap-0.5">
              {/* Отбивка: админская зона отделена от рабочего места.
                  Свёртки здесь нет намеренно — разделы админки лежат так же
                  плоско, как разделы кабинета выше, а что внутри раздела,
                  показывает вторая колонка. Свёртка добавляла клик перед каждым
                  переходом и прятала половину админки от глаз. */}
              <div
                className={cn(
                  "mb-1 h-px bg-foreground/10",
                  collapsed ? "mx-1" : "mx-2.5",
                )}
              />
              {!collapsed ? (
                <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
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

      {/* Тема — рядом с языком: оба про то, как человек смотрит на сайт, а не
          про его работу. Искать их будут в одном месте. */}
      <div className={cn("shrink-0 px-3 pt-2.5", collapsed && "px-2")}>
        <ThemeSwitch collapsed={collapsed} />
      </div>

      <div className={cn("shrink-0 px-3 pt-2.5", collapsed && "px-2")}>
        <div
          className={cn(
            "flex gap-1 rounded-[9px] border border-foreground/10 bg-surface-1 p-[3px]",
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
                  ? "bg-primary/30 text-foreground"
                  : "bg-transparent text-muted-foreground/90 hover:text-foreground",
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
              ? "border-primary/40 bg-primary/10"
              : "border-foreground/10 bg-transparent",
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
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/90 to-primary text-[13px] font-bold text-primary-foreground">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13.5px] text-foreground">
                  {user.fullName || user.email}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground/80">
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground/90 hover:bg-foreground/10 hover:text-foreground"
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
  companyNav,
  companyGuest,
  children,
}: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const user: WorkspaceUser = {
    email,
    fullName,
    role,
    capabilities,
    balanceCents,
    companyNav,
    companyGuest,
  }
  const { t } = useI18n()
  const branding = useBranding()
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
              : branding.name

  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-background font-[family-name:var(--font-ibm-plex)] text-foreground"
      style={{ fontFamily: "var(--font-ibm-plex), system-ui, sans-serif" }}
    >
      {/* Desktop sidebar */}
      <aside
        style={{ width: sidebarWidth }}
        className="relative hidden shrink-0 flex-col overflow-hidden border-r border-foreground/[0.08] bg-sidebar lg:flex"
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
        <div className="flex h-[58px] shrink-0 items-center gap-2.5 border-b border-foreground/[0.07] bg-sidebar px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/10 text-[12px] font-bold text-primary/90"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 text-[16px] font-semibold">{title}</span>
          <Link
            href="/account/profile"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-primary/90 to-primary text-[12.5px] font-bold text-primary-foreground"
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
            className="flex h-full w-[274px] max-w-[82%] flex-col border-r border-foreground/10 bg-sidebar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end p-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5"
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
