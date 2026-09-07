"use client"
import { cn } from "@/lib/utils"
import { isElevated } from "@/lib/admin-roles"

import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { UserHistory } from "@/components/admin/shared/user-history"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AdminUser } from "./admin-types"

type Props = {
  user: AdminUser
  isCurrent: boolean
  /** Актор — суперадмин: только он раздаёт роли и трогает других админов. */
  canManageRoles: boolean
  /** Тег users.manage: без него раздел доступен только на чтение. */
  canManageUsers: boolean
  onEdit: () => void
  onOpenCapabilities: () => void
  onToggleRole: () => void
  onToggleActive: () => void
  onDelete: () => void
}

function avatarLetter(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const match = trimmed.match(/\p{L}/u)
  return (match ? match[0] : trimmed[0]).toLocaleUpperCase()
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

export function AdminUserRow({
  user,
  isCurrent,
  canManageRoles,
  canManageUsers,
  onEdit,
  onOpenCapabilities,
  onToggleRole,
  onToggleActive,
  onDelete,
}: Props) {
  const t = useAdminI18n()

  // Админ управляет только теми, кто ниже него. Себя — можно: правка своего
  // имени и пароля к управлению чужими аккаунтами не относится. Сервер отвечает
  // тем же (app/api/admin/users/[id]), здесь мы лишь не показываем кнопку,
  // которая всё равно вернёт 403.
  const canManage =
    (canManageUsers || isCurrent) &&
    (canManageRoles || isCurrent || !isElevated(user.role))

  return (
    // Карточка открывается двойным щелчком, а не одиночным: по строке чаще
    // всего кликают, чтобы выделить и скопировать почту, и всплывающий на
    // каждый клик диалог этому мешает. Одиночный вход остался там, где его
    // ищут осознанно, — Enter с клавиатуры и «Редактировать профиль» в меню.
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("[data-no-edit]")) return
        // Двойной щелчок успевает выделить слово под курсором — снимаем
        // выделение, иначе оно останется висеть под открытым диалогом.
        window.getSelection()?.removeAllRanges()
        onEdit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onEdit()
        }
      }}
      title={t.openCardHint}
      className="flex select-text items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/70"
    >
      <Avatar className="h-10 w-10 border border-border/60">
        <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
          {avatarLetter(user.fullName || user.email)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">
            {user.fullName || user.email}
          </p>
          {isCurrent ? (
            <Badge variant="outline" className="text-[10px]">
              {t.you}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        {isElevated(user.role) ? (
          <Badge
            className={cn(
              "gap-1 border-transparent",
              user.role === "SUPERADMIN"
                ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15"
                : "bg-primary/15 text-primary hover:bg-primary/15",
            )}
          >
            <ShieldCheck className="h-3 w-3" />
            {user.role === "SUPERADMIN" ? t.superadmin : t.admin}
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            {t.member}
          </Badge>
        )}
        {user.isActive ? (
          <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
            {t.active}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            {t.suspended}
          </Badge>
        )}
        {/* Кто и когда это сделал. Значок стоит рядом с состоянием, а не в меню:
            вопрос «почему он заблокирован» задают, глядя именно на этот бейдж. */}
        <UserHistory userId={user.id} userLabel={user.email} />
      </div>

      <p className="hidden text-xs text-muted-foreground md:block">
        {t.joinedPrefix}
        {formatDate(user.createdAt)}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-no-edit
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t.actions}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onEdit} disabled={!canManage}>
            <Pencil className="h-4 w-4" />
            {t.editProfile}
          </DropdownMenuItem>
          {canManageRoles && user.role === "ADMIN" ? (
            <DropdownMenuItem onClick={onOpenCapabilities}>
              <KeyRound className="h-4 w-4" />
              {t.capsMenuItem}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onToggleRole}
            disabled={isCurrent || !canManageRoles}
          >
            {isElevated(user.role) ? (
              <>
                <ShieldOff className="h-4 w-4" />
                {user.role === "SUPERADMIN" ? t.demoteToAdmin : t.removeAdmin}
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                {t.makeAdmin}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onToggleActive}
            disabled={isCurrent || !canManage}
          >
            {user.isActive ? (
              <>
                <UserX className="h-4 w-4" />
                {t.suspend}
              </>
            ) : (
              <>
                <UserCheck className="h-4 w-4" />
                {t.reactivate}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={isCurrent || !canManage}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t.deleteAccount}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
