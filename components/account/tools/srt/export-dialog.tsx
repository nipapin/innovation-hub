"use client"

import { useEffect, useMemo, useState } from "react"
import { Download } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  buildExport,
  countExportedCues,
  type ExportFormat,
  type ExportLayout,
} from "@/lib/tools/dialog/export"
import { buildZip } from "@/lib/tools/dialog/zip"
import { cn } from "@/lib/utils"
import { downloadFile, ZIP_MIME } from "../shared/download"
import { languageName } from "../shared/language-picker"
import { useSrt } from "./srt-context"

/** `null` в списке языков — оригинал. */
type Lang = string | null

/**
 * Расширенный экспорт.
 *
 * Быстрые пункты меню покрывают частые случаи, но «эти четыре дорожки, в WebVTT,
 * на испанском и французском» перебором пунктов не выражается. Здесь человек
 * собирает выгрузку сам и до нажатия видит, что именно получится: имя файла или
 * архива, сколько в нём файлов и реплик.
 */
export function SrtExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const srt = useSrt()

  const [format, setFormat] = useState<ExportFormat>(srt.prefs.exportFmt)
  const [langs, setLangs] = useState<Lang[]>([srt.lang])
  const [layout, setLayout] = useState<ExportLayout>("per-track")
  const [tracks, setTracks] = useState<string[]>(() => srt.doc.tracks.map((x) => x.id))

  // Открыли окно — начинаем с того, что стоит в топбаре и настройках: человек
  // уже выбрал язык и формат там, переспрашивать заново незачем.
  useEffect(() => {
    if (!open) return
    setFormat(srt.prefs.exportFmt)
    setLangs([srt.lang])
    setTracks(srt.doc.tracks.map((track) => track.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** Оригинал и все переводы документа — то, из чего выбирают. */
  const available: Lang[] = useMemo(
    () => [null, ...srt.doc.languages.targets],
    [srt.doc.languages.targets],
  )

  const result = useMemo(
    () => buildExport(srt.doc, srt.taskName, { format, langs, trackIds: tracks, layout }),
    [format, langs, layout, srt.doc, srt.taskName, tracks],
  )
  const cues = useMemo(() => countExportedCues(srt.doc, tracks), [srt.doc, tracks])

  const toggleLang = (lang: Lang) => {
    setLangs((current) =>
      current.some((item) => item === lang)
        ? current.filter((item) => item !== lang)
        : available.filter((item) => item === lang || current.includes(item)),
    )
  }

  const toggleTrack = (trackId: string) => {
    setTracks((current) =>
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : current.concat([trackId]),
    )
  }

  const run = () => {
    if (!result) return
    if (result.kind === "file") downloadFile(result.name, result.text, result.mime)
    else downloadFile(result.name, buildZip(result.entries, new Date()), ZIP_MIME)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.srtExportTitle}</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-4">
          {/*
            Языки первыми и переключателями, а не одним выбором: экспортировать
            оригинал вместе с двумя переводами — обычное дело, и выбор «или-или»
            заставлял бы открывать окно трижды.
          */}
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
                {t.srtExportLanguages}
              </h3>
              <span className="text-[12px] text-ws-5">{t.srtExportLanguagesHint}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {available.map((lang) => (
                <LangToggle
                  key={lang ?? "orig"}
                  on={langs.includes(lang)}
                  label={lang ? languageName(lang, uiLang) : t.srtColOriginal}
                  code={lang ?? srt.doc.languages.original}
                  onClick={() => toggleLang(lang)}
                />
              ))}
            </div>
          </section>

          <section className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[13px] text-ws-2">{t.srtExportFormat}</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="h-[32px] w-full max-w-[280px] rounded border border-foreground/[0.10] bg-ws-well px-2 text-[13px] text-ws-2 outline-none focus:border-ws-action"
            >
              <option value="srt" className="bg-ws-panel">
                {t.srtFmtSrt}
              </option>
              <option value="srt-bom" className="bg-ws-panel">
                {t.srtFmtSrtBom}
              </option>
              <option value="vtt" className="bg-ws-panel">
                {t.srtFmtVtt}
              </option>
            </select>
          </section>

          <section className="grid grid-cols-[110px_1fr] items-start gap-3">
            <span className="pt-1.5 text-[13px] text-ws-2">{t.srtExportLayout}</span>
            <div className="flex flex-col gap-1.5">
              <LayoutOption
                active={layout === "per-track"}
                label={t.srtExportLayoutPerTrack}
                onClick={() => setLayout("per-track")}
              />
              <LayoutOption
                active={layout === "single"}
                label={t.srtExportLayoutSingle}
                onClick={() => setLayout("single")}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
                {t.srtExportTracks}
              </h3>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTracks(srt.doc.tracks.map((track) => track.id))}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline"
              >
                {t.srtExportSelectAll}
              </button>
              <button
                type="button"
                onClick={() => setTracks([])}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline"
              >
                {t.srtExportSelectNone}
              </button>
            </div>

            <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
              {srt.doc.tracks.map((track) => {
                const own = countExportedCues(srt.doc, [track.id])
                return (
                  <label
                    key={track.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-foreground/[0.06] px-3 py-2 last:border-b-0 hover:bg-foreground/[0.03]"
                  >
                    <input
                      type="checkbox"
                      checked={tracks.includes(track.id)}
                      onChange={() => toggleTrack(track.id)}
                      className="h-4 w-4 flex-none accent-ws-action"
                    />
                    <span
                      className="h-3.5 w-[3px] flex-none rounded-sm"
                      style={{ background: track.color }}
                    />
                    <span className="w-7 flex-none font-mono text-[12px] tabular-nums text-ws-4">
                      {String(track.no).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ws-1">
                      {track.name}
                    </span>
                    <span className="flex-none text-[12px] tabular-nums text-ws-4">
                      {tf(t.srtCuesShort, { count: own })}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        </div>

        <div className="flex flex-none items-center gap-3 border-t border-foreground/[0.07] px-5 py-3.5">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ws-3">
            {!result
              ? t.srtExportNothing
              : result.kind === "file"
                ? tf(t.srtExportSummaryFile, { name: result.name, cues })
                : tf(t.srtExportSummaryArchive, {
                    name: result.name,
                    files: result.files,
                    cues,
                  })}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={!result}
            className="flex h-[34px] flex-none items-center gap-2 rounded bg-ws-action px-4 text-[13px] font-semibold text-white hover:bg-ws-action-hover disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {t.srtExportRun}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Язык как переключатель: нажал — горит, значит выгружаем; отжал — не выгружаем.
 * Не «или-или», потому что оригинал и переводы обычно нужны вместе.
 */
function LangToggle({
  on,
  label,
  code,
  onClick,
}: {
  on: boolean
  label: string
  code: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded border px-3 text-[13px]",
        on
          ? "border-ws-action bg-ws-action/[0.18] text-ws-1"
          : "border-foreground/[0.10] text-ws-4 hover:border-foreground/25 hover:text-ws-2",
      )}
    >
      {label}
      <span className={cn("font-mono text-[11px]", on ? "text-ws-accent" : "text-ws-5")}>
        {code}
      </span>
    </button>
  )
}

function LayoutOption({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded border px-3 py-2 text-left text-[13px]",
        active
          ? "border-ws-action bg-ws-action/[0.12] text-ws-1"
          : "border-foreground/[0.07] text-ws-2 hover:bg-ws-hover",
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border",
          active ? "border-ws-action" : "border-foreground/25",
        )}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-ws-action" /> : null}
      </span>
      {label}
    </button>
  )
}
