"use client"

import { useRef, useState } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Eye, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n, type Dictionary } from "@/components/account/i18n"
import {
  extensionFits,
  FOLDER_TYPE,
  mimeFits,
  type SiteForm,
} from "@/lib/tools/element/site-form"
import { slotFileName } from "@/lib/tools/element/names"
import { canAdd, canRemove, subfolderName, type Group, type Slot } from "@/lib/tools/element/slots"
import { cn } from "@/lib/utils"
import type { DriveFile } from "../types"
import type { ElementIO } from "./element-io"
import { nodeAtPath } from "./tree"

/**
 * Форма слотов: строки требований разворачиваются в поля, а поля — в файлы.
 *
 * Строка устроена так: подчёркнутое поле с названием, глаз — посмотреть,
 * корзина — убрать строку вместе с файлом, и «выбрать файл». Пока файл не
 * принесли, в поле стоит ТИП («видео»), потому что это и есть вопрос к
 * человеку — что сюда положить; как только файл лёг, там его имя.
 *
 * Отдельной кнопки «убрать файл» нет намеренно. Слот — это место, а не
 * содержимое: новый файл встаёт поверх старого (см. `accept`), так что пустой
 * слот не нужен никому, кроме как перед удалением самой строки. Две кнопки с
 * почти одинаковым значком стояли рядом и различались только тем, исчезнет
 * строка или нет, — угадать это по виду было нельзя.
 *
 * Компонент рекурсивный, потому что рекурсивна сама модель: подпапка содержит
 * те же группы, что и корень.
 *
 * Правило одно на весь файл: имя файла даёт инструмент, а не человек. Ни одно
 * поле здесь имя не правит — только приносит и убирает содержимое.
 */

/** Сколько слотов сверх найденных в папке человек добавил руками. */
export type ExtraSlots = Record<string, number>

function slotKey(dir: string, rowId: string): string {
  return `${dir}::${rowId}`
}

function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** Тип файла человеческим словом. Незнакомый — как есть, из графа. */
function typeLabel(type: string, t: Dictionary): string {
  if (type === "video") return t.elementFileTypeVideo
  if (type === "image") return t.elementFileTypeImage
  if (type === "text") return t.elementFileTypeText
  if (type === "audio") return t.elementFileTypeAudio
  return type
}

