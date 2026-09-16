"use client"

import { useEffect } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Maximize2,
} from "lucide-react"

import { tf } from "@/components/account/i18n"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { fileIcon, fileIconClass, fmtDate, fmtSize } from "./format"
import type { DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"

/**
 * Само превью: картинка, видео, аудио или иконка типа.
 *
 * Размер целиком задаёт контейнер: `h-full` тянет медиа на всю его высоту (в том
 * числе увеличивает мелкое), ширина считается из пропорции и упирается в
 * `max-w-full`, а `object-contain` не даёт содержимому выйти за границы. Рамки
 * фиксированной пропорции здесь нет намеренно: в прежней правой колонке рамка
 * 16:10 превращала вертикальное видео в спичку между двух чёрных полей.
 */
function PreviewMedia({
  file,
  url,
  className,
}: {
  file: DriveFile
  url: string
  className?: string
}) {
  const { t } = useWorkspace()
  const Icon = fileIcon(file)
  const kind = file.mimeType.split("/")[0]

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={file.name}
        className={cn("h-full w-auto max-w-full object-contain", className)}
      />
    )
  }

  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className={cn("h-full w-auto max-w-full object-contain", className)}
      />
    )
  }

  if (kind === "audio") {
    return (
      <div className="flex flex-col items-center gap-3 px-4">
        <Icon className={cn("h-10 w-10", fileIconClass(file))} />
        <audio src={url} controls className="w-[min(420px,100%)]" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center">
      <Icon className={cn("h-10 w-10", fileIconClass(file))} />
      <span className="text-[12px] text-ws-4">{t.previewNoRender}</span>
    </div>
  )
}

/** Размер, дата, тип и автор загрузки. Узкая колонка, поэтому набор плотный. */
function PreviewMeta({
  file,
  className,
}: {
  file: DriveFile
  className?: string
}) {
  const { t, lang } = useWorkspace()

  const rows: { label: string; value: string }[] = [
    { label: t.typeLabel, value: file.mimeType },
    { label: t.sizeLabel, value: fmtSize(file.sizeBytes) },
    {
      label: t.dateLabel,
      value: fmtDate(file.modifiedAt ?? file.createdAt, lang),
    },
    ...(file.uploadedByName
      ? [{ label: t.uploadedByLabel, value: file.uploadedByName }]
      : []),
  ]

  return (
    <dl className={className}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex justify-between gap-2 border-t border-foreground/[0.07] py-[5px] text-[11.5px]"
        >
          <dt className="shrink-0 text-ws-4">{row.label}</dt>
          <dd className="truncate text-ws-2">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function EmptyPreview() {
  const { t } = useWorkspace()
  return (
    <div className="flex h-full min-h-[110px] flex-col items-center justify-center gap-2.5 text-center text-ws-5">
      <Eye className="h-[34px] w-[34px]" />
      <span className="text-[12.5px]">{t.previewEmpty}</span>
    </div>
  )
}

/**
 * Закладка «Превью» нижней панели: медиа занимает всю свободную площадь, данные
 * файла — узкой колонкой у правого края. Панель тянется за рукоятку, так что
 * размер превью выбирает сам пользователь, а горизонтальную ширину файловой
 * области превью больше не ест.
 */
export function PreviewTab() {
  const {
    t,
    source,
    selectedId,
    selectedFile,
    selection,
    downloadItem,
    openPreview,
  } = useWorkspace()

  if (!selectedId || !selectedFile || selectedFile.isFolder) {
    return <EmptyPreview />
  }

  const file = selectedFile
  const url = source.fileUrl(selectedId, file.id)

  return (
    // На узком экране медиа сверху, данные под ним: рядом они не помещаются.
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden md:flex-row md:gap-4">
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[10px] border border-foreground/[0.08] bg-ws-control p-1.5 max-md:h-[55%]">
        <PreviewMedia
          key={file.id}
          file={file}
          url={url}
          className="rounded-[6px]"
        />
      </div>

      <aside className="flex w-full shrink-0 flex-col overflow-y-auto md:w-[232px]">
        <p className="break-words text-[12.5px] leading-snug text-ws-1">
          {file.name}
        </p>
        {selection.length > 1 ? (
          <p className="mt-0.5 text-[11.5px] text-ws-4">
            {t.selectedCount}: {selection.length}
          </p>
        ) : null}

        <PreviewMeta file={file} className="mt-1.5" />

        <div className="mt-2.5 flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => openPreview()}
            className="flex items-center justify-center gap-2 rounded-[9px] bg-ws-action px-3 py-[7px] text-[12.5px] text-white hover:bg-ws-action-hover"
          >
            <Maximize2 className="h-4 w-4 shrink-0" />
            {t.previewFull}
            <kbd className="rounded border border-foreground/25 px-1.5 py-px text-[10.5px] font-normal">
              {t.previewSpaceHint}
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => downloadItem(file)}
            className="flex items-center justify-center gap-2 rounded-[9px] border border-foreground/10 px-3 py-[7px] text-[12.5px] text-ws-2 hover:bg-foreground/5"
          >
            <Download className="h-4 w-4 shrink-0" />
            {t.mDownload}
          </button>
        </div>
      </aside>
    </div>
  )
}

/**
 * Пробел открывает и закрывает окно превью, стрелки листают файлы папки.
 *
 * Слушаем окно, а не элементы списка: файл выделяют в трёх разных видах
 * (список, плитка, колонки) и в двух режимах, а поведение должно быть одно.
 * Поля ввода и сам плеер пропускаем — там у этих клавиш своя работа.
 */
function usePreviewHotkeys() {
  const {
    previewOpen,
    selectedFile,
    openPreview,
    closePreview,
    stepPreview,
    prompt,
    confirm,
    moveTargets,
    shareTarget,
  } = useWorkspace()

  const blocked = !!prompt || !!confirm || !!moveTargets || !!shareTarget

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el?.tagName ?? "")) return

      if (e.key === " ") {
        if (!previewOpen && (!selectedFile || selectedFile.isFolder)) return
        e.preventDefault()
        if (previewOpen) closePreview()
        else openPreview()
        return
      }

      if (!previewOpen) return
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault()
        stepPreview(1)
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault()
        stepPreview(-1)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [blocked, previewOpen, selectedFile, openPreview, closePreview, stepPreview])
}

