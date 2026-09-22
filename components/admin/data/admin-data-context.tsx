"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { toast } from "sonner"
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog"
import { AdminCapabilitiesDialog } from "@/components/admin/admin-capabilities-dialog"
import { AdminContentDialog } from "@/components/admin/admin-content-dialog"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import {
  AdminUserDialog,
  type UserDraft,
} from "@/components/admin/admin-user-dialog"
import { isSuperAdmin } from "@/lib/admin-roles"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { UserRole } from "@/lib/domain-types"
import type {
  AdminIdea,
  AdminUser,
  AdminVideo,
  ContentDraft,
  ContentItem,
  ContentKind,
} from "@/components/admin/admin-types"

type ConfirmState = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  action: () => Promise<void> | void
}

type DialogState =
  | { open: false }
  | {
      open: true
      mode: "create"
      kind: ContentKind
    }
  | {
      open: true
      mode: "edit"
      item: ContentItem
    }

type UserDialogState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; user: AdminUser }

type AdminDataContextValue = {
  currentUserId: string
  currentUserRole: UserRole
  currentUserCapabilities: AdminCapability[]
  /**
   * Есть ли у текущего админа тег. Дублирует серверный гвард намеренно: сервер
   * решает, кого пустить, а это — показывать ли кнопку. Кнопка, которая
   * гарантированно вернёт 403, хуже отсутствующей.
   */
  can: (capability: AdminCapability) => boolean
  /** Роли и права раздаёт только суперадмин — см. docs/ADMIN_ROLES_PLAN.md §2. */
  canManageRoles: boolean
  videos: AdminVideo[]
  ideas: AdminIdea[]
  users: AdminUser[]
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>

  openCreate: (kind?: ContentKind) => void
  openEdit: (item: ContentItem) => void

  openCreateUser: () => void
  openEditUser: (user: AdminUser) => void
  openCapabilities: (user: AdminUser) => void

  patchVideo: (id: string, payload: Partial<AdminVideo>) => Promise<boolean>
  patchIdea: (id: string, payload: Partial<AdminIdea>) => Promise<boolean>
  reorder: (
    type: "videos" | "ideas",
    id: string,
    direction: "up" | "down",
  ) => Promise<void>
  patchUser: (id: string, payload: Partial<AdminUser>) => Promise<void>

  confirmDeleteVideo: (video: AdminVideo) => void
  confirmDeleteIdea: (idea: AdminIdea) => void
  confirmDeleteUser: (user: AdminUser) => void
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null)

export function useAdminData() {
  const context = useContext(AdminDataContext)
  if (!context) {
    throw new Error("useAdminData must be used inside AdminDataProvider")
  }
  return context
}

type ProviderProps = {
  currentUserId: string
  currentUserRole: UserRole
  currentUserCapabilities: AdminCapability[]
  children: React.ReactNode
}

