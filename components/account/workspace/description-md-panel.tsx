"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Maximize2, Pencil } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { DescriptionDialog } from "./description-dialog"
import { useWorkspace } from "./workspace-context"

/**
 * Развёрнутое описание проекта — `options/description.md`.
 *
 * В панели оно показано, а не отредактировано, и показано отрисованным: файл
 * пишется в программе, где у автора тулбар и превью, а здесь его читают.
 * Описание занимает закладку целиком и прокручивается внутри себя; целиком, во
 * весь экран, открывается кнопкой в правом верхнем углу — нижняя панель бывает
 * низкой, а бриф длинным.
 *
 * Правка живёт в том же окне и только там, где источник её разрешает
 * (`can.editDescription` — сейчас админский «Конвейер»). Формат файла и
 * ограничения — docs/DESCRIPTION_FORMAT.md.
 */
export function DescriptionMdPanel({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const { t } = useI18n()
  const { source } = useWorkspace()
  const buildUrl = source.descriptionMdUrl
  const canEdit = source.can.editDescription

  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState("")
  const [failed, setFailed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEditing, setDialogEditing] = useState(false)

  /** Гонка при быстром переключении проектов: ответ старого не должен перезаписать новый. */
  const requestedFor = useRef(projectId)

  useEffect(() => {
    if (!buildUrl) return
    requestedFor.current = projectId
    setLoading(true)
    setFailed(false)
    void (async () => {
      try {
        const res = await fetch(buildUrl(projectId), { cache: "no-store" })
        if (requestedFor.current !== projectId) return
        if (!res.ok) {
          setBody("")
          setFailed(true)
          return
        }
        const data = await res.json()
        setBody(typeof data.body === "string" ? data.body : "")
      } catch {
        if (requestedFor.current === projectId) setFailed(true)
      } finally {
        if (requestedFor.current === projectId) setLoading(false)
      }
    })()
  }, [buildUrl, projectId])

  if (!buildUrl) return null

  const openDialog = (editing: boolean) => {
    setDialogEditing(editing)
    setDialogOpen(true)
  }

  const actionClass =
    "flex items-center gap-1.5 rounded-[9px] border border-foreground/10 px-3 py-1.5 text-[12.5px] text-ws-2 hover:bg-foreground/5 disabled:opacity-60"

  return (
    <section className="flex h-full min-h-[180px] flex-col">
      {/* Кнопки над описанием, справа: заголовка у закладки нет — её название
          написано на самой закладке, а путь к файлу автору и так известен. */}
      <div className="flex shrink-0 items-center justify-end gap-2 pb-2.5">
        {body ? (
          <button
            type="button"
            onClick={() => openDialog(false)}
            disabled={loading}
            className={actionClass}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {t.descExpand}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => openDialog(true)}
            disabled={loading}
            className={actionClass}
          >
            <Pencil className="h-3.5 w-3.5" />
            {body ? t.descEdit : t.descCreate}
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-ws-4">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : body ? (
        <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-foreground/[0.07] bg-ws-control p-4">
          <MarkdownView>{body}</MarkdownView>
        </div>
      ) : (
        <p className="text-[13px] text-ws-4">
          {failed ? t.descLoadError : canEdit ? t.descMdEmpty : t.descMdEmptyReadonly}
        </p>
      )}

      <DescriptionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        projectName={projectName}
        body={body}
        url={buildUrl(projectId)}
        canEdit={canEdit}
        startEditing={dialogEditing}
        onSaved={setBody}
      />
    </section>
  )
}
