"use client"

import { useCallback, useState } from "react"
import { FileText, FileCode2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { needsDownloadChoice, textKind } from "@/lib/text-formats/kind"
import { plainTextOf } from "@/lib/text-formats/plain"

/**
 * Вопрос перед скачиванием txt/csv/tsv (docs/TEXT_FORMATS_PLAN.md §3):
 * «Только текст» — разметка снимается в браузере, файл собирается из Blob под
 * тем же именем; «Как есть» — обычное скачивание, как было.
 *
 * Остальные форматы качаются сразу, без вопроса.
 */

export type DownloadTarget = {
  name: string
  /** Адрес тела файла с того же источника — для обоих вариантов вопроса. */
  textUrl: string
  /** Обычное скачивание — для форматов без вопроса. */
  asIs: () => void
}

/** Скачать Blob под именем — через временную ссылку. */
function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  downloadHref(href, name)
  // Сразу отзывать нельзя: часть браузеров начинает скачивание асинхронно.
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/** Скачивание по адресу с атрибутом `download` — замена `<a href download>`. */
export function downloadHref(href: string, name: string) {
  const link = document.createElement("a")
  link.href = href
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function DownloadChoice({
  target,
  onClose,
}: {
  target: DownloadTarget | null
  onClose: () => void
}) {
  const { t } = useI18n()
  // csv/tsv: «только текст» — это таблица без разметки в ячейках.
  const table = target ? textKind(target.name) === "table" : false
  const [busy, setBusy] = useState(false)

  /**
   * Оба варианта качают тело через наш адрес и отдают Blob. «Как есть» не
   * обычной ссылкой: в производстве и чате она уводит редиректом на хранилище,
   * другой источник, где `download` не действует, — txt открылся бы во вкладке
   * вместо скачивания.
   */
  const fetchAndSave = async (strip: boolean) => {
    if (!target) return
    setBusy(true)
    try {
      const res = await fetch(target.textUrl, { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      if (strip) {
        const text = plainTextOf(target.name, await res.text())
        saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), target.name)
      } else {
        saveBlob(await res.blob(), target.name)
      }
      onClose()
    } catch {
      toast.error(t.textDownloadFailed)
    } finally {
      setBusy(false)
    }
  }

  const option =
    "flex w-full items-start gap-3 rounded-[10px] border border-foreground/10 bg-ws-control px-3 py-2.5 text-left hover:bg-ws-hover disabled:opacity-50"

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="pr-8 text-[15px]">
          {tf(t.textDownloadTitle, { name: target?.name ?? "" })}
        </DialogTitle>
        <DialogDescription className="text-[12.5px] text-ws-4">
          {t.textDownloadHint}
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy} onClick={() => void fetchAndSave(true)} className={option}>
            {busy ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ws-3" />
            ) : (
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ws-3" />
            )}
            <span>
              <span className="block text-[13px] text-ws-1">
                {table ? t.textDownloadPlainTable : t.textDownloadPlain}
              </span>
              <span className="block text-[12px] text-ws-4">
                {table ? t.textDownloadPlainTableHint : t.textDownloadPlainHint}
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void fetchAndSave(false)}
            className={option}
          >
            <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-ws-3" />
            <span>
              <span className="block text-[13px] text-ws-1">{t.textDownloadAsIs}</span>
              <span className="block text-[12px] text-ws-4">{t.textDownloadAsIsHint}</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Скачивание с вопросом там, где он нужен. Возвращает `download` и окно,
 * которое надо положить в разметку рядом (вне выпадающих меню: меню
 * закрывается и унесло бы окно с собой).
 */
export function useDownloadChoice() {
  const [target, setTarget] = useState<DownloadTarget | null>(null)

  const download = useCallback((next: DownloadTarget) => {
    if (needsDownloadChoice(next.name)) setTarget(next)
    else next.asIs()
  }, [])

  const dialog = <DownloadChoice target={target} onClose={() => setTarget(null)} />
  return { download, dialog }
}
