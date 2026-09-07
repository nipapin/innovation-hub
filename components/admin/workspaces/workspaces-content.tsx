"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { useAdminI18n } from "@/components/admin/admin-dict"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminWorkArea } from "@/components/admin/shared/admin-work-area"
import { ArchiveDialog } from "@/components/account/workspace/archive-dialog"
import { ClipboardPanel } from "@/components/account/workspace/clipboard-panel"
import { WorkspaceContextMenu } from "@/components/account/workspace/context-menu"
import { PreviewDialog } from "@/components/account/workspace/file-preview"
import { ProjectsColumn } from "@/components/account/workspace/projects-column"
import { ShareDialog } from "@/components/account/workspace/share-dialog"
import { WorkspaceDialogs } from "@/components/account/workspace/workspace-dialogs"
import { WorkspaceProvider } from "@/components/account/workspace/workspace-context"
import { createWorkspaceSource } from "./workspace-source"
import { TransferDialog } from "./transfer-dialog"
import { UsersColumn, type PipelineUserDto } from "./users-column"

/**
 * «Папки пользователей»: три колонки — люди, их проекты, файлы — и нижняя
 * панель с описанием, настройками и чатом.
 *
 * Колонки 2 и 3 — те же компоненты, что в кабинете пользователя; отличается
 * только источник данных (createWorkspaceSource). Своя раскладка, а не
 * WorkspacePageClient, потому что здесь не нужна мобильная навигация по табам:
 * чужими папками распоряжаются с рабочего места.
 *
 * А вот переключатель «Полный / Упрощённый» здесь тот же, что у клиента, и
 * стоит он в `AdminWorkArea` рядом с «Чатами». Упрощённый вид показывает проект
 * так, как его видит владелец, — IN, OUT и ничего лишнего; это ответ на вопрос
 * «что человек вообще видит у себя», который иначе приходится держать в голове.
 * Колонки при этом остаются в обоих видах: они не часть проекта, а навигация
 * администратора по чужим.
 *
 * Полосы запуска здесь нет намеренно: пуск и остановка — состояние всей
 * установки, и живут они в «Конвейере» (docs/ADMIN_WORKSPACE_PLAN.md §2).
 */
function WorkspacesLayout({
  users,
  loadingUsers,
  selectedUserId,
  ownerEmail,
  onSelectUser,
  onToggleUser,
  onTransferred,
}: {
  users: PipelineUserDto[]
  loadingUsers: boolean
  selectedUserId: string | null
  ownerEmail: string | null
  onSelectUser: (userId: string) => void
  onToggleUser: (userId: string, enabled: boolean) => void
  onTransferred: () => void
}) {
  const t = useAdminI18n()

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="hidden min-h-0 flex-1 lg:flex">
        <UsersColumn
          users={users}
          loading={loadingUsers}
          selectedUserId={selectedUserId}
          onSelectUser={onSelectUser}
          onToggle={onToggleUser}
        />
        <ProjectsColumn />
        <AdminWorkArea owner={ownerEmail} />
      </div>

      {/* Три колонки на телефоне не помещаются, а урезанный вид админке не
          нужен: чужими папками распоряжаются с рабочего места. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-[14px] text-ws-4 lg:hidden">
        {t.pipelineNarrowScreen}
      </div>

      <ClipboardPanel />
      <WorkspaceContextMenu />
      <ArchiveDialog />
      <PreviewDialog />
      <ShareDialog />
      <TransferDialog
        users={users}
        currentOwnerId={selectedUserId}
        onDone={onTransferred}
      />
      <WorkspaceDialogs />
    </div>
  )
}

export function WorkspacesContent() {
  const t = useAdminI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  const { can } = useAdminData()
  // Ступень 2. Страница открыта по `projects.access`, поэтому сюда попадают и те,
  // кому распоряжаться проектами не доверено: им кнопок не показываем.
  const canManage = can("projects.manage")

  const [users, setUsers] = useState<PipelineUserDto[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch("/api/admin/workspaces/users")
      if (!res.ok) {
        toast.error(t.pipelineUsersLoadError)
        return
      }
      const data = await res.json()
      setUsers(data.users ?? [])
    } finally {
      setLoadingUsers(false)
    }
  }, [t])

  /**
   * Выбранный пользователь живёт в URL, как и раздел проектов в кабинете:
   * ссылка на конкретного пользователя переживает перезагрузку и её можно
   * переслать.
   */
  const selectedUserId = searchParams.get("user")

  useEffect(() => {
    void loadUsers()
    // Один раз на открытие: список людей меняется редко, а перечитать его
    // просят явно — после передачи проекта (onTransferred).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSelectUser = useCallback(
    (userId: string) => {
      // Меняя пользователя, сбрасываем выбранный проект: он принадлежал другому.
      const params = new URLSearchParams()
      params.set("user", userId)
      router.replace(`/admin/workspaces?${params.toString()}`, { scroll: false })
    },
    [router],
  )

  const onToggleUser = useCallback((userId: string, enabled: boolean) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, automationEnabled: enabled } : u,
      ),
    )
  }, [])

  const source = useMemo(
    () => createWorkspaceSource({ userId: selectedUserId, canManage }),
    [selectedUserId, canManage],
  )

  const ownerEmail =
    users.find((user) => user.id === selectedUserId)?.email ?? null

  return (
    <WorkspaceProvider source={source}>
      <WorkspacesLayout
        users={users}
        loadingUsers={loadingUsers}
        selectedUserId={selectedUserId}
        ownerEmail={ownerEmail}
        onSelectUser={onSelectUser}
        onToggleUser={onToggleUser}
        onTransferred={() => void loadUsers()}
      />
    </WorkspaceProvider>
  )
}
