import { notFound, redirect } from "next/navigation"
import { ProjectDetailSection } from "@/components/account/sections/project-detail-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { reconcileProjectPauseFromFolderState } from "@/lib/project-automation"
import {
  loadProjectStorageState,
  withoutServiceRows,
} from "@/lib/project-storage"
import { listProjectMedia } from "@/lib/repositories/projects"
import { resolveProjectAccess } from "@/lib/project-access"
import {
  countUnreadForProjects,
  listProjectChatMessages,
} from "@/lib/repositories/project-chat"
import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"
import { listAllProjectFiles } from "@/lib/repositories/project-files"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AccountProjectDetailPage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  const { id } = await params
  const access = await resolveProjectAccess(id, user.id)
  if (!access) {
    notFound()
  }
  let project = access.project

  void syncProjectChatFromYouGile(project)

  const storagePromise = loadProjectStorageState(
    project.ownerId,
    project.id,
  ).catch((error) => {
    console.error("[project-storage] SSR listing failed", error)
    return null
  })

  const [storage, chatMessages, unreadCounts] = await Promise.all([
    storagePromise,
    listProjectChatMessages(project.id),
    countUnreadForProjects([project.id]),
  ])

  // Источник правды по тумблеру — options/folderState.json на R2, в Postgres
  // лежит запрашиваемое зеркало. Если объект правили в обход setProjectPaused,
  // подтягиваем кэш здесь.
  project = await reconcileProjectPauseFromFolderState({
    project,
    folderState: storage?.folderState ?? null,
  })

  const mediaRows = storage
    ? withoutServiceRows(await listAllProjectFiles(project.id))
        .filter((f) => !f.isFolder)
        .map((f) => ({
          id: f.id,
          fileName: f.name,
          mimeType: f.contentType,
          sizeBytes: f.sizeBytes,
          driveFileId: "",
          createdAt: f.createdAt,
        }))
    : await listProjectMedia(project.id)

  const automationStarted = storage?.optionsFileExists ?? false

  return (
    <ProjectDetailSection
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        driveFolderId: project.driveFolderId,
        isActive: project.isActive,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      }}
      media={mediaRows.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        driveFileId: "driveFileId" in m ? m.driveFileId : "",
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : m.createdAt.toISOString(),
      }))}
      drive={
        storage
          ? {
              files: storage.files,
              folderState: storage.folderState,
              options: storage.options,
              fileTypes: storage.fileTypes,
            }
          : null
      }
      automationStarted={automationStarted}
      permissions={{
        writeFiles: access.permissions.writeFiles,
        writeChat: access.permissions.writeChat,
      }}
      unreadChatCount={unreadCounts[project.id] ?? 0}
      chatMessages={chatMessages.map((m) => ({
        id: m.id,
        senderType: m.senderType,
        senderName: m.senderName,
        body: m.body,
        delivered: m.delivered,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  )
}
