"use client"

import { Check, Download, Eye, MessageSquarePlus, MoreHorizontal, Pencil, X } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { downloadHref, useDownloadChoice } from "@/components/text-viewer/download-choice"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { displaySlotName, type FormPlace } from "@/lib/production/form"
import { slotNumber } from "@/lib/tools/element/names"
import { extensionFits } from "@/lib/tools/element/site-form"
import { textKind } from "@/lib/text-formats/kind"
import { cn } from "@/lib/utils"
import { isImage, mediaUrl } from "./chat/upload"
import { editableImageMime } from "./image-editor"
import { reviewable, useReview } from "./review/review-dialog"

/** Место формы: строка, номер и папка от корня рабочей. */
export type FileMenuSlot = { rowId: string; index: number; dir: string }

/** Этап-форма: «Поставить в →» и «Убрать из формы» (§3.0). */
export type FileMenuForm = {
  /** Править форму: исполнитель или автор пайплайна, этап открыт. */
  canEdit: boolean
  current: FormPlace | null
  places: FormPlace[]
  fileTypes: Record<string, string[]>
  onPlace: (slot: FileMenuSlot | null) => void
}

/** Картинку (jpg/png/webp) и текст можно поправить в браузере. */
export function editableFile(file: { name: string; contentType: string }): boolean {
  if (editableImageMime(file.name)) return true
  const kind = textKind(file.name, file.contentType)
  return kind !== null && kind !== "unsupported"
}

/**
 * Меню «…» файла этапа — одно на список файлов (IN / «Из чата» / FINAL) и
 * вложения чата: пункты появляются там, где применимы. Открыть, Редактировать,
 * Поставить в → / Убрать из формы (форма), Принять этот вариант (инструмент),
 * Комментировать (картинки; инструмент пометок — §8, review/review-dialog.tsx),
 * Скачать.
 */
export function FileMenu({
  file,
  labels,
  compact = false,
  onOpen,
  onEdit,
  form,
  approve,
  onComment,
}: {
  /** `id` — файл списка, `fileId` — вложение чата: по нему открываются пометки. */
  file: { id?: string; fileId?: string; name: string; s3Key: string; contentType: string }
  /** Названия строк форм: в меню исходные имена, без приставки места. */
  labels: readonly string[]
  /** Маленькая кнопка — под вложением в чате. */
  compact?: boolean
  onOpen?: (() => void) | null
  /** null — править нельзя (нет права или вид файла не правится). */
  onEdit?: (() => void) | null
  form?: FileMenuForm | null
  /** Этап-инструмент: принять вариант; `allowed` — проверяющий и этап открыт. */
  approve?: { allowed: boolean; onApprove: () => void } | null
  /** Свой обработчик «Комментировать»; без него — инструмент пометок этапа. */
  onComment?: (() => void) | null
}) {
  const { t } = useI18n()
  const { download, dialog: downloadDialog } = useDownloadChoice()
  const original = displaySlotName(file.name, labels).name
  const url = mediaUrl(file.s3Key)
  const image = isImage(file.contentType, file.name)
  const review = useReview()
  const fileId = file.id ?? file.fileId
  // Пометки — у картинок; открыть их можно внутри этапа (ReviewProvider).
  const comment =
    onComment ??
    (review && fileId && reviewable(file)
      ? () => review({ id: fileId, name: original, s3Key: file.s3Key, contentType: file.contentType })
      : null)
  // Свободные места сначала, потом занятые — в порядке формы.
  const places = form ? [...form.places].sort((a, b) => Number(a.fileName !== null) - Number(b.fileName !== null)) : []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t.productionFileMenu}
            aria-label={t.productionFileMenu}
            className={cn(
              "flex shrink-0 items-center justify-center text-ws-4 hover:bg-ws-hover hover:text-ws-1",
              compact ? "h-5 w-5 rounded" : "h-7 w-7 rounded-md",
            )}
          >
            <MoreHorizontal className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {onOpen ? (
            <DropdownMenuItem onSelect={onOpen}>
              <Eye className="mr-2 h-4 w-4" />
              {t.productionChatOpen}
            </DropdownMenuItem>
          ) : null}
          {onEdit ? (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              {t.productionEdit}
            </DropdownMenuItem>
          ) : null}
          {form ? (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!form.canEdit || places.length === 0}>
                  {t.productionPlaceInto}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="scrollbar-elegant max-h-[320px] min-w-[240px] overflow-y-auto">
                  {places.map((place) => {
                    const here =
                      form.current?.rowId === place.rowId &&
                      form.current.index === place.index &&
                      form.current.dir === place.dir
                    const fits = extensionFits({ fileTypes: form.fileTypes }, place.types, original)
                    const occupant = place.fileName ? displaySlotName(place.fileName, labels).name : null
                    return (
                      <DropdownMenuItem
                        key={`${place.dir}::${place.rowId}::${place.index}`}
                        disabled={here || !fits}
                        onSelect={() => {
                          if (occupant && !window.confirm(tf(t.productionPlaceReplace, { name: occupant }))) return
                          form.onPlace({ rowId: place.rowId, index: place.index, dir: place.dir })
                        }}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <span className="shrink-0 tabular-nums text-ws-4">{slotNumber(place.index)}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {place.dir ? <span className="text-ws-4">{place.dir} / </span> : null}
                          {place.label}
                        </span>
                        {occupant ? <span className="max-w-[120px] shrink-0 truncate text-[11.5px] text-ws-5">{occupant}</span> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {form.current ? (
                <DropdownMenuItem disabled={!form.canEdit} onSelect={() => form.onPlace(null)}>
                  <X className="mr-2 h-4 w-4" />
                  {t.productionPlaceRemove}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : approve ? (
            <>
              <DropdownMenuItem disabled={!approve.allowed} onSelect={approve.onApprove}>
                <Check className="mr-2 h-4 w-4" />
                {t.productionApproveThis}
              </DropdownMenuItem>
              {!approve.allowed ? <p className="px-2 pb-1.5 text-[11px] text-ws-4">{t.productionApproveHint}</p> : null}
            </>
          ) : null}
          {image && comment ? (
            <DropdownMenuItem onSelect={() => comment()}>
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              {t.productionComment}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() =>
              download({
                name: original,
                textUrl: `${url}?raw=1`,
                asIs: () => downloadHref(url, original),
              })
            }
          >
            <Download className="mr-2 h-4 w-4" />
            {t.productionChatDownload}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {downloadDialog}
    </>
  )
}
