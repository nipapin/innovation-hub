"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, FileArchive, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { tf } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { fmtSize } from "./format"
import { useWorkspace } from "./workspace-context"

type ArchivePartDto = {
  index: number
  name: string
  fileCount: number
  contentBytes: number
  archiveBytes: number
  oversize: boolean
}

type ArchivePlanDto = {
  baseName: string
  fileCount: number
  totalBytes: number
  partSize: number
  version: string
  parts: ArchivePartDto[]
}

const MIB = 1024 * 1024
/** Верхняя граница — предел, ради которого папка и разбивается на части. */
const PART_SIZE_OPTIONS = [512 * MIB, 1024 * MIB, 2048 * MIB]
const DEFAULT_PART_SIZE = 2048 * MIB
/**
 * Пауза между запусками частей в «Скачать все». Браузер всё равно поставит их
 * в очередь, но с паузой видно, что началось, и сервер не получает пять
 * гигабайтных потоков в одну секунду.
 */
const STAGGER_MS = 1200

/**
 * Скачивание папки архивом.
 *
 * Сначала план, потом байты: папка проекта не обязана уместиться в один архив,
 * и человек должен увидеть, сколько частей получится, прежде чем запускать
 * многочасовую загрузку. Части независимы — каждая распаковывается сама.
 *
 * Серверная сторона — `lib/storage/archive.ts` и `/api/storage/v1/archive`.
 */