export function AdminDataProvider({
  currentUserId,
  currentUserRole,
  currentUserCapabilities,
  children,
}: ProviderProps) {
  const canManageRoles = isSuperAdmin(currentUserRole)
  const can = useCallback(
    (capability: AdminCapability) =>
      hasCapability(currentUserRole, currentUserCapabilities, capability),
    [currentUserRole, currentUserCapabilities],
  )
  const t = useAdminI18n()
  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [ideas, setIdeas] = useState<AdminIdea[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)

  const [dialog, setDialog] = useState<DialogState>({ open: false })
  const [userDialog, setUserDialog] = useState<UserDialogState>({
    open: false,
  })
  const [capsDialog, setCapsDialog] = useState<{
    open: boolean
    user?: AdminUser
  }>({ open: false })
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: "",
    action: () => {},
  })

  /**
   * Раздел, на который у человека нет тега, отвечает 403 — и это не сбой
   * загрузки, а нормальное состояние: такой части админки у него просто нет.
   * Поэтому запросы независимы, 403 даёт пустой список молча, а ошибку
   * показываем только тогда, когда доступ есть, а данные не пришли. Иначе
   * админ по акциям встречал бы на входе три красных тоста подряд.
   */
  const refresh = useCallback(async () => {
    const load = async <T,>(
      url: string,
      fallback: T,
    ): Promise<{ data: T; failed: boolean }> => {
      try {
        const response = await fetch(url, { cache: "no-store" })
        if (response.status === 403) return { data: fallback, failed: false }
        if (!response.ok) return { data: fallback, failed: true }
        return { data: (await response.json()) as T, failed: false }
      } catch {
        return { data: fallback, failed: true }
      }
    }

    const [videosResult, ideasResult, usersResult] = await Promise.all([
      load<AdminVideo[]>("/api/admin/videos", []),
      load<AdminIdea[]>("/api/admin/ideas", []),
      load<AdminUser[]>("/api/admin/users", []),
    ])

    setVideos(videosResult.data)
    setIdeas(ideasResult.data)
    setUsers(usersResult.data)

    if (videosResult.failed || ideasResult.failed || usersResult.failed) {
      toast.error(t.loadAdminError)
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submitContent = useCallback(
    async (draft: ContentDraft, item?: ContentItem) => {
      const isEdit = Boolean(item)
      const targetBase =
        draft.kind === "video" ? "/api/admin/videos" : "/api/admin/ideas"

      const fields = {
        title: draft.title,
        description: draft.description,
        thumbnail: draft.thumbnail,
        videoUrl: draft.videoUrl,
        duration: draft.duration,
        tags: draft.tags,
      }

      // Type conversion: kind changed during edit → create record in the new
      // table preserving fields + isPublished, then delete the original. We do
      // this client-side because /api/admin/{videos,ideas} are separate
      // resources backed by separate tables.
      if (isEdit && item && item.kind !== draft.kind) {
        const sourceBase =
          item.kind === "video" ? "/api/admin/videos" : "/api/admin/ideas"

        const createRes = await fetch(targetBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            isPublished: item.data.isPublished,
          }),
        })
        if (!createRes.ok) {
          toast.error(t.switchTypeError)
          return false
        }

        const deleteRes = await fetch(`${sourceBase}/${item.data.id}`, {
          method: "DELETE",
        })
        if (!deleteRes.ok) {
          toast.error(t.convertPartialError)
          await refresh()
          return true
        }

        toast.success(
          draft.kind === "video" ? t.convertedToVideo : t.convertedToIdea,
        )
        await refresh()
        return true
      }

      const payload: Record<string, unknown> = { ...fields }
      if (!isEdit) payload.isPublished = true

      const response = await fetch(
        isEdit ? `${targetBase}/${item!.data.id}` : targetBase,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        toast.error(
          isEdit
            ? t.saveError
            : tf(t.addError, {
                kind: draft.kind === "video" ? t.kindVideo : t.kindIdea,
              }),
        )
        return false
      }

      toast.success(
        isEdit
          ? draft.kind === "video"
            ? t.videoUpdated
            : t.ideaUpdated
          : draft.kind === "video"
            ? t.videoAdded
            : t.ideaAdded,
      )
      await refresh()
      return true
    },
    [refresh, t],
  )

  const patchVideo = useCallback(
    async (id: string, payload: Partial<AdminVideo>) => {
      const response = await fetch(`/api/admin/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error(t.videoUpdateError)
        return false
      }
      await refresh()
      return true
    },
    [refresh, t],
  )

  const patchIdea = useCallback(
    async (id: string, payload: Partial<AdminIdea>) => {
      const response = await fetch(`/api/admin/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error(t.ideaUpdateError)
        return false
      }
      await refresh()
      return true
    },
    [refresh, t],
  )

  const reorder = useCallback(
    async (type: "videos" | "ideas", id: string, direction: "up" | "down") => {
      const response = await fetch(`/api/admin/${type}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, direction }),
      })
      if (!response.ok) {
        toast.error(t.reorderError)
        return
      }
      await refresh()
    },
    [refresh, t],
  )

  const deleteEntity = useCallback(
    async (type: "videos" | "ideas", id: string) => {
      const response = await fetch(`/api/admin/${type}/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        toast.error(t.deleteError)
        return
      }
      toast.success(type === "videos" ? t.videoDeleted : t.ideaDeleted)
      await refresh()
    },
    [refresh, t],
  )

  const submitUser = useCallback(
    async (draft: UserDraft, user?: AdminUser) => {
      const isEdit = Boolean(user)

      const payload: Record<string, unknown> = {
        fullName: draft.fullName.trim(),
        email: draft.email.trim().toLowerCase(),
        role: draft.role,
        isActive: draft.isActive,
      }
      // Компания уходит только при заведении: смена компании у существующего —
      // это перевод со своими проверками, и он живёт в разделе «Компании».
      if (!isEdit && draft.companyId) {
        payload.companyId = draft.companyId
        payload.companyRole = draft.companyRole
      }
      if (draft.password.length > 0) {
        payload.password = draft.password
      } else if (!isEdit) {
        toast.error(t.passwordRequired)
        return false
      }

      const response = await fetch(
        isEdit ? `/api/admin/users/${user!.id}` : "/api/admin/users",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        let message = isEdit
          ? t.userSaveError
          : t.userCreateError
        try {
          const data = await response.json()
          if (data?.message) message = data.message
        } catch {}
        toast.error(message)
        return false
      }

      toast.success(isEdit ? t.userUpdated : t.userCreated)
      await refresh()
      return true
    },
    [refresh, t],
  )

  const patchUser = useCallback(
    async (id: string, payload: Partial<AdminUser>) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error(t.userUpdateError)
        return
      }
      await refresh()
    },
    [refresh, t],
  )

  const deleteUser = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        toast.error(t.userDeleteError)
        return
      }
      toast.success(t.userDeleted)
      await refresh()
    },
    [refresh, t],
  )

  const askConfirm = useCallback((state: Omit<ConfirmState, "open">) => {
    setConfirm({ ...state, open: true })
  }, [])

  const closeConfirm = useCallback((open: boolean) => {
    setConfirm((prev) => ({ ...prev, open }))
  }, [])

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    // Hard redirect so all client-side session state and the router cache
    // are fully dropped after sign-out.
    window.location.assign("/login")
  }, [])

  const value = useMemo<AdminDataContextValue>(
    () => ({
      currentUserId,
      currentUserRole,
      currentUserCapabilities,
      can,
      canManageRoles,
      videos,
      ideas,
      users,
      loading,
      refresh,
      signOut,
      openCreate: (kind = "video") =>
        setDialog({ open: true, mode: "create", kind }),
      openEdit: (item) => setDialog({ open: true, mode: "edit", item }),
      openCreateUser: () => setUserDialog({ open: true, mode: "create" }),
      openEditUser: (user) =>
        setUserDialog({ open: true, mode: "edit", user }),
      openCapabilities: (user) => setCapsDialog({ open: true, user }),
      patchVideo,
      patchIdea,
      reorder,
      patchUser,
      confirmDeleteVideo: (video) =>
        askConfirm({
          title: t.deleteVideoTitle,
          description: tf(t.deleteVideoDesc, { title: video.title }),
          confirmLabel: t.deleteVideoConfirm,
          destructive: true,
          action: () => deleteEntity("videos", video.id),
        }),
      confirmDeleteIdea: (idea) =>
        askConfirm({
          title: t.deleteIdeaTitle,
          description: tf(t.deleteIdeaDesc, { title: idea.title }),
          confirmLabel: t.deleteIdeaConfirm,
          destructive: true,
          action: () => deleteEntity("ideas", idea.id),
        }),
      confirmDeleteUser: (user) =>
        askConfirm({
          title: t.deleteUserTitle,
          description: tf(t.deleteUserDesc, {
            name: user.fullName || user.email,
          }),
          confirmLabel: t.deleteUserConfirm,
          destructive: true,
          action: () => deleteUser(user.id),
        }),
    }),
    [
      currentUserId,
      currentUserRole,
      currentUserCapabilities,
      can,
      canManageRoles,
      videos,
      ideas,
      users,
      loading,
      refresh,
      signOut,
      patchVideo,
      patchIdea,
      reorder,
      patchUser,
      askConfirm,
      deleteEntity,
      deleteUser,
      t,
    ],
  )

  const dialogProps = (() => {
    if (!dialog.open) {
      return {
        open: false,
        mode: "create" as const,
        initialKind: "video" as ContentKind,
        initialItem: undefined,
      }
    }
    if (dialog.mode === "create") {
      return {
        open: true,
        mode: "create" as const,
        initialKind: dialog.kind,
        initialItem: undefined,
      }
    }
    return {
      open: true,
      mode: "edit" as const,
      initialKind: dialog.item.kind,
      initialItem: dialog.item,
    }
  })()

  return (
    <AdminDataContext.Provider value={value}>
      {children}

      <AdminContentDialog
        open={dialogProps.open}
        mode={dialogProps.mode}
        initialKind={dialogProps.initialKind}
        initialItem={dialogProps.initialItem}
        onOpenChange={(open) => {
          if (!open) setDialog({ open: false })
        }}
        onSubmit={submitContent}
      />

      <AdminUserDialog
        open={userDialog.open}
        mode={userDialog.open ? userDialog.mode : "create"}
        initialUser={
          userDialog.open && userDialog.mode === "edit"
            ? userDialog.user
            : undefined
        }
        isSelf={
          userDialog.open && userDialog.mode === "edit"
            ? userDialog.user.id === currentUserId
            : false
        }
        canManageRoles={canManageRoles}
        onOpenChange={(open) => {
          if (!open) setUserDialog({ open: false })
        }}
        onSubmit={submitUser}
      />

      <AdminCapabilitiesDialog
        open={capsDialog.open}
        user={capsDialog.user}
        onOpenChange={(open) => {
          if (!open) setCapsDialog({ open: false })
        }}
        onSaved={() => void refresh()}
      />

      <AdminConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        destructive={confirm.destructive}
        onConfirm={async () => {
          await confirm.action()
          closeConfirm(false)
        }}
        onOpenChange={closeConfirm}
      />
    </AdminDataContext.Provider>
  )
}
