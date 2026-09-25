"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { applyNameMasks } from "@/lib/tools/element/masks"
import {
  elementDisplayName,
  elementFolderName,
  freeElementName,
} from "@/lib/tools/element/names"
import { nameTemplateOf } from "@/lib/tools/element/site-form"
import {
  missingFolders,
  missingLabels,
  readElement,
  type Slot,
} from "@/lib/tools/element/slots"
import { cn } from "@/lib/utils"
import type { DriveFile } from "../types"
import { useWorkspace } from "../workspace-context"
import { createElementIO } from "./element-io"
import { ElementGroups, type ExtraSlots } from "./element-slots"
import { ElementTextEditor } from "./text-editor"
import { entriesOf } from "./tree"

/**
 * Диалог сборки элемента — папки в `IN`, из которой соберётся один ролик.
 *
 * Не карточка каталога инструментов, и это решение владельца (план §2):
 * инструменты правят то, что обработка уже положила в `OUT`, а этот диалог
 * работает в `IN` ДО обработки и заканчивается её запуском.
 *
 * Форма целиком приезжает из `options/onSiteFolderCheckForm.json` — готовым ответом «какую
 * форму показать». `options.json` для этого не разбирается: там граф, и читать
 * форму оттуда значило бы завести второго читателя модели нод (план §4.1).
 *
 * Всё делается сразу и само: папка заводится при открытии, структура подпапок —
 * следом, файлы кладутся по мере того, как их приносят. Не происходит только
 * одного — запуска: он ждёт подтверждения человеком.
 */

/** Что сейчас правит текстовый редактор. */
type TextTarget = {
  dir: string
  slot: Slot
  node: DriveFile | null
}