export function ArchiveDialog() {
  const { t, source, selectedId, archiveTarget, closeArchiveDialog } =
    useWorkspace()

  const [partSize, setPartSize] = useState(DEFAULT_PART_SIZE)
  const [plan, setPlan] = useState<ArchivePlanDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<number[]>([])

  const open = archiveTarget !== null

  const buildParams = useCallback(
    (size: number) => {
      const params = new URLSearchParams()
      if (selectedId) params.set("projectId", selectedId)
      if (archiveTarget?.folderId) {
        params.set("folderId", archiveTarget.folderId)
      } else {
        params.set("folderPath", archiveTarget?.folderPath ?? "")
      }
      params.set("partSize", String(size))
      return params
    },
    [selectedId, archiveTarget],
  )

  const loadPlan = useCallback(
    async (size: number): Promise<ArchivePlanDto | null> => {
      if (!selectedId || !archiveTarget) return null
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(source.archivePlanUrl(buildParams(size)))
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setError(data?.message ?? t.archiveFailed)
          return null
        }
        setPlan(data.plan as ArchivePlanDto)
        return data.plan as ArchivePlanDto
      } catch {
        setError(t.archiveFailed)
        return null
      } finally {
        setLoading(false)
      }
    },
    [selectedId, archiveTarget, source, buildParams, t],
  )

  useEffect(() => {
    if (!open) {
      setPlan(null)
      setStarted([])
      setError(null)
      return
    }
    void loadPlan(partSize)
  }, [open, partSize, loadPlan])

  const startPart = useCallback(
    (part: ArchivePartDto, version: string, size: number) => {
      const params = buildParams(size)
      params.set("part", String(part.index))
      params.set("version", version)

      // Скачивание, а не переход: Content-Disposition у роута — attachment,
      // поэтому страница остаётся на месте, а диалог можно не закрывать.
      const link = document.createElement("a")
      link.href = source.archivePartUrl(params)
      link.rel = "noopener"
      document.body.appendChild(link)
      link.click()
      link.remove()

      setStarted((prev) => (prev.includes(part.index) ? prev : [...prev, part.index]))
      toast.success(tf(t.archiveStarted, { name: part.name }))
    },
    [buildParams, source, t],
  )

  /**
   * Перед запуском план перечитывается: между «посмотрел» и «нажал» папку
   * могли пополнить из программы, и тогда нумерация частей уже другая. Сервер
   * такой запрос отклонит по `version`, но объяснить это лучше здесь, чем
   * отдать вкладку с JSON-ошибкой вместо файла.
   */
  const withFreshPlan = useCallback(
    async (run: (fresh: ArchivePlanDto) => void) => {
      const known = plan?.version
      const fresh = await loadPlan(partSize)
      if (!fresh) return
      if (known && fresh.version !== known) {
        toast.warning(t.archiveChanged)
        setStarted([])
        return
      }
      run(fresh)
    },
    [plan, loadPlan, partSize, t],
  )

  const downloadPart = (index: number) =>
    void withFreshPlan((fresh) => {
      const part = fresh.parts.find((candidate) => candidate.index === index)
      if (part) startPart(part, fresh.version, partSize)
    })

  const downloadAll = () =>
    void withFreshPlan((fresh) => {
      fresh.parts.forEach((part, i) => {
        window.setTimeout(
          () => startPart(part, fresh.version, partSize),
          i * STAGGER_MS,
        )
      })
    })

  const partsLabel = useMemo(() => {
    const count = plan?.parts.length ?? 0
    return count === 1 ? t.archivePartsOne : tf(t.archivePartsMany, { count })
  }, [plan, t])

  const empty = plan !== null && plan.parts.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeArchiveDialog()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-lg border-border/60 bg-ws-raised p-0"
      >
        <DialogHeader className="border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[16px] font-semibold text-ws-1">
            <FileArchive className="h-[18px] w-[18px] opacity-80" />
            {t.archiveTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <div className="truncate text-[14px] text-ws-1">
              {archiveTarget?.name}
            </div>
            <div className="text-[12px] text-ws-3">
              {loading && !plan ? (
                t.archiveCounting
              ) : plan ? (
                <>
                  {tf(t.archiveSummary, {
                    files: plan.fileCount,
                    size: fmtSize(plan.totalBytes),
                  })}
                  {" · "}
                  {partsLabel}
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ws-3">{t.archivePartSize}</span>
            <div className="flex gap-1">
              {PART_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={loading}
                  onClick={() => setPartSize(size)}
                  className={cn(
                    "rounded-[7px] border px-2 py-1 text-[12px] disabled:opacity-50",
                    size === partSize
                      ? "border-ws-select bg-foreground/[0.07] text-ws-1"
                      : "border-foreground/10 text-ws-3 hover:bg-foreground/[0.05]",
                  )}
                >
                  {fmtSize(size)}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="text-[12px] text-destructive">{error}</div>
          ) : null}

          {empty ? (
            <div className="text-[13px] text-ws-3">{t.archiveEmpty}</div>
          ) : null}

          {plan && plan.parts.length > 0 ? (
            <div className="scrollbar-elegant max-h-[260px] space-y-1 overflow-y-auto">
              {plan.parts.map((part) => (
                <div
                  key={part.index}
                  className="flex items-center gap-3 rounded-[9px] border border-foreground/[0.07] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ws-1">
                      {plan.parts.length > 1
                        ? tf(t.archivePartLabel, {
                            index: part.index,
                            total: plan.parts.length,
                          })
                        : part.name}
                    </div>
                    <div className="text-[11px] text-ws-4">
                      {fmtSize(part.archiveBytes)}
                      {" · "}
                      {tf(t.archiveSummary, {
                        files: part.fileCount,
                        size: fmtSize(part.contentBytes),
                      })}
                    </div>
                    {part.oversize ? (
                      <div className="text-[11px] text-warning">
                        {t.archiveOversize}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={loading}
                    onClick={() => downloadPart(part.index)}
                    className={cn(
                      "h-8 shrink-0 gap-1.5 px-2.5 text-[12px]",
                      started.includes(part.index) ? "text-ws-4" : "text-ws-2",
                    )}
                  >
                    <Download className="h-4 w-4" />
                    {t.archiveDownload}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-ws-4">
            {t.archiveNote}
          </p>
        </div>

        <DialogFooter className="border-t border-foreground/[0.07] px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            className="text-ws-2"
            onClick={closeArchiveDialog}
          >
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={loading || !plan || plan.parts.length === 0}
            onClick={downloadAll}
            className="gap-1.5 bg-ws-action text-white hover:bg-ws-action-hover"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {plan && plan.parts.length > 1
              ? t.archiveDownloadAll
              : t.archiveDownload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
