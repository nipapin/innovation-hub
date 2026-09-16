"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * Описание проекта во весь экран: чтение и — там, где это позволено, — правка.
 *
 * Одно окно на два режима, а не два окна: читают и правят один и тот же файл, и
 * переключение «посмотрел → поправил → посмотрел» не должно закрывать окно.
 *
 * Правка есть только в админском «Конвейере» (`can.editDescription`): у файла
 * два писателя — программа и сайт, и третий, кабинетный, потребовал бы сверки
 * версий на каждом сохранении.
 */
export interface DescriptionDialogProps {
  open: boolean
  onClose: () => void
  /** Название проекта — в заголовке окна. */
  projectName: string
  /** Текст на момент открытия. */
  body: string
  /** Адрес роута описания: GET для сверки, PUT для записи. */
  url: string
  canEdit: boolean
  /** Открыть сразу в режиме правки. */
  startEditing?: boolean
  /** Сохранилось — обновить текст в панели, не перечитывая файл. */
  onSaved: (body: string) => void
}

export function DescriptionDialog({
  open,
  onClose,
  projectName,
  body,
  url,
  canEdit,
  startEditing,
  onSaved,
}: DescriptionDialogProps) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [saving, setSaving] = useState(false)
  /** Что лежало в файле на момент открытия — с этим сверяемся перед записью. */
  const loaded = useRef(body)
  /** Меняется при загрузке содержимого извне — сбрасывает историю редактора. */
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    loaded.current = body
    setDraft(body)
    setLoadKey((k) => k + 1)
    setEditing(Boolean(startEditing) && canEdit)
  }, [open, body, startEditing, canEdit])

  const dirty = editing && draft !== loaded.current

  const save = useCallback(async () => {
    setSaving(true)
    try {
      // Писателей у файла двое: сайт и программа. Молча затирать чужую правку
      // нельзя — перечитываем и спрашиваем (контракт §9). ETag у роута нет,
      // поэтому сверка идёт по содержимому, как и в программе.
      const fresh = await fetch(url, { cache: "no-store" })
      if (fresh.ok) {
        const data = await fresh.json()
        const current = typeof data.body === "string" ? data.body : ""
        if (current !== loaded.current && !window.confirm(t.descConflict)) return
      }

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.message ?? t.descSaveError)
        return
      }

      loaded.current = draft
      onSaved(draft)
      setEditing(false)
      toast.success(t.descSaved)
    } catch {
      toast.error(t.descServerUnavailable)
    } finally {
      setSaving(false)
    }
  }, [draft, onSaved, t, url])

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(t.descUnsaved)) return
    onClose()
  }, [dirty, onClose, t])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent
        aria-describedby={undefined}
        // Своя геометрия вместо max-w-lg: описание — документ, его читают в
        // колонке нормальной ширины, а правят рядом с превью.
        className={cn(
          "flex h-[88vh] max-h-[88vh] w-[min(1180px,94vw)] max-w-none flex-col gap-0",
          "border-border/60 bg-ws-raised p-0",
          // Своя кнопка закрытия спрашивает про несохранённое; штатная в углу
          // закрыла бы окно молча.
          "[&>button]:hidden",
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-foreground/[0.07] px-5 py-3.5">
          <FileText className="h-[18px] w-[18px] shrink-0 text-ws-accent" />
          <DialogTitle className="truncate text-[15px] font-semibold text-ws-1">
            {t.descMdTitle} — {projectName}
          </DialogTitle>
          <span
            className="hidden shrink-0 text-[11px] text-ws-5 sm:inline"
            title="options/description.md"
          >
            options/description.md
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canEdit && !editing ? (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-ws-2"
                onClick={() => {
                  setDraft(loaded.current)
                  setLoadKey((k) => k + 1)
                  setEditing(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                {body ? t.descEdit : t.descCreate}
              </Button>
            ) : null}

            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-ws-2"
                  disabled={saving}
                  onClick={() => {
                    if (dirty && !window.confirm(t.descUnsaved)) return
                    setDraft(loaded.current)
                    setLoadKey((k) => k + 1)
                    setEditing(false)
                  }}
                >
                  {t.cancel}
                </Button>
                <Button
                  size="sm"
                  disabled={saving || !dirty}
                  className="gap-1.5 bg-ws-action text-white hover:bg-ws-action-hover"
                  onClick={() => void save()}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t.saveChanges}
                </Button>
              </>
            ) : null}

            <button
              type="button"
              onClick={requestClose}
              aria-label={t.cancel}
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ws-3 hover:bg-foreground/[0.07] hover:text-ws-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {editing ? (
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            loadKey={loadKey}
            className="m-3 flex-1 border-foreground/[0.07]"
          />
        ) : (
          <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {body ? (
              <MarkdownView measure={820}>{body}</MarkdownView>
            ) : (
              <p className="text-[13px] text-ws-4">
                {canEdit ? t.descMdEmpty : t.descMdEmptyReadonly}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
