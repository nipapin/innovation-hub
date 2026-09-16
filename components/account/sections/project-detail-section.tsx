"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ChevronRight,
  Columns3,
  File,
  FileImage,
  FileVideo,
  Folder,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { toast } from "sonner"
import { uploadProjectFileDirect } from "@/lib/project-direct-upload"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"
import {
  ProjectAutomationPanel,
  type ProjectDriveDto,
  type ProjectDriveFileDto,
} from "@/components/account/sections/project-automation-panel"
import {
  ProjectChatPanel,
  type ProjectChatMessageDto,
} from "@/components/account/sections/project-chat-panel"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export type ProjectDetail = {
  id: string
  name: string
  description: string
  driveFolderId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ProjectMediaItem = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  driveFileId: string
  createdAt: string
}

type Props = {
  project: ProjectDetail
  /** Fallback listing from the local DB, used when Drive is unavailable. */
  media: ProjectMediaItem[]
  /** Live Drive state; null when Drive is not configured or failed to load. */
  drive: ProjectDriveDto | null
  /**
   * True once `options/options.json` exists in the project's Drive folder
   * (the automation pipeline's signal it has picked the project up). Until
   * then the page shows only the chat — no active/pause toggle, no files.
   */
  automationStarted: boolean
  chatMessages: ProjectChatMessageDto[]
  unreadChatCount: number
  /**
   * Что можно делать в проекте: расшаренный проект может быть отдан только на
   * чтение. Сервер это и так проверяет (lib/project-access.ts), но кнопка,
   * которая всегда отвечает 403, — это не защита, а обман.
   */
  permissions?: { writeFiles: boolean; writeChat: boolean }
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov"

function formatBytes(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  try {
    // Fixed locale: SSR and the browser must produce identical text,
    // otherwise React reports a hydration mismatch.
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function fileIcon(mimeType: string, isFolder: boolean, className = "h-4 w-4") {
  if (isFolder) return <Folder className={className} />
  if (mimeType.startsWith("video/")) return <FileVideo className={className} />
  if (mimeType.startsWith("image/")) return <FileImage className={className} />
  return <File className={className} />
}

/** Tile color coding so file types are distinguishable at a glance. */
function tileTone(mimeType: string, isFolder: boolean): string {
  if (isFolder) return "bg-amber-400/15 text-amber-300"
  if (mimeType.startsWith("video/")) return "bg-fuchsia-400/15 text-fuchsia-300"
  if (mimeType.startsWith("image/")) return "bg-sky-400/15 text-sky-300"
  return "bg-foreground/[0.06] text-muted-foreground"
}

/** True while a drag carries actual files (as opposed to text/links). */
function isFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files")
}

type FilesViewMode = "list" | "grid" | "columns"

const FILES_VIEW_STORAGE_KEY = "ff-project-files-view"

function useFilesViewMode(): [FilesViewMode, (mode: FilesViewMode) => void] {
  const [mode, setMode] = useState<FilesViewMode>("list")

  useEffect(() => {
    const stored = window.localStorage.getItem(FILES_VIEW_STORAGE_KEY)
    if (stored === "list" || stored === "grid" || stored === "columns") {
      setMode(stored)
    }
  }, [])

  const update = (next: FilesViewMode) => {
    setMode(next)
    window.localStorage.setItem(FILES_VIEW_STORAGE_KEY, next)
  }

  return [mode, update]
}

/** Walks the already-loaded file tree down `path` and returns that folder's children. */
function childrenAtPath(
  root: ProjectDriveFileDto[],
  path: ProjectDriveFileDto[],
): ProjectDriveFileDto[] {
  let level = root
  for (const node of path) {
    if (!node.isFolder) return []
    level = node.children ?? []
  }
  return level
}

/**
 * Builds the macOS Finder-style column list: column 0 is the project root,
 * each further column is the children of the previously selected folder.
 * Stops once `path` reaches a file (files terminate the drill-down).
 */
function buildColumns(
  root: ProjectDriveFileDto[],
  path: ProjectDriveFileDto[],
): ProjectDriveFileDto[][] {
  const columns: ProjectDriveFileDto[][] = [root]
  for (const node of path) {
    if (!node.isFolder) break
    columns.push(node.children ?? [])
  }
  return columns
}

export function ProjectDetailSection({
  project,
  media: initialMedia,
  drive,
  automationStarted,
  chatMessages,
  unreadChatCount,
  permissions,
}: Props) {
  const canWriteFiles = permissions?.writeFiles ?? true
  const canWriteChat = permissions?.writeChat ?? true
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const driveMode = drive !== null
  const [media, setMedia] = useState(initialMedia)
  const [driveFiles, setDriveFiles] = useState<ProjectDriveFileDto[]>(
    drive?.files ?? [],
  )
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [viewMode, setViewMode] = useFilesViewMode()
  // Drill-down chain shared by grid ("breadcrumb") and columns ("selection")
  // view — both browse the same already-loaded tree, just render it
  // differently. Reset whenever the tree itself is reloaded so it never
  // points at stale folder objects.
  const [path, setPath] = useState<ProjectDriveFileDto[]>([])

  // Counts nested drag enter/leave pairs so the whole content area can be a
  // single dropzone without the overlay flickering as the pointer crosses
  // child elements (a plain boolean toggles on every nested enter/leave).
  const [dragDepth, setDragDepth] = useState(0)
  const dragOver = dragDepth > 0

  const [isActive, setIsActive] = useState(project.isActive)
  const [togglingActive, setTogglingActive] = useState(false)

  const refreshDrive = useCallback(async () => {
    setRefreshing(true)
    try {
      const response = await fetch(`/api/projects/${project.id}/drive`, {
        credentials: "same-origin",
      })
      const data = (await response.json().catch(() => null)) as
        | ({ available?: boolean; message?: string } & Partial<ProjectDriveDto>)
        | null
      if (!response.ok) {
        toast.error(data?.message ?? "Could not refresh files.")
        return
      }
      if (data?.available && data.files) {
        setDriveFiles(data.files)
        setPath([])
      }
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setRefreshing(false)
    }
  }, [project.id])

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true)
      setProgress(0)
      try {
        const uploaded = await uploadProjectFileDirect({
          projectId: project.id,
          file,
          folderPath: "",
          onProgress: setProgress,
        })
        const item: ProjectMediaItem = {
          id: uploaded.id,
          fileName: uploaded.name,
          mimeType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          driveFileId: "",
          createdAt: uploaded.createdAt,
        }
        setMedia((prev) => [item, ...prev])
        toast.success(`Uploaded ${file.name}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Upload failed.",
        )
      } finally {
        setUploading(false)
        setProgress(null)
      }
    },
    [project.id],
  )

  const onFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    for (const file of list) {
      await uploadFile(file)
    }
    if (driveMode) {
      // The Drive folder is the source of truth — re-list it after uploads.
      await refreshDrive()
    }
  }

  const onDeleteDriveFile = async (file: ProjectDriveFileDto) => {
    if (!window.confirm(`Delete “${file.name}”?`)) return
    setDeletingId(file.id)
    try {
      const response = await fetch(
        `/api/projects/${project.id}/drive/files/${file.id}`,
        { method: "DELETE", credentials: "same-origin" },
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        toast.error(data?.message ?? "Could not delete file.")
        return
      }
      setDriveFiles((prev) => prev.filter((f) => f.id !== file.id))
      setPath([])
      toast.success("File deleted.")
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setDeletingId(null)
    }
  }

  const onDeleteMedia = async (item: ProjectMediaItem) => {
    if (!window.confirm(`Delete “${item.fileName}”?`)) return
    setDeletingId(item.id)
    try {
      const response = await fetch(
        `/api/projects/${project.id}/media/${item.id}`,
        { method: "DELETE", credentials: "same-origin" },
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        toast.error(data?.message ?? "Could not delete file.")
        return
      }
      setMedia((prev) => prev.filter((m) => m.id !== item.id))
      toast.success("File deleted.")
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setDeletingId(null)
    }
  }

  const onToggleActive = async (next: boolean) => {
    setTogglingActive(true)
    setIsActive(next)
    try {
      // `options/folderState.json` on Drive is the real automation switch
      // (read by the desktop app's hot processing loop). Prefer writing it
      // there so this can never drift from the projects list; fall back to
      // the plain DB flag when automation hasn't been set up for this
      // project yet (409 = no folderState.json to rewrite) or Drive isn't
      // wired up at all — mirrors the toggle on the projects list page.
      let response = await fetch(
        `/api/projects/${project.id}/drive/folder-state`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      )

      if (response.status === 409) {
        response = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        })
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(data?.message ?? "Could not update project.")
      }
      toast.success(next ? "Project resumed." : "Project paused.")
      router.refresh()
    } catch (error) {
      setIsActive(!next)
      toast.error(
        error instanceof Error ? error.message : "Unable to reach the server.",
      )
    } finally {
      setTogglingActive(false)
    }
  }

  const fileCount = driveMode ? driveFiles.length : media.length

  // Automation hasn't picked this project up yet (no options/options.json
  // in Drive): hide the active/pause toggle and file browser entirely and
  // show only the chat, per the agreed pre-automation UI.
  if (!automationStarted) {
    return (
      <div className="space-y-8">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
            <Link href="/account/projects">
              <ArrowLeft className="h-4 w-4" />
              All projects
            </Link>
          </Button>
          <AccountPageHeader
            eyebrow="Project"
            title={project.name}
            description={
              project.description ||
              "We're setting this project up. Tell us more about what you need below — our team will reply here."
            }
          />
        </div>
        <ProjectChatPanel
          projectId={project.id}
          initialMessages={chatMessages}
          canWrite={canWriteChat}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link href="/account/projects">
            <ArrowLeft className="h-4 w-4" />
            All projects
          </Link>
        </Button>
        <AccountPageHeader
          eyebrow="Project"
          title={project.name}
          description={project.description}
          actions={
            <div className="relative inline-flex">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/account/projects/${project.id}/chat`}>
                  <MessageSquare className="h-4 w-4" />
                  Chat
                </Link>
              </Button>
              {unreadChatCount > 0 ? (
                <span
                  aria-label={`${unreadChatCount} unread message${unreadChatCount === 1 ? "" : "s"}`}
                  className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                >
                  {unreadChatCount > 99 ? "99+" : unreadChatCount}
                </span>
              ) : null}
            </div>
          }
        />
      </div>

      {/* The whole content area below is one big dropzone: drag files in
          from anywhere over metadata/files/automation and they upload. */}
      <div
        className="relative space-y-8"
        onDragEnter={(e) => {
          e.preventDefault()
          if (canWriteFiles && isFileDrag(e)) setDragDepth((d) => d + 1)
        }}
        onDragOver={(e) => {
          e.preventDefault()
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragDepth((d) => Math.max(0, d - 1))
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragDepth(0)
          if (uploading || !canWriteFiles) return
          if (e.dataTransfer.files?.length) {
            void onFiles(e.dataTransfer.files)
          }
        }}
      >
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-background/90 backdrop-blur-sm">
            <UploadCloud className="h-10 w-10 text-primary" />
            <p className="text-sm font-medium text-foreground">
              Drop files to upload
            </p>
          </div>
        ) : null}

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40 px-5 py-4">
          <div className="flex items-center gap-3">
            {togglingActive ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
            <Switch
              checked={isActive}
              disabled={togglingActive}
              onCheckedChange={(checked) => void onToggleActive(checked)}
              aria-label="Toggle project status"
            />
            <p className="text-sm font-medium">
              {isActive ? "Project is active" : "Project is paused"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              Created{" "}
              <span className="text-foreground">
                {formatDate(project.createdAt)}
              </span>
            </span>
            <span>
              Last updated{" "}
              <span className="text-foreground">
                {formatDate(project.updatedAt)}
              </span>
            </span>
            <span>
              Files <span className="text-foreground">{fileCount}</span>
            </span>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Files ({fileCount})
            </h2>
            <div className="flex items-center gap-2">
              {uploading ? (
                <span className="pr-1 text-xs text-muted-foreground">
                  Uploading…{progress != null ? ` ${progress}%` : ""}
                </span>
              ) : null}
              {driveMode ? (
                <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-1">
                  <ViewToggleButton
                    active={viewMode === "list"}
                    label="List view"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="h-4 w-4" />
                  </ViewToggleButton>
                  <ViewToggleButton
                    active={viewMode === "grid"}
                    label="Grid view"
                    onClick={() => setViewMode("grid")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </ViewToggleButton>
                  <ViewToggleButton
                    active={viewMode === "columns"}
                    label="Column view"
                    onClick={() => setViewMode("columns")}
                  >
                    <Columns3 className="h-4 w-4" />
                  </ViewToggleButton>
                </div>
              ) : null}
              {canWriteFiles ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="h-4 w-4" />
                  )}
                  Upload
                </Button>
              ) : null}
              {driveMode ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => void refreshDrive()}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", refreshing && "animate-spin")}
                  />
                  Refresh
                </Button>
              ) : null}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void onFiles(e.target.files)
                    e.target.value = ""
                  }
                }}
              />
            </div>
          </div>

          {driveMode ? (
            driveFiles.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                No files in this project yet. Drop files anywhere on this
                page to upload.
              </p>
            ) : viewMode === "grid" ? (
              <DriveGridView
                root={driveFiles}
                path={path}
                onNavigate={setPath}
              />
            ) : viewMode === "columns" ? (
              <DriveColumnsView
                root={driveFiles}
                path={path}
                onNavigate={setPath}
                deletingId={deletingId}
                onDelete={canWriteFiles ? onDeleteDriveFile : undefined}
              />
            ) : (
              <ul className="divide-y divide-border/60 border-y border-border/60">
                {driveFiles.map((file) => (
                  <DriveFileTreeNode
                    key={file.id}
                    file={file}
                    depth={0}
                    deletingId={deletingId}
                    onDelete={canWriteFiles ? onDeleteDriveFile : undefined}
                  />
                ))}
              </ul>
            )
          ) : media.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
              No files uploaded yet. Drop files anywhere on this page to
              upload.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 border-y border-border/60">
              {media.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03] text-muted-foreground">
                    {fileIcon(item.mimeType, false)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(item.sizeBytes)} ·{" "}
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                  {canWriteFiles ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={deletingId === item.id}
                      onClick={() => void onDeleteMedia(item)}
                      aria-label={`Delete ${item.fileName}`}
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {drive ? (
          <ProjectAutomationPanel
            projectId={project.id}
            options={drive.options}
            fileTypes={drive.fileTypes ?? {}}
          />
        ) : null}
      </div>
    </div>
  )
}

function ViewToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

/** Breadcrumb + tile grid for the folder currently drilled into. */
function DriveGridView({
  root,
  path,
  onNavigate,
}: {
  root: ProjectDriveFileDto[]
  path: ProjectDriveFileDto[]
  onNavigate: (path: ProjectDriveFileDto[]) => void
}) {
  // Grid never drills into a file, but `path` is shared with column view
  // (where the last entry can be a selected file) — drop a trailing file
  // so the grid always shows an actual folder's contents.
  const gridPath =
    path.length > 0 && !path[path.length - 1].isFolder
      ? path.slice(0, -1)
      : path
  const children = childrenAtPath(root, gridPath)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => onNavigate([])}
          className={cn(
            "shrink-0 rounded px-1.5 py-1 transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
            gridPath.length === 0 && "font-medium text-foreground",
          )}
        >
          Project root
        </button>
        {gridPath.map((node, i) => (
          <span key={node.id} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              type="button"
              onClick={() => onNavigate(gridPath.slice(0, i + 1))}
              className={cn(
                "rounded px-1.5 py-1 transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
                i === gridPath.length - 1 && "font-medium text-foreground",
              )}
            >
              {node.name}
            </button>
          </span>
        ))}
      </div>

      {children.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
          Empty folder.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {children.map((file) => (
            <DriveGridTile
              key={file.id}
              file={file}
              onOpenFolder={() => onNavigate([...gridPath, file])}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DriveGridTile({
  file,
  onOpenFolder,
}: {
  file: ProjectDriveFileDto
  onOpenFolder: () => void
}) {
  return (
    <div
      role={file.isFolder ? "button" : undefined}
      tabIndex={file.isFolder ? 0 : undefined}
      onClick={() => file.isFolder && onOpenFolder()}
      onKeyDown={(e) => {
        if (file.isFolder && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onOpenFolder()
        }
      }}
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border/60 bg-[hsl(var(--surface-2))]/60 p-3 text-left transition-colors duration-150",
        file.isFolder && "cursor-pointer hover:border-border/80 hover:bg-foreground/[0.04]",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
          tileTone(file.mimeType, file.isFolder),
        )}
      >
        {fileIcon(file.mimeType, file.isFolder, "h-6 w-6")}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {file.name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {file.isFolder
            ? `${file.children?.length ?? 0} item${file.children?.length === 1 ? "" : "s"}`
            : formatBytes(file.sizeBytes)}
        </p>
      </div>
    </div>
  )
}

/**
 * macOS Finder-style column browser: each column shows one folder's
 * contents; clicking an item selects it and (if it's a folder) opens a new
 * column to its right with its contents, replacing anything deeper that
 * was open. Selecting a file opens a small preview pane instead of a
 * column, since files have no children.
 */
function DriveColumnsView({
  root,
  path,
  onNavigate,
  deletingId,
  onDelete,
}: {
  root: ProjectDriveFileDto[]
  path: ProjectDriveFileDto[]
  onNavigate: (path: ProjectDriveFileDto[]) => void
  deletingId: string | null
  onDelete?: (file: ProjectDriveFileDto) => void
}) {
  const columns = buildColumns(root, path)
  const lastSelected = path[path.length - 1] ?? null
  const showPreview = lastSelected !== null && !lastSelected.isFolder

  return (
    <div className="flex overflow-x-auto rounded-xl border border-border/60">
      {columns.map((items, columnIndex) => (
        <DriveColumn
          key={columnIndex}
          items={items}
          selectedId={path[columnIndex]?.id ?? null}
          onSelect={(item) => onNavigate([...path.slice(0, columnIndex), item])}
        />
      ))}
      {showPreview ? (
        <DriveFilePreview
          file={lastSelected}
          deletable={path.length === 1}
          deletingId={deletingId}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  )
}

function DriveColumn({
  items,
  selectedId,
  onSelect,
}: {
  items: ProjectDriveFileDto[]
  selectedId: string | null
  onSelect: (item: ProjectDriveFileDto) => void
}) {
  return (
    <div className="max-h-[28rem] w-64 shrink-0 overflow-y-auto border-r border-border/60 p-2 last:border-r-0">
      {items.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground/70">
          Empty folder
        </p>
      ) : (
        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                selectedId === item.id
                  ? "bg-primary/15 text-primary"
                  : "text-foreground hover:bg-foreground/[0.04]",
              )}
            >
              <span className="shrink-0 text-muted-foreground">
                {fileIcon(item.mimeType, item.isFolder, "h-4 w-4")}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.isFolder ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DriveFilePreview({
  file,
  deletable,
  deletingId,
  onDelete,
}: {
  file: ProjectDriveFileDto
  deletable: boolean
  deletingId: string | null
  onDelete?: (file: ProjectDriveFileDto) => void
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col items-center gap-4 p-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-foreground/[0.03] text-muted-foreground">
        {fileIcon(file.mimeType, false, "h-7 w-7")}
      </span>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{file.name}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {formatBytes(file.sizeBytes)} · {formatDate(file.modifiedAt)}
        </p>
      </div>
      {deletable && onDelete ? (
        <Button
          variant="outline"
          size="sm"
          disabled={deletingId === file.id}
          onClick={() => onDelete(file)}
          className="text-muted-foreground hover:text-destructive"
        >
          {deletingId === file.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
      ) : null}
    </div>
  )
}

const TREE_INDENT_PX = 24

/**
 * One row of the project's Drive file tree. Folders are collapsible and
 * recurse into their own children; the `options` service folder is already
 * excluded server-side at every depth (see `lib/project-drive.ts`), so
 * anything rendered here is meant to be visible to the user.
 *
 * Delete is only offered at depth 0: the API only allows removing direct
 * children of the project's root folder (a safety guard against deleting
 * something outside the project), so nested files are shown but managed
 * from Drive directly for now.
 */
function DriveFileTreeNode({
  file,
  depth,
  deletingId,
  onDelete,
}: {
  file: ProjectDriveFileDto
  depth: number
  deletingId: string | null
  onDelete?: (file: ProjectDriveFileDto) => void
}) {
  const [open, setOpen] = useState(true)
  const indent = { paddingLeft: depth * TREE_INDENT_PX }

  if (!file.isFolder) {
    return (
      <li className="flex items-center gap-3 py-3" style={indent}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03] text-muted-foreground">
          {fileIcon(file.mimeType, false)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(file.sizeBytes)} · {formatDate(file.modifiedAt)}
          </p>
        </div>
        {depth === 0 && onDelete ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            disabled={deletingId === file.id}
            onClick={() => onDelete(file)}
            aria-label={`Delete ${file.name}`}
          >
            {deletingId === file.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        ) : null}
      </li>
    )
  }

  const children = file.children ?? []

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            style={indent}
            className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-foreground/[0.02]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03] text-muted-foreground">
              <Folder className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {children.length} item{children.length === 1 ? "" : "s"} ·{" "}
                {formatDate(file.modifiedAt)}
              </p>
            </div>
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                open && "rotate-90",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {children.length === 0 ? (
            <p
              className="py-2 text-xs text-muted-foreground/70"
              style={{ paddingLeft: indent.paddingLeft + 48 }}
            >
              Empty folder
            </p>
          ) : (
            <ul className="divide-y divide-border/40 border-t border-border/40">
              {children.map((child) => (
                <DriveFileTreeNode
                  key={child.id}
                  file={child}
                  depth={depth + 1}
                  deletingId={deletingId}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
