"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ShieldCheck, Users } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import type { AdminUser } from "@/components/admin/admin-types"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import { isElevated } from "@/lib/admin-roles"
import type { UserRole } from "@/lib/domain-types"
import { cn } from "@/lib/utils"

type Dict = ReturnType<typeof useAdminI18n>

const LABEL_KEY: Record<AdminCapability, keyof Dict> = {
  "users.read": "capUsersRead",
  "users.manage": "capUsersManage",
  "content.manage": "capContentManage",
  "pipeline.operate": "capPipelineOperate",
  "posting.operate": "capPostingOperate",
  "settings.write": "capSettingsWrite",
  "machines.manage": "capMachinesManage",
  "projects.access": "capProjectsAccess",
  "projects.manage": "capProjectsManage",
  "statistics.view": "capStatisticsView",
  "statistics.import": "capStatisticsImport",
  "visitors.view": "capVisitorsView",
  "billing.manage": "capBillingManage",
  "billing.trial": "capBillingTrial",
  "billing.promo": "capBillingPromo",
  "services.manage": "capServicesManage",
  "audit.view": "capAuditView",
  "features.manage": "capFeaturesManage",
}

function RoleBadge({ role, t }: { role: UserRole; t: Dict }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
        role === "SUPERADMIN"
          ? "bg-amber-500/15 text-amber-300"
          : "bg-primary/15 text-primary",
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      {role === "SUPERADMIN" ? t.superadmin : t.admin}
    </span>
  )
}

export function RolesContent() {
  const { t: page } = useI18n()
  const t = useAdminI18n()
  const {
    users,
    loading,
    currentUserId,
    canManageRoles,
    openCapabilities,
    patchUser,
  } = useAdminData()

  // Страница про админов, поэтому обычные пользователи в неё не попадают: их
  // теги ничего не открывают, и строка о них была бы шумом. Суперадмины выше —
  // на них смотрят в первую очередь.
  const admins = useMemo(
    () =>
      users
        .filter((user) => isElevated(user.role))
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === "SUPERADMIN" ? -1 : 1
          return a.fullName.localeCompare(b.fullName)
        }),
    [users],
  )

  const renderTags = (user: AdminUser) => {
    if (user.role === "SUPERADMIN") {
      return (
        <span className="text-[12px] text-amber-300/90">
          {t.rolesAllSections}
        </span>
      )
    }
    if (user.capabilities.length === 0) {
      return (
        <span className="text-[12px] text-muted-foreground">{t.rolesNoTags}</span>
      )
    }
    return (
      <span className="flex flex-wrap gap-1">
        {ADMIN_CAPABILITIES.filter((capability) =>
          user.capabilities.includes(capability),
        ).map((capability) => (
          <span
            key={capability}
            className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {t[LABEL_KEY[capability]] as string}
          </span>
        ))}
      </span>
    )
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={page.adminGroupAccess}
        title={page.adminRoles}
        description={page.adminRolesDesc}
        actions={
          <Button asChild variant="outline" className="gap-2 rounded-full">
            <Link href="/admin/users">
              <Users className="h-4 w-4" />
              {page.adminPeople}
            </Link>
          </Button>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : admins.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title={t.rolesEmpty}
          description={t.rolesEmptyDesc}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {admins.map((user) => {
              const isSelf = user.id === currentUserId
              return (
                <li
                  key={user.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-3 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {user.fullName}
                      </span>
                      <RoleBadge role={user.role} t={t} />
                      {isSelf ? (
                        <span className="text-[11px] text-muted-foreground">
                          {t.rolesSelfNote}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                    <div className="mt-1.5">{renderTags(user)}</div>
                  </div>

                  {canManageRoles ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Select
                        value={user.role}
                        disabled={isSelf}
                        onValueChange={(value) =>
                          void patchUser(user.id, { role: value as UserRole })
                        }
                      >
                        <SelectTrigger
                          aria-label={t.rolesRoleLabel}
                          className="h-9 w-[150px] rounded-xl border-border/70 bg-card/40 text-sm"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USER">{t.member}</SelectItem>
                          <SelectItem value="ADMIN">{t.admin}</SelectItem>
                          <SelectItem value="SUPERADMIN">
                            {t.superadmin}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={user.role !== "ADMIN"}
                        onClick={() => openCapabilities(user)}
                      >
                        {t.rolesEditAccess}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <p className="text-[12px] text-muted-foreground">
            {canManageRoles ? t.rolesPromoteHint : t.rolesTitleHint}
          </p>
        </>
      )}
    </div>
  )
}