/**
 * Модальное окно быстрого просмотра. Монтируется рядом с остальными диалогами
 * рабочей области, поэтому работает во всех режимах сразу — полном, упрощённом
 * и мобильном; горячие клавиши живут здесь же.
 */
export function PreviewDialog() {
  const {
    t,
    lang,
    source,
    selectedId,
    selectedFile,
    previewOpen,
    previewSiblings,
    closePreview,
    stepPreview,
    downloadItem,
  } = useWorkspace()

  usePreviewHotkeys()

  const file = selectedFile && !selectedFile.isFolder ? selectedFile : null
  if (!previewOpen || !file || !selectedId) return null

  const url = source.fileUrl(selectedId, file.id)
  const Icon = fileIcon(file)
  const at = previewSiblings.findIndex((f) => f.id === file.id)
  const many = previewSiblings.length > 1

  return (
    <Dialog open onOpenChange={(next) => !next && closePreview()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(88vh,920px)] w-[min(1180px,94vw)] max-w-none flex-col gap-0 overflow-hidden border-foreground/10 bg-ws-raised p-0 sm:rounded-2xl"
      >
        <div className="flex flex-none items-center gap-3 border-b border-foreground/[0.07] px-5 py-3.5 pr-14">
          <Icon className={cn("h-5 w-5 shrink-0", fileIconClass(file))} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] font-medium text-ws-1">
              {file.name}
            </DialogTitle>
            <p className="mt-0.5 truncate text-[12px] text-ws-4">
              {file.mimeType} · {fmtSize(file.sizeBytes)} ·{" "}
              {fmtDate(file.modifiedAt ?? file.createdAt, lang)}
              {file.uploadedByName
                ? ` · ${t.uploadedByLabel}: ${file.uploadedByName}`
                : ""}
            </p>
          </div>
          {many && at >= 0 ? (
            <span className="shrink-0 text-[12px] tabular-nums text-ws-4">
              {tf(t.previewCounter, {
                index: at + 1,
                total: previewSiblings.length,
              })}
            </span>
          ) : null}
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ws-well p-4">
          <PreviewMedia
            key={file.id}
            file={file}
            url={url}
            className="rounded-[10px]"
          />
          {many ? (
            <>
              <button
                type="button"
                onClick={() => stepPreview(-1)}
                aria-label={t.previewPrev}
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-foreground/10 bg-ws-raised/85 text-ws-2 hover:bg-ws-hover hover:text-ws-1"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => stepPreview(1)}
                aria-label={t.previewNext}
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-foreground/10 bg-ws-raised/85 text-ws-2 hover:bg-ws-hover hover:text-ws-1"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>

        <div className="flex flex-none items-center justify-between gap-4 border-t border-foreground/[0.07] px-5 py-3">
          <p className="truncate text-[11.5px] text-ws-5">{t.previewKeysHint}</p>
          <button
            type="button"
            onClick={() => downloadItem(file)}
            className="flex shrink-0 items-center gap-2 rounded-[9px] border border-foreground/10 px-3.5 py-2 text-[13px] text-ws-2 hover:bg-foreground/5"
          >
            <Download className="h-4 w-4" />
            {t.mDownload}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
