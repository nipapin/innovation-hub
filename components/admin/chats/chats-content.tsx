"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { useAdminI18n } from "@/components/admin/admin-dict"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminWorkArea } from "@/components/admin/shared/admin-work-area"
import { createWorkspaceSource } from "@/components/admin/workspaces/workspace-source"
import { ArchiveDialog } from "@/components/account/workspace/archive-dialog"
import { ClipboardPanel } from "@/components/account/workspace/clipboard-panel"
import { WorkspaceContextMenu } from "@/components/account/workspace/context-menu"
import { PreviewDialog } from "@/components/account/workspace/file-preview"
import { ShareDialog } from "@/components/account/workspace/share-dialog"
import { WorkspaceDialogs } from "@/components/account/workspace/workspace-dialogs"
import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/account/workspace/workspace-context"
import { ChatsColumn, type AdminChatDto } from "./chats-column"

/**
 * «Чаты»: слева все переписки сайта, справа — сам проект.
 *
 * Почему проект открывается здесь же, а не ссылкой в «Папки». Неотвеченных
 * чатов обычно несколько, и работа по ним — это перебор: прочитал, ответил,
 * взял следующий. Переход в соседний раздел на каждом шаге превращал бы этот
 * перебор в хождение между вкладками.
 *
 * Правая часть — тот же `AdminWorkArea`, что и в «Папках», вместе с деревом
 * файлов, описанием и настройками. Разница между инструментами только в левой
 * колонке: там выбирают по владельцу, здесь — по пришедшему сообщению.
 */
function ChatsLayout({
  owner,
  ownerHref,
  selectedProjectId,
  onSelect,
  onSelectedChange,
}: {
  owner: string | null
  ownerHref: string | null
  selectedProjectId: string | null
  onSelect: (chat: AdminChatDto) => void
  onSelectedChange: (chat: AdminChatDto | null) => void
}) {
  const t = useAdminI18n()

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="hidden min-h-0 flex-1 lg:flex">
        <ChatsColumn
          selectedProjectId={selectedProjectId}
          onSelect={onSelect}
          onSelectedChange={onSelectedChange}
        />
        <AdminWorkArea owner={owner} ownerHref={ownerHref} />
      </div>

      {/* Как и в «Папках»: две колонки с деревом файлов на телефон не
          помещаются, а урезанный вид админке не нужен. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-[14px] text-ws-4 lg:hidden">
        {t.pipelineNarrowScreen}
      </div>

      <ClipboardPanel />
      <WorkspaceContextMenu />
      <ArchiveDialog />
      <PreviewDialog />
      <ShareDialog />
      <WorkspaceDialogs />
    </div>
  )
}

function ChatsInner({
  selectedProjectId,
}: {
  selectedProjectId: string | null
}) {
  const { setBottomTab } = useWorkspace()
  const router = useRouter()
  const [selectedChat, setSelectedChat] = useState<AdminChatDto | null>(null)

  /**
   * Выбор чата живёт в адресе (`?user=&id=&chat=1`), как и выбор проекта в
   * «Папках»: ссылку на разговор можно переслать, а перезагрузка возвращает на
   * то же место с открытой закладкой переписки.
   */
  const onSelect = useCallback(
    (chat: AdminChatDto) => {
      const params = new URLSearchParams({
        user: chat.ownerId,
        id: chat.projectId,
        chat: "1",
      })
      router.replace(`/admin/chats?${params.toString()}`, { scroll: false })
      // Адрес отвечает за перезагрузку, а этот вызов — за повторный щелчок по
      // уже открытому чату: адрес тогда не меняется, и одной ссылки было бы
      // мало, чтобы вернуть человека из «Описания» обратно в переписку.
      setBottomTab("chat")
    },
    [router, setBottomTab],
  )

  return (
    <ChatsLayout
      owner={selectedChat?.ownerEmail ?? null}
      // Тот же проект, но в «Папках»: оттуда видны остальные проекты владельца.
      ownerHref={
        selectedChat
          ? `/admin/workspaces?user=${encodeURIComponent(selectedChat.ownerId)}` +
            `&id=${encodeURIComponent(selectedChat.projectId)}`
          : null
      }
      selectedProjectId={selectedProjectId}
      onSelect={onSelect}
      onSelectedChange={setSelectedChat}
    />
  )
}

export function ChatsContent() {
  const searchParams = useSearchParams()
  const { can } = useAdminData()
  const canManage = can("projects.manage")

  const selectedUserId = searchParams.get("user")
  const selectedProjectId = searchParams.get("id")

  const source = useMemo(
    () =>
      createWorkspaceSource({
        userId: selectedUserId,
        canManage,
        basePath: "/admin/chats",
        // Владельца здесь не выбирают — заводить проект «непонятно кому» нечем.
        canCreateProject: false,
      }),
    [selectedUserId, canManage],
  )

  return (
    <WorkspaceProvider source={source}>
      <ChatsInner selectedProjectId={selectedProjectId} />
    </WorkspaceProvider>
  )
}
