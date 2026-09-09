"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Download,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  MessageCircle,
  Plus,
  Settings2,
  Upload,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ChatTab, DescriptionTab, SettingsTab } from "./bottom-panel"
import { Breadcrumbs, FileBrowser, useLivePath } from "./file-browser"
import { PreviewTab } from "./file-preview"
import { AllProjectsPage } from "./simple-mode"
import type { BottomTab, DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"

type MobileTab = "files" | BottomTab

const TABS: {
  id: MobileTab
  icon: LucideIcon
  labelKey: "tabFiles" | "tabPreview" | "tabDesc" | "tabSettings" | "tabChat"
}[] = [
  { id: "files", icon: FolderOpen, labelKey: "tabFiles" },
  { id: "preview", icon: ImageIcon, labelKey: "tabPreview" },
  { id: "desc", icon: FileText, labelKey: "tabDesc" },
  { id: "settings", icon: Settings2, labelKey: "tabSettings" },
  { id: "chat", icon: MessageCircle, labelKey: "tabChat" },
]

function folderIcon(name: string): LucideIcon {
  if (name === "IN") return Download
  if (name === "OUT") return Upload
  return Folder
}

/** Мобильная рабочая область: табы папок, список файлов и нижний шит. */
export function MobileWorkspace() {
  const {
    t,
    can,
    selected,
    rootFiles,
    view,
    openChat,
    createFolder,
    triggerUpload,
    uploading,
    revealPath,
  } = useWorkspace()

  const [tab, setTab] = useState<MobileTab>("files")
  const [folderName, setFolderName] = useState<string | null>(null)
  const [path, setPath] = useState<DriveFile[]>([])

  /**
   * Переход «открыть файл» снаружи. Здесь, как и в простом режиме, общего пути
   * нет: есть вкладка папки верхнего уровня и путь внутри неё. Первый узел
   * цепочки задаёт вкладку, остальное — путь.
   */
  useEffect(() => {
    if (!revealPath || revealPath.length === 0) return
    const [head, ...rest] = revealPath
    setTab("files")
    setFolderName(head.name)
    setPath(rest)
  }, [revealPath])

  const folders = useMemo(() => {
    const all = rootFiles.filter((f) => f.isFolder)
    const head = ["IN", "OUT"]
      .map((n) => all.find((f) => f.name === n))
      .filter((f): f is DriveFile => !!f)
    const rest = all.filter((f) => f.name !== "IN" && f.name !== "OUT")
    return [...head, ...rest]
  }, [rootFiles])

  const current =
    folders.find((f) => f.name === folderName) ?? folders[0] ?? null

  // Папок в корне может не быть вовсе — тогда листаем сам корень проекта.
  const browseRoot = current ? (current.children ?? []) : rootFiles

  useLivePath(browseRoot, path, setPath)

  if (!selected) return <AllProjectsPage />

  const basePath = current?.name

  const target = {
    parentId: path.length ? path[path.length - 1].id : (current?.id ?? null),
    folderPath: [basePath, ...path.map((p) => p.name)].filter(Boolean).join("/"),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {tab === "files" ? (
        <>
          {folders.length > 0 ? (
            <div className="flex flex-none gap-1.5 overflow-x-auto px-3 pb-2.5 pt-3">
              {folders.map((f) => {
                const Icon = folderIcon(f.name)
                const active = current?.id === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFolderName(f.name)
                      setPath([])
                    }}
                    className={cn(
                      "flex h-[46px] min-w-[104px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-[14.5px] font-semibold tracking-[0.5px]",
                      active
                        ? "border-ws-accent/50 bg-ws-select/[0.22] text-ws-1"
                        : "border-white/[0.08] text-ws-3",
                    )}
                  >
                    <Icon className="h-[19px] w-[19px]" />
                    {f.name}
                  </button>
                )
              })}
            </div>
          ) : null}

          {path.length > 0 ? (
            <div className="flex-none px-3.5 pb-2">
              <Breadcrumbs
                rootLabel={current?.name ?? t.projectRoot}
                path={path}
                onNavigate={setPath}
              />
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <FileBrowser
              root={browseRoot}
              path={path}
              basePath={basePath}
              view={view === "columns" ? "list" : view}
              size="snug"
              onNavigate={setPath}
            />
          </div>

          {can.upload || can.createFolder ? (
            <div className="flex flex-none gap-2 px-3 pb-2">
              {can.upload ? (
                <button
                  type="button"
                  onClick={() => triggerUpload(target)}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ws-action py-2.5 text-[14px] text-white disabled:opacity-60"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? t.uploading : t.upload}
                </button>
              ) : null}
              {can.createFolder ? (
                <button
                  type="button"
                  onClick={() => createFolder(target)}
                  aria-label={t.mNewFolder}
                  className="flex items-center justify-center rounded-xl border border-white/10 px-3.5 py-2.5 text-ws-2"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === "preview" ? (
            <PreviewTab />
          ) : tab === "desc" ? (
            <DescriptionTab />
          ) : tab === "settings" ? (
            <SettingsTab />
          ) : (
            <ChatTab />
          )}
        </div>
      )}

      <nav className="grid shrink-0 grid-cols-5 border-t border-white/[0.08] bg-sidebar px-1 pb-2.5 pt-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
              if (item.id === "chat" && selected) openChat(selected.id)
            }}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[10.5px]",
              tab === item.id ? "text-primary" : "text-ws-3",
            )}
          >
            <item.icon className="h-[23px] w-[23px]" />
            {t[item.labelKey]}
          </button>
        ))}
      </nav>
    </div>
  )
}
