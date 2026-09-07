"use client"

import { SITE_MONOGRAM, SITE_NAME } from "@/lib/site"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { useDisabledAdminTools } from "@/components/admin/shell/features-context"
import { AdminSidebarLink } from "./admin-sidebar-link"
import { AdminSidebarUser } from "./admin-sidebar-user"
import { toolsInArea, visibleAreas } from "./nav-config"

type Props = {
  email: string
  fullName: string
  onNavigate?: () => void
}

export function AdminSidebar({ email, fullName, onNavigate }: Props) {
  const { t } = useI18n()
  const {
    videos,
    ideas,
    users,
    signOut,
    currentUserRole,
    currentUserCapabilities,
  } = useAdminData()

  // На узком экране группы не сворачиваем: подпись группы + её инструменты
  // читаются одним взглядом, а лишний тап по стрелке на телефоне дороже, чем
  // несколько строк прокрутки.
  const disabled = useDisabledAdminTools()
  const areas = visibleAreas(currentUserRole, currentUserCapabilities, disabled).map(
    (area) => ({
      ...area,
      tools: toolsInArea(
        area.key,
        currentUserRole,
        currentUserCapabilities,
        disabled,
      ),
    }),
  )

  const counts: Record<string, number> = {
    "/admin/content": videos.length + ideas.length,
    "/admin/users": users.length,
  }

  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r border-border/60 bg-[hsl(var(--surface-1))]/85 backdrop-blur-xl lg:w-72">
      <div className="px-5 pt-6">
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={onNavigate}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
            <span className="font-display text-sm font-bold text-primary">
              {SITE_MONOGRAM}
            </span>
          </span>
          <span className="font-display text-sm tracking-[0.08em] text-foreground/90">
            {SITE_NAME}
          </span>
        </Link>
      </div>

      <nav className="scrollbar-elegant flex-1 space-y-1 overflow-y-auto px-3">
        <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
          {t.workspaceSection}
        </p>
        {areas.map((area) => (
          <div key={area.key} className="pb-1">
            <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              {t[area.labelKey]}
            </p>
            {area.tools.map((tool) => (
              <AdminSidebarLink
                key={`${area.key}:${tool.href}`}
                item={tool}
                label={t[tool.labelKey]}
                badge={counts[tool.href]}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <Link
          href="/account"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-white/[0.03] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {t.dashboard}
        </Link>
        <div className="h-px bg-border/60" />
        <AdminSidebarUser
          email={email}
          fullName={fullName}
          onSignOut={signOut}
        />
      </div>
    </aside>
  )
}