export function ElementDialog() {
  const ws = useWorkspace()
  const { t, elementTarget, elementForm, elementFormError, closeElementDialog } = ws

  const open = elementTarget !== null

  /** Имя папки элемента с дефисом — по нему узел ищется в свежем дереве. */
  const [folderName, setFolderName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [extraSlots, setExtraSlots] = useState<ExtraSlots>({})
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [ackFailed, setAckFailed] = useState(false)
  const [text, setText] = useState<TextTarget | null>(null)
  const [textValue, setTextValue] = useState("")
  const [textLoading, setTextLoading] = useState(false)
  /** Структуру заводим один раз на открытие, а не на каждое перечитывание дерева. */
  const structureRef = useRef<string | null>(null)
  /**
   * Имя, которое папка получит, когда её заведут. Пока она не создана, это
   * единственное, что от элемента существует.
   */
  const [plannedName, setPlannedName] = useState<string | null>(null)
  /** Обещание создания: не даёт двум одновременным заливкам завести две папки. */
  const creatingRef = useRef<Promise<string> | null>(null)

  const inFolder = ws.inFolder
  /** Узел папки элемента в свежем дереве: он пересоздаётся на каждое перечитывание. */
  const folder = useMemo(
    () =>
      folderName
        ? ((inFolder?.children ?? []).find(
            (child) => child.isFolder && child.name === folderName,
          ) ?? null)
        : null,
    [inFolder, folderName],
  )

  const refresh = useCallback(async () => {
    // С `await`: перенумерация и удаление строк перерисовывают форму из списка
    // файлов, и без ожидания она успевала бы отрисоваться по старому списку.
    await ws.refreshDrive()
  }, [ws])

  // Открытие: либо правим существующую папку, либо придумываем имя для новой.
  useEffect(() => {
    if (!open) {
      setFolderName(null)
      setPlannedName(null)
      setExtraSlots({})
      setAckFailed(false)
      setText(null)
      setRenaming(false)
      structureRef.current = null
      creatingRef.current = null
      return
    }
    if (elementTarget?.folder) {
      setFolderName(elementTarget.folder.name)
      return
    }
    if (!elementForm || plannedName) return

    /**
     * Имя придумываем сразу, а ПАПКУ НЕ ЗАВОДИМ.
     *
     * Открыть окно и передумать — обычное дело, и в `IN` не должно оставаться
     * пустых папок, которых человек не создавал осознанно: обе линии сборки их
     * пропускают, но глаза они мозолят, и удалять их приходится руками.
     * Поэтому до первого файла существует только имя в шапке — его можно
     * менять, — а папка появляется в хранилище с первым же действием,
     * которое что-то в неё кладёт (`ensureFolder`).
     */
    const base = applyNameMasks(nameTemplateOf(elementForm))
    setPlannedName(elementFolderName(base || t.elementTitleNew))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, elementTarget, elementForm])

  /**
   * Завести папку элемента, если её ещё нет.
   *
   * Свободное имя подбирается ЗДЕСЬ, а не при открытии: между открытием окна и
   * первым файлом в `IN` могла появиться папка с тем же именем — шаблон даёт
   * одинаковые имена внутри минуты.
   *
   * Обещание держится в ref, чтобы два слота, начатые разом, не завели две
   * папки: второй дождётся того же запроса, что и первый.
   */
  const ensureFolder = useCallback(async (): Promise<string> => {
    if (folderName) return folderName
    if (creatingRef.current) return creatingRef.current
    if (!ws.selectedId) throw new Error("No project selected")

    const projectId = ws.selectedId
    const taken = (inFolder?.children ?? []).map((child) => child.name)
    const name = freeElementName(
      taken,
      plannedName ?? elementFolderName(t.elementTitleNew),
    )

    const creating = (async () => {
      const res = await fetch(ws.source.folderUrl(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, folderPath: "IN" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        creatingRef.current = null
        throw new Error(data.message ?? "Failed")
      }
      setFolderName(name)
      setPlannedName(name)
      return name
    })()

    creatingRef.current = creating
    return creating
  }, [folderName, plannedName, inFolder, ws.selectedId, ws.source, t])

  const io = useMemo(
    () =>
      ws.selectedId
        ? createElementIO({
            projectId: ws.selectedId,
            ensureFolderPath: async () => `IN/${await ensureFolder()}`,
            fileUrl: ws.source.fileUrl,
            folderUrl: ws.source.folderUrl,
            foldersBatchUrl: ws.source.foldersBatchUrl,
          })
        : null,
    [ws.selectedId, ws.source, ensureFolder],
  )

  /**
   * Структура подпапок заводится целиком и сразу.
   *
   * Иначе форма росла бы под руками: человек видит слот, кладёт в него файл, и
   * только тогда появляется папка. Граф же ждёт объявленный состав, и показать
   * его надо весь, а не по мере заполнения.
   */
  useEffect(() => {
    if (!open || !io || !folder || !elementForm) return
    if (structureRef.current === folder.name) return
    structureRef.current = folder.name

    const missing = missingFolders(elementForm.rows, entriesOf(folder))
    if (missing.length === 0) return

    setBusy(true)
    void (async () => {
      try {
        // Одной пачкой и в том же порядке: родителя надо завести раньше
        // ребёнка. Раньше на каждую папку уходил свой сетевой круг, и окно
        // сборки открывалось дольше, чем читало дерево.
        await io.makeFolders(missing)
        await refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed")
      } finally {
        setBusy(false)
      }
    })()
  }, [open, io, folder, elementForm, refresh])

  const state = useMemo(
    () => (elementForm ? readElement(elementForm.rows, entriesOf(folder)) : null),
    [elementForm, folder],
  )

  const missing = useMemo(() => (state ? missingLabels(state) : []), [state])

  /**
   * Папка помечена дефисом и по ней упала задача.
   *
   * Дефис — общий канал: им помечают и «ещё собираем», и брак (план §10). По
   * имени эти состояния не различаются вообще, различитель — задача. Открыть
   * форму на упавшей папке, не сказав об ошибке, значит предложить человеку
   * «дособрать» то, что на самом деле сломалось.
   */
  const failed = folder ? ws.inStatusOf(folder) === "failed" : false

  const openText = useCallback(
    (target: TextTarget) => {
      setText(target)
      setTextValue("")
      if (!target.node || !ws.selectedId) return
      setTextLoading(true)
      void (async () => {
        try {
          const res = await fetch(ws.source.fileUrl(ws.selectedId!, target.node!.id))
          setTextValue(res.ok ? await res.text() : "")
        } catch {
          setTextValue("")
        } finally {
          setTextLoading(false)
        }
      })()
    },
    [ws.selectedId, ws.source],
  )

  const saveText = useCallback(async () => {
    if (!io || !text) return
    setBusy(true)
    try {
      await io.putText({
        dir: text.dir,
        index: text.slot.index,
        label: text.slot.label,
        text: textValue,
        originalName: text.slot.file?.originalName ?? null,
        replaces: text.slot.file?.name ?? null,
      })
      setText(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed")
    } finally {
      setBusy(false)
    }
  }, [io, text, textValue, refresh])

  /** Переименование папки: человек пишет имя без дефиса, дефис наш. */
  const commitName = useCallback(async () => {
    setRenaming(false)
    const next = nameDraft.trim()
    if (!next) return

    // Папки ещё нет — меняем только имя, которое она получит при создании.
    // Переименовывать нечего, и ходить за этим в сеть незачем.
    if (!folder) {
      setPlannedName(elementFolderName(next))
      return
    }

    if (!ws.selectedId || next === elementDisplayName(folder.name)) return
    const taken = (inFolder?.children ?? [])
      .filter((child) => child.id !== folder.id)
      .map((child) => child.name)
    const name = freeElementName(taken, elementFolderName(next))
    setBusy(true)
    try {
      const res = await fetch("/api/storage/v1/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: ws.selectedId, fileId: folder.id, name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.message ?? "Failed")
        return
      }
      setFolderName(name)
      structureRef.current = name
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [nameDraft, folder, inFolder, ws.selectedId, refresh])

  /**
   * «Запустить» — снять дефис с имени папки.
   *
   * Больше ничего: это `move`-событие внутри `IN`, и событийная линия заводит
   * задачу за секунды сама (docs/PIPELINE.md). Всё остальное уже сохранено —
   * подтверждения ждал только запуск.
   */
  const run = useCallback(async () => {
    if (!folder || !ws.selectedId) return
    setBusy(true)
    try {
      const res = await fetch("/api/storage/v1/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: ws.selectedId,
          fileId: folder.id,
          name: elementDisplayName(folder.name),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.message ?? "Failed")
        return
      }
      toast.success(t.elementRunStarted)
      closeElementDialog()
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [folder, ws.selectedId, t, closeElementDialog, refresh])

  /** В шапке — имя папки, а пока её нет, то имя, которое она получит. */
  const title =
    elementDisplayName(folder?.name ?? plannedName ?? "") || t.elementTitleNew

  /** Отказ открыться: чинить это надо в графе или обновлением программы. */
  const formError = elementFormError
    ? elementFormError.reason === "version"
      ? t.elementErrorVersion
      : elementFormError.reason === "duplicate-label"
        ? tf(t.elementErrorDuplicate, { label: elementFormError.label })
        : t.elementErrorBroken
    : null

  const ready = !formError && !(failed && !ackFailed)

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && closeElementDialog()}>
        <DialogContent
          aria-describedby={undefined}
          showClose={false}
          className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden border-border/60 bg-ws-raised p-0"
        >
          {/* Шапка: имя слева, запуск справа — как в макете. */}
          <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              {renaming ? (
                <Input
                  autoFocus
                  value={nameDraft}
                  aria-label={t.elementNameLabel}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void commitName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitName()
                    if (e.key === "Escape") setRenaming(false)
                  }}
                  className="h-8 max-w-sm border-foreground/10 bg-ws-control text-[15px] text-ws-1"
                />
              ) : (
                <DialogTitle
                  title={t.elementNameEdit}
                  onDoubleClick={() => {
                    // Имя правится и до создания папки: пока её нет, правится
                    // то имя, которое она получит.
                    setNameDraft(
                      elementDisplayName(folder?.name ?? plannedName ?? ""),
                    )
                    setRenaming(true)
                  }}
                  className="min-w-0 flex-1 cursor-text truncate text-[16px] font-semibold text-ws-1 decoration-foreground/30 hover:underline hover:decoration-dotted hover:underline-offset-4"
                >
                  {title}
                </DialogTitle>
              )}

              {ready ? (
                <Button
                  type="button"
                  onClick={() => void run()}
                  disabled={busy || missing.length > 0 || !folder}
                  className="shrink-0 bg-ws-action text-white hover:bg-ws-action-hover"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.elementRun}
                </Button>
              ) : null}
            </div>
          </DialogHeader>

          <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {formError ? (
              <p className="py-8 text-center text-[13px] leading-relaxed text-ws-3">
                {formError}
              </p>
            ) : failed && !ackFailed ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-[14px] text-ws-1">{t.elementErrorFailedTitle}</p>
                <p className="max-w-md text-[12.5px] leading-relaxed text-ws-4">
                  {t.elementErrorFailedBody}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAckFailed(true)}
                  className="border-foreground/10 bg-transparent text-ws-2 hover:bg-foreground/5 hover:text-ws-1"
                >
                  {t.elementOpenAnyway}
                </Button>
              </div>
            ) : !elementForm || !state || !io ? (
              <div className="flex justify-center py-12 text-ws-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                <ElementGroups
                  io={io}
                  form={elementForm}
                  groups={state.groups}
                  folder={folder}
                  dir=""
                  extraSlots={extraSlots}
                  onAddSlot={(key) =>
                    setExtraSlots((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
                  }
                  onRemoveSlot={(key) =>
                    setExtraSlots((prev) => ({
                      ...prev,
                      [key]: Math.max(0, (prev[key] ?? 0) - 1),
                    }))
                  }
                  busy={busy}
                  onBusy={setBusy}
                  onChanged={refresh}
                  onPreview={(node) => ws.openPreview(node)}
                  onOpenText={openText}
                />

                {state.extras.length > 0 ? (
                  <div className="mt-5 rounded-[9px] border border-warning/40 bg-warning/[0.06] p-3">
                    <p className="text-[13px] text-ws-1">{t.elementExtras}</p>
                    <p className="mt-0.5 text-[12px] text-ws-4">{t.elementExtrasHint}</p>
                    <div className="mt-2 flex flex-col gap-1">
                      {state.extras.map((extra) => {
                        const path = extra.dir ? `${extra.dir}/${extra.name}` : extra.name
                        return (
                          <div
                            key={path}
                            className="flex items-center gap-2 rounded-[7px] bg-ws-control px-2.5 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ws-2">
                              {path}
                            </span>
                            <button
                              type="button"
                              title={t.elementRemoveFile}
                              aria-label={t.elementRemoveFile}
                              disabled={busy}
                              onClick={() => {
                                const node = (folder?.children ?? []).find(
                                  (child) => !extra.dir && child.name === extra.name,
                                )
                                if (!node) return
                                setBusy(true)
                                void (async () => {
                                  try {
                                    await io.remove(node.id)
                                    await refresh()
                                  } finally {
                                    setBusy(false)
                                  }
                                })()
                              }}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ws-4 hover:bg-foreground/[0.07] hover:text-destructive"
                            >
                              <Trash2 className="h-[14px] w-[14px]" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="flex-none border-t border-foreground/[0.07] px-5 py-3">
            {/* Причина, по которой «Запустить» недоступна, — рядом с кнопкой:
                человек должен видеть её, а не упираться в серую кнопку. */}
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-[12.5px]",
                missing.length > 0 ? "text-ws-4" : "text-ws-3",
              )}
            >
              {!ready
                ? ""
                : missing.length > 0
                  ? tf(t.elementRunMissing, { what: missing.join(", ") })
                  : t.elementRunReady}
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Редактор текста — поверх формы: слот остаётся на виду, и видно, что
          правится именно он. */}
      <Dialog open={text !== null} onOpenChange={(next) => !next && setText(null)}>
        <DialogContent
          aria-describedby={undefined}
          showClose={false}
          className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden border-border/60 bg-ws-raised p-0"
        >
          <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
            <DialogTitle className="text-[15px] text-ws-1">
              {text?.slot.label ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
            {textLoading ? (
              <div className="flex justify-center py-12 text-ws-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <ElementTextEditor
                value={textValue}
                onChange={setTextValue}
                loadKey={text?.node?.id ?? text?.slot.index ?? 0}
                className="h-[46vh]"
              />
            )}
          </div>
          <DialogFooter className="flex-none gap-2 border-t border-foreground/[0.07] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              className="text-ws-2"
              onClick={() => setText(null)}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void saveText()}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.saveChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
