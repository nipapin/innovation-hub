"use client"

import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FilePlus,
  FileText,
  FolderInput,
  FolderPlus,
  FolderUp,
  MessageCircle,
  Pencil,
  RotateCcw,
  Scissors,
  Settings2,
  Share2,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

type MenuEntry =
  | { sep: true }
  | {
      sep?: false
      icon: LucideIcon
      label: string
      /** Горячая клавиша справа от пункта, например «Пробел». */
      hint?: string
      danger?: boolean
      onClick: () => void
    }

/**
 * Убирает разделители, оставшиеся без пунктов: состав меню зависит от прав
 * источника (в админке нет загрузки и удаления), и после фильтрации иначе
 * остаются висячие линии по краям и подряд.
 */
function tidySeparators(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.sep) {
      if (out.length === 0) continue
      if (out[out.length - 1]?.sep) continue
    }
    out.push(entry)
  }
  while (out.length > 0 && out[out.length - 1]?.sep) out.pop()
  return out
}

/**
 * Контекстное меню рабочей области.
 * Состав пунктов повторяет макет; часть действий пока не подключена
 * к API и показывает тост «Пока не подключено».
 */
export function WorkspaceContextMenu() {
  const ws = useWorkspace()
  const { menu, t, source } = ws

  if (!menu) return null

  // Права считаются по проекту, к которому относится меню: для файлов это
  // выбранный проект, для строки списка — она сама. Читателю расшаренного
  // проекта пункты правки не показываются вовсе.
  const can = ws.capabilitiesFor(
    menu.kind === "project" ? (menu.project ?? null) : ws.selected,
  )

  let entries: MenuEntry[] = []

  if (menu.kind === "file" && menu.file) {
    const file = menu.file
    // Меню применяется ко всему выделению, если правый клик пришёлся по нему.
    const targets = ws.isSelected(file.id) ? ws.selection : [file]
    const many = targets.length > 1
    const suffix = many ? ` (${targets.length})` : ""

    entries = [
      // Скачивание, просмотр и переименование осмысленны только для одного элемента.
      ...(!many && !file.isFolder
        ? [
            {
              icon: Eye,
              label: t.mPreview,
              hint: t.previewSpaceHint,
              onClick: () => ws.openPreview(file),
            } as MenuEntry,
            {
              icon: Download,
              label: t.mDownload,
              onClick: () => ws.downloadItem(file),
            } as MenuEntry,
          ]
        : []),
      // Папка целиком: диалог показывает, во сколько архивов она разложится.
      ...(!many && file.isFolder
        ? [
            {
              icon: FileArchive,
              label: t.mDownloadFolder,
              onClick: () =>
                ws.openArchiveDialog({
                  folderId: file.id,
                  folderPath: "",
                  name: file.name,
                }),
            } as MenuEntry,
          ]
        : []),
      ...(many || !can.renameItem
        ? []
        : [
            {
              icon: Pencil,
              label: t.mRename,
              onClick: () => ws.renameItem(file),
            } as MenuEntry,
          ]),
      /*
        «Обработать заново» — только для элемента верхнего уровня IN и только
        при праве правки: обработка тратит деньги владельца проекта, и читатель,
        позванный посмотреть результат, распоряжаться ими не должен. Для пачки
        пункта нет: каждый элемент — своя задача и свои деньги, и одним кликом
        на десяток выделенных такое не делают.
      */
      ...(many || !can.renameItem || !ws.canReprocess(file)
        ? []
        : [
            {
              icon: RotateCcw,
              label: t.mReprocess,
              onClick: () => ws.reprocessItem(file),
            } as MenuEntry,
          ]),
      { sep: true },
      ...(can.move
        ? [
            {
              icon: Scissors,
              label: t.mCut + suffix,
              onClick: () => ws.putToClipboard("cut", targets),
            } as MenuEntry,
            {
              icon: Copy,
              label: t.mCopy + suffix,
              onClick: () => ws.putToClipboard("copy", targets),
            } as MenuEntry,
            {
              icon: FolderInput,
              label: t.mMove + suffix,
              onClick: () => ws.openMoveDialog(targets),
            } as MenuEntry,
          ]
        : []),
      { sep: true },
      ...(can.deleteItem
        ? [
            {
              icon: Trash2,
              label: t.mDelete + suffix,
              danger: true,
              onClick: () => ws.deleteItems(targets),
            } as MenuEntry,
          ]
        : []),
    ]
  } else if (menu.kind === "empty") {
    const target = menu.target ?? ws.currentTarget
    entries = [
      ...(can.createFolder
        ? [
            {
              icon: FolderPlus,
              label: t.mNewFolder,
              onClick: () => ws.createFolder(target),
            } as MenuEntry,
            {
              icon: FilePlus,
              label: t.mNewText,
              onClick: () => ws.createTextFile(target),
            } as MenuEntry,
          ]
        : []),
      { sep: true },
      ...(can.upload
        ? [
            {
              icon: Upload,
              label: t.mUploadFile,
              onClick: () => ws.triggerUpload(target),
            } as MenuEntry,
            {
              icon: FolderUp,
              label: t.mUploadFolder,
              onClick: () => ws.triggerFolderUpload(target),
            } as MenuEntry,
          ]
        : []),
      { sep: true },
      {
        icon: FileArchive,
        label: t.mDownloadFolder,
        onClick: () =>
          ws.openArchiveDialog({
            folderId: null,
            folderPath: target.folderPath,
            name:
              target.folderPath.split("/").filter(Boolean).pop() ??
              ws.selected?.name ??
              "",
          }),
      },
      // «Вставить» показываем только когда в буфере что-то есть.
      ...(ws.clipboard && can.move
        ? [
            { sep: true } as MenuEntry,
            {
              icon: ClipboardPaste,
              label: `${t.clipboardPaste} (${ws.clipboard.items.length})`,
              onClick: () => ws.pasteClipboard(target.folderPath),
            } as MenuEntry,
          ]
        : []),
    ]
  } else if (menu.kind === "project" && menu.project) {
    const project = menu.project
    entries = [
      /**
       * Проект в корзине — первым пунктом «Восстановить», и это единственное,
       * что для него добавляется. Всё остальное отсеивается само: роль такого
       * проекта зажата до читателя (./access.ts#projectRole), поэтому правки
       * ниже просто не попадают в меню.
       */
      ...(project.deletedAt
        ? [
            {
              icon: RotateCcw,
              label: t.mRestore,
              onClick: () => ws.restoreProject(project),
            } as MenuEntry,
          ]
        : []),
      ...(can.renameProject
        ? [
            {
              icon: Pencil,
              label: t.mRename,
              onClick: () => ws.renameProject(project),
            } as MenuEntry,
          ]
        : []),
      ...(can.shareProject
        ? [
            {
              icon: Share2,
              label: t.mShare,
              onClick: () => ws.shareProject(project),
            } as MenuEntry,
          ]
        : []),
      ...(can.transferProject
        ? [
            {
              icon: ArrowLeftRight,
              label: t.mTransfer,
              onClick: () => ws.transferProject(project),
            } as MenuEntry,
          ]
        : []),
      {
        icon: ExternalLink,
        label: t.mOpenWindow,
        onClick: () =>
          window.open(
            source.pageUrl({ id: project.id, tab: "projects" }),
            "_blank",
            "noopener",
          ),
      },
      ...(can.archiveProject
        ? [
            {
              icon: project.isArchived ? ArchiveRestore : Archive,
              label: project.isArchived ? t.mUnarchive : t.mArchive,
              onClick: () => ws.setArchived(project, !project.isArchived),
            } as MenuEntry,
          ]
        : []),
      { sep: true },
      {
        icon: FileText,
        label: t.tabDesc,
        onClick: () => {
          ws.selectProject(project.id)
          ws.setBottomTab("desc")
        },
      },
      {
        icon: Settings2,
        label: t.tabSettings,
        onClick: () => {
          ws.selectProject(project.id)
          ws.setBottomTab("settings")
        },
      },
      {
        icon: MessageCircle,
        label: t.tabChat,
        onClick: () => ws.openChat(project.id),
      },
    ]
  }

  entries = tidySeparators(entries)
  if (entries.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-[120]"
      onClick={ws.closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        ws.closeMenu()
      }}
    >
      <div
        role="menu"
        className="fixed flex min-w-[216px] flex-col gap-px rounded-[11px] border border-white/10 bg-ws-raised p-1.5 shadow-ws-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {entries.map((entry, i) =>
          entry.sep ? (
            <div key={`sep-${i}`} className="mx-1 my-[5px] h-px bg-white/[0.08]" />
          ) : (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              onClick={() => {
                ws.closeMenu()
                entry.onClick()
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.07]",
                entry.danger ? "text-destructive" : "text-ws-2",
              )}
            >
              <entry.icon className="h-[18px] w-[18px] shrink-0 opacity-85" />
              <span className="flex-1">{entry.label}</span>
              {entry.hint ? (
                <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-px text-[11px] font-normal text-ws-4">
                  {entry.hint}
                </kbd>
              ) : null}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
