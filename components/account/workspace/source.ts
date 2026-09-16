import type { WorkspaceSource } from "./types"

/**
 * Источник данных кабинета — поведение по умолчанию.
 *
 * Ровно те адреса, по которым рабочая область ходила до появления
 * WorkspaceSource, поэтому подключение источника ничего не меняет для
 * /account/projects. Админский источник живёт в
 * components/admin/pipeline/pipeline-source.ts.
 */
export const CABINET_SOURCE: WorkspaceSource = {
  // Область одна — проекты владельца сессии, поэтому ключ постоянный.
  scopeKey: "cabinet",
  splitByTab: true,
  pageUrl: ({ id, tab }) => {
    const params = new URLSearchParams()
    if (id) params.set("id", id)
    if (tab !== "projects") params.set("tab", tab)
    const qs = params.toString()
    return qs ? `/account/projects?${qs}` : "/account/projects"
  },
  projectsUrl: () => "/api/projects?archived=all",
  driveUrl: (projectId) => `/api/projects/${projectId}/drive`,
  treeCursorUrl: (projectId) =>
    `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}`,
  projectUrl: (projectId) => `/api/projects/${projectId}`,
  folderUrl: (projectId) => `/api/projects/${projectId}/drive`,
  fileUrl: (projectId, fileId) =>
    `/api/projects/${projectId}/drive/files/${fileId}`,
  uploadUrl: (projectId, params) =>
    `/api/projects/${projectId}/media?${params.toString()}`,
  moveUrl: () => "/api/storage/v1/rename",
  crossProjectMoveUrl: () => "/api/storage/v1/move",
  archivePlanUrl: (params) => `/api/storage/v1/archive/plan?${params.toString()}`,
  archivePartUrl: (params) => `/api/storage/v1/archive?${params.toString()}`,
  exposedOptionsUrl: (projectId) => `/api/projects/${projectId}/drive/options`,
  reprocessUrl: (projectId, fileId) =>
    `/api/projects/${projectId}/drive/files/${fileId}/reprocess`,
  // Только чтение: у роута нет PUT, а `can.editDescription` ниже — false.
  descriptionMdUrl: (projectId) => `/api/projects/${projectId}/description`,
  chatUrl: (projectId) => `/api/projects/${projectId}/chat`,
  chatReadUrl: (projectId) => `/api/projects/${projectId}/chat/read`,
  chatPerspective: "client",
  trashUrl: (projectId) =>
    projectId
      ? `/api/storage/v1/trash?projectId=${encodeURIComponent(projectId)}`
      : "/api/storage/v1/trash",
  trashRestoreUrl: () => "/api/storage/v1/trash/restore",
  trashPurgeUrl: (projectId, fileId) => {
    const params = new URLSearchParams({ projectId })
    if (fileId) params.set("fileId", fileId)
    return `/api/storage/v1/trash?${params.toString()}`
  },
  projectPurgeUrl: () => "/api/storage/v1/project-purge",
  showServiceFolders: false,
  directUpload: true,
  can: {
    createProject: true,
    deleteProject: true,
    renameProject: true,
    archiveProject: true,
    shareProject: true,
    // Передать проект может только администратор: в кабинете владелец один и
    // менять его некому.
    transferProject: false,
    upload: true,
    createFolder: true,
    renameItem: true,
    deleteItem: true,
    move: true,
    writeSettings: true,
    writeChat: true,
    // Описание — бриф от команды: пользователь его читает, а пишут в программе
    // или в админском «Конвейере».
    editDescription: false,
  },
}