function FileSlot({
  io,
  form,
  dir,
  slot,
  type,
  node,
  busy,
  isText,
  onBusy,
  onChanged,
  onPreview,
  onOpenText,
  onRemoveRow,
}: {
  io: ElementIO
  form: SiteForm
  dir: string
  slot: Slot
  type: string
  node: DriveFile | null
  busy: boolean
  isText: boolean
  onBusy: (value: boolean) => void
  onChanged: () => Promise<void>
  onPreview: (node: DriveFile) => void
  onOpenText: () => void
  /** Убрать строку целиком; null — строку требует граф, и убирать её нельзя. */
  onRemoveRow: (() => void) | null
}) {
  const { t } = useI18n()
  const [over, setOver] = useState<null | "ok" | "bad">(null)
  /** Проценты текущей заливки; null — ничего не едет. */
  const [percent, setPercent] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = async (file: File) => {
    /*
      Окончательная проверка — по расширению и по имени. До этого места файл
      мог дойти двумя путями: его бросили (тогда на подлёте смотрели только на
      MIME) или выбрали кнопкой (тогда не смотрели вовсе). Отказ поэтому
      обязан быть ЗАМЕТНЫМ: молчаливое «ничего не произошло» человек читает как
      поломку интерфейса, а не как «этот файл сюда не годится».
    */
    if (!extensionFits(form, type, file.name)) {
      setOver("bad")
      toast.error(`${t.elementSlotBadType}: ${file.name}`)
      window.setTimeout(() => setOver(null), 2000)
      return
    }
    onBusy(true)
    setPercent(0)
    try {
      const previous = slot.file?.name ?? null
      await io.putFile({
        dir,
        index: slot.index,
        label: slot.label,
        file,
        replaces: previous,
        onProgress: setPercent,
      })
      /*
        Убрать предыдущий файл, если новый лёг под ДРУГИМ именем.

        Имя слота несёт в себе исходное имя файла, поэтому замена совпадает по
        имени только тогда, когда принесли файл, названный так же, — лишь в этом
        случае заливка идёт перезаписью поверх (`overwrite` в element-io.ts).
        Во всех остальных в папке остаются оба, и старый уезжает в «лишние»:
        нода посчитает его, и условие состава не сойдётся.

        Порядок важен: сначала удачная заливка, потом удаление. Наоборот слот
        остался бы пустым, если заливка упадёт.
      */
      const fresh = slotFileName(slot.index, slot.label, file.name)
      if (node && previous && previous !== fresh) await io.remove(node.id)
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setPercent(null)
      onBusy(false)
    }
  }

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return
      e.preventDefault()
      e.stopPropagation()
      /*
        На подлёте судим ПО MIME, а не по имени, и это не выбор, а
        необходимость: во время перетаскивания браузер намеренно скрывает файл
        — `getAsFile()` возвращает `null`, пока его не отпустят, — и имя тогда
        пустое. Первая версия этой проверки спрашивала имя и потому всегда
        красила зону зелёной, даже под видео, летящим в «Картинки».

        Окончательное слово остаётся за расширением: его проверяет `accept`
        уже по настоящему имени, при броске.
      */
      const item = e.dataTransfer.items[0]
      setOver(mimeFits(type, item?.type ?? "") ? "ok" : "bad")
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      const file = e.dataTransfer.files[0]
      if (file) void accept(file)
    },
  }

  return (
    <div {...drop} className="flex min-w-0 flex-1 items-center gap-2">
      {/* Подчёркнутое поле: пока пусто — тип, потом имя файла. Во время
          заливки то же подчёркивание становится полосой прогресса — место у
          строки одно, и заводить под проценты второй ряд незачем. */}
      <div className="relative min-w-0 flex-1">
        <span
          className={cn(
            "block truncate border-b px-1 pb-1 text-[13.5px] transition-colors",
            percent !== null && "pr-10",
            over === "ok"
              ? "border-ws-select text-ws-1"
              : over === "bad"
                ? "border-destructive text-destructive"
                : slot.file
                  ? "border-foreground/20 text-ws-1"
                  : "border-foreground/15 text-ws-5",
          )}
        >
          {over === "bad"
            ? t.elementSlotBadType
            : (slot.file?.name ?? typeLabel(type, t))}
        </span>

        {percent !== null ? (
          <>
            <span
              className="absolute inset-x-0 bottom-0 h-[2px] bg-ws-out transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-ws-3 opacity-60">
              {percent}%
            </span>
          </>
        ) : null}
      </div>

      {/* Посмотреть. */}
      <button
        type="button"
        title={t.elementPreview}
        aria-label={t.elementPreview}
        disabled={!node}
        onClick={() => node && onPreview(node)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-foreground/40 hover:text-ws-1 disabled:opacity-30"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>

      {/* Убрать строку вместе с файлом. Место кнопки занято всегда, даже когда
          убирать нельзя: иначе «Выбрать» у соседних строк стояло бы на разном
          отступе и колонка кнопок разъезжалась бы. */}
      {onRemoveRow ? (
        <button
          type="button"
          title={t.elementRemoveSlot}
          aria-label={t.elementRemoveSlot}
          disabled={busy}
          onClick={onRemoveRow}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-4 hover:border-destructive hover:text-destructive disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span aria-hidden className="h-6 w-6 shrink-0" />
      )}

      {isText ? (
        <button
          type="button"
          disabled={busy}
          onClick={onOpenText}
          className="shrink-0 rounded-[7px] border border-foreground/15 px-2.5 py-1 text-[12.5px] text-ws-2 hover:border-foreground/30 hover:text-ws-1"
        >
          {t.elementEditorOpen}
        </button>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="shrink-0 rounded-[7px] border border-foreground/15 px-2.5 py-1 text-[12.5px] text-ws-2 hover:border-foreground/30 hover:text-ws-1"
      >
        {t.elementChoose}
      </button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void accept(file)
          // Сброс: иначе повторный выбор того же файла молча не вызовет onChange.
          e.target.value = ""
        }}
      />
    </div>
  )
}

/**
 * Перетаскиваемая строка.
 *
 * Ручку не рисуем — её нет и в макете: тянется сама строка, а кнопки остаются
 * нажимаемыми, потому что перетаскивание начинается только после 4 пикселей
 * движения (см. сенсор ниже).
 */
function SortableRow({
  id,
  draggable,
  children,
}: {
  id: string
  draggable: boolean
  children: React.ReactNode
}) {
  const sortable = useSortable({ id, disabled: !draggable })
  return (
    <div
      ref={sortable.setNodeRef}
      {...(draggable ? sortable.attributes : {})}
      {...(draggable ? sortable.listeners : {})}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "flex items-center gap-2",
        draggable && "cursor-grab",
        sortable.isDragging && "opacity-60",
      )}
    >
      {children}
    </div>
  )
}

export function ElementGroups({
  io,
  form,
  groups,
  folder,
  dir,
  extraSlots,
  onAddSlot,
  onRemoveSlot,
  busy,
  onBusy,
  onChanged,
  onPreview,
  onOpenText,
}: {
  io: ElementIO
  form: SiteForm
  groups: Group[]
  /** Папка элемента целиком — из неё достаём узлы по путям. */
  folder: DriveFile | null
  dir: string
  extraSlots: ExtraSlots
  onAddSlot: (key: string) => void
  onRemoveSlot: (key: string) => void
  busy: boolean
  onBusy: (value: boolean) => void
  onChanged: () => Promise<void>
  onPreview: (node: DriveFile) => void
  onOpenText: (input: { dir: string; slot: Slot; node: DriveFile | null }) => void
}) {
  const { t } = useI18n()
  const sensors = useSensors(
    // Порог: без него обычный щелчок по строке считался бы перетаскиванием, и
    // кнопки внутри строки перестали бы нажиматься.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )
  const here = nodeAtPath(folder, dir)

  const nodeOf = (slot: Slot): DriveFile | null => {
    const name = slot.file?.name ?? slot.folderName
    if (!name) return null
    return (here?.children ?? []).find((child) => child.name === name) ?? null
  }

  const dragEnd = (group: Group, slots: Slot[]) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const nodes = slots
      .map(nodeOf)
      .filter((node): node is DriveFile => node !== null)

    const from = nodes.findIndex((node) => node.id === active.id)
    const to = nodes.findIndex((node) => node.id === over.id)
    if (from < 0 || to < 0) return

    const ordered = [...nodes]
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved!)

    onBusy(true)
    void (async () => {
      try {
        await io.reorder({ nodes: ordered, labels: groups.map((g) => g.row.label) })
        await onChanged()
      } catch (error) {
        // Без этой ветки отказ уходил в никуда: строка возвращалась на место
        // молча, и перетаскивание выглядело как неработающее, хотя отказ был
        // осмысленный — например занятое имя.
        toast.error(error instanceof Error ? error.message : t.elementSlotBadType)
        await onChanged()
      } finally {
        onBusy(false)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const key = slotKey(dir, group.row.id)
        const extra = extraSlots[key] ?? 0
        const slots: Slot[] = [
          ...group.slots,
          ...Array.from({ length: extra }, (_, i) => ({
            rowId: group.row.id,
            label: group.row.label,
            index: group.slots.length + i + 1,
            file: null,
            folderName: null,
            groups: group.row.children.map((row) => ({ row, slots: [] })),
          })),
        ]
        const isFolder = group.row.type === FOLDER_TYPE
        const removable = canRemove(group.row, slots.length)
        const ids = slots
          .map((slot) => nodeOf(slot)?.id ?? null)
          .filter((id): id is string => id !== null)

        return (
          <div
            key={group.row.id}
            className="rounded-[10px] border border-foreground/15 p-3"
          >
            <p
              className="mb-2 text-[13px] text-ws-2"
              title={group.row.tooltip || undefined}
            >
              {group.row.label}
            </p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={dragEnd(group, slots)}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {slots.map((slot) => {
                    const node = nodeOf(slot)
                    const rowId = node?.id ?? `empty-${group.row.id}-${slot.index}`

                    /*
                      Убрать можно ЛЮБУЮ строку сверх объявленного минимума, а не
                      только последнюю: номер — это позиция, а не имя файла, и
                      оставшиеся просто сдвигаются. Ограничение «только
                      последняя» берегло от перенумерации то, что и так
                      перенумеровывается при каждом перетаскивании.

                      Файл уходит вместе со строкой: слот — это место, и пустых
                      мест сверх минимума форма не держит. Счётчик добавленных
                      вручную строк уменьшается в любом случае — без этого на
                      месте удалённого файла осталась бы пустая строка, которую
                      человек не заводил.
                    */
                    const removeRow = removable
                      ? () => {
                          if (!node) {
                            onRemoveSlot(key)
                            return
                          }
                          onBusy(true)
                          void (async () => {
                            try {
                              await io.remove(node.id)
                              // Закрыть дыру в номерах: после удаления второго из
                              // трёх третий обязан стать вторым, иначе следующее
                              // добавление попросится в занятое имя.
                              const rest = slots
                                .map(nodeOf)
                                .filter(
                                  (item): item is DriveFile =>
                                    item !== null && item.id !== node.id,
                                )
                              if (rest.length > 0) {
                                await io.reorder({
                                  nodes: rest,
                                  labels: groups.map((g) => g.row.label),
                                })
                              }
                              onRemoveSlot(key)
                              await onChanged()
                            } catch (error) {
                              toast.error(
                                error instanceof Error ? error.message : t.elementRemoveSlot,
                              )
                              await onChanged()
                            } finally {
                              onBusy(false)
                            }
                          })()
                        }
                      : null

                    return (
                      <SortableRow
                        key={rowId}
                        id={rowId}
                        draggable={Boolean(node) && ids.length > 1 && !busy}
                      >
                        {isFolder ? (
                          <div className="min-w-0 flex-1">
                            <p className="mb-2 text-[12.5px] text-ws-4">
                              {slot.folderName ??
                                subfolderName(slot.index, slot.label)}
                            </p>
                            <div className="border-l border-foreground/10 pl-3">
                              <ElementGroups
                                io={io}
                                form={form}
                                groups={slot.groups}
                                folder={folder}
                                dir={joinDir(
                                  dir,
                                  slot.folderName ??
                                    subfolderName(slot.index, slot.label),
                                )}
                                extraSlots={extraSlots}
                                onAddSlot={onAddSlot}
                                onRemoveSlot={onRemoveSlot}
                                busy={busy}
                                onBusy={onBusy}
                                onChanged={onChanged}
                                onPreview={onPreview}
                                onOpenText={onOpenText}
                              />
                            </div>
                          </div>
                        ) : (
                          <FileSlot
                            io={io}
                            form={form}
                            dir={dir}
                            slot={slot}
                            type={group.row.type}
                            node={node}
                            busy={busy}
                            isText={(form.fileTypes[group.row.type] ?? []).includes(
                              "txt",
                            )}
                            onBusy={onBusy}
                            onChanged={onChanged}
                            onPreview={onPreview}
                            onOpenText={() => onOpenText({ dir, slot, node })}
                            onRemoveRow={removeRow}
                          />
                        )}

                        {/* У подпапки кнопка снаружи: внутри неё своя форма со
                            своими строками, и корзина при каждой из них не
                            сказала бы, что убирают — вложенный файл или всю
                            подпапку. */}
                        {isFolder && removeRow ? (
                          <button
                            type="button"
                            title={t.elementRemoveSlot}
                            aria-label={t.elementRemoveSlot}
                            disabled={busy}
                            onClick={removeRow}
                            className="flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-[6px] border border-foreground/20 text-ws-4 hover:border-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </SortableRow>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {/* «+» — только у строки с `>=`: при `=` слотов ровно столько,
                сколько объявлено, и кнопка обещала бы несбыточное. */}
            {canAdd(group.row) ? (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  title={tf(t.elementAddMore, { label: group.row.label })}
                  aria-label={tf(t.elementAddMore, { label: group.row.label })}
                  disabled={busy}
                  onClick={() => {
                    if (isFolder) {
                      onBusy(true)
                      void (async () => {
                        try {
                          await io.makeFolder({
                            dir,
                            index: slots.length + 1,
                            label: group.row.label,
                          })
                          await onChanged()
                        } finally {
                          onBusy(false)
                        }
                      })()
                      return
                    }
                    onAddSlot(key)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-foreground/20 text-ws-3 hover:border-foreground/40 hover:text-ws-1"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
