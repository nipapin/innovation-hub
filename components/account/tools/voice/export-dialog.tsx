"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2, TriangleAlert } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { takeStartMs } from "@/lib/tools/dialog/voice"
import { buildZip, type ZipEntry } from "@/lib/tools/dialog/zip"
import {
  countExportedTakes,
  planVoiceExport,
  type VoiceExportLayout,
  type VoiceExportPlan,
} from "@/lib/tools/voice/export"
import { renderMix } from "@/lib/tools/voice/render"
import { encodeWav, WAV_MIME } from "@/lib/tools/voice/wav"
import { cn } from "@/lib/utils"
import { downloadFile, ZIP_MIME } from "../shared/download"
import { languageName } from "../shared/language-picker"
import { useVoice } from "./voice-context"

/**
 * Чего хочет человек от экспорта.
 *
 * Быстрые пункты меню и расширенное окно — один и тот же путь: пункт приходит с
 * готовым набором и `autoRun`, окно — с набором по умолчанию и без него. Так
 * выгрузка везде считается и собирается одним куском кода, а не тремя похожими.
 */
export type VoiceExportRequest = {
  layout: VoiceExportLayout
  langs: string[]
  autoRun: boolean
}

/**
 * Экспорт озвучки.
 *
 * Устроен как расширенный экспорт титров — языки переключателями, дорожки
 * чекбоксами, раскладка выбором, — но с одним важным отличием: здесь выгрузка не
 * складывается из текста, а **сводится из звука**. Каждый тейк надо скачать,
 * декодировать и положить на своё место, поэтому окно показывает ход и не даёт
 * закрыть себя на середине.
 */
export function VoiceExportDialog({
  request,
  onClose,
}: {
  request: VoiceExportRequest | null
  onClose: () => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const voice = useVoice()

  const [langs, setLangs] = useState<string[]>([])
  const [layout, setLayout] = useState<VoiceExportLayout>("per-track")
  const [tracks, setTracks] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [failed, setFailed] = useState<string | null>(null)

  const available = useMemo(
    () => [voice.doc.languages.original, ...voice.doc.languages.targets],
    [voice.doc.languages],
  )
  const allTracks = useMemo(() => voice.doc.tracks.map((track) => track.id), [voice.doc.tracks])

  // Всё, что нужно выгрузке, но что не должно перезапускать её на каждый кадр:
  // документ меняется от автосохранения и слияния, а начатое сведение это
  // прерывать не должно.
  const live = useRef({ voice, t, allTracks })
  live.current = { voice, t, allTracks }

  useEffect(() => {
    if (!request) return
    setLangs(request.langs)
    setLayout(request.layout)
    setTracks(live.current.allTracks)
    setRunning(false)
    setProgress({ done: 0, total: 0 })
    setFailed(null)
  }, [request])

  // Быстрый пункт меню: набор уже задан, спрашивать нечего — окно открывается
  // сразу с ходом работы. План берётся из запроса, а не из состояния: иначе
  // выгрузка ушла бы на том, что стояло в полях от прошлого раза.
  useEffect(() => {
    if (!request?.autoRun) return
    void execute({
      langs: request.langs,
      trackIds: live.current.allTracks,
      layout: request.layout,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const result = useMemo(
    () => planVoiceExport(voice.doc, voice.taskName, { langs, trackIds: tracks, layout }),
    [langs, layout, tracks, voice.doc, voice.taskName],
  )

  /**
   * Собрать и отдать.
   *
   * Порядок важен: сначала сводится всё, и только потом файл уходит в браузер.
   * Отдавать по одному значило бы оставить человека с половиной архива, если на
   * третьем файле оборвётся сеть.
   */
  const execute = async (plan: VoiceExportPlan) => {
    const { voice: api, t: dict } = live.current
    const built = planVoiceExport(api.doc, api.taskName, plan)
    if (!built) {
      setFailed(dict.voiceExportNothing)
      return
    }

    setRunning(true)
    setFailed(null)
    setProgress({ done: 0, total: built.takes })

    try {
      let done = 0
      const files: { name: string; bytes: Uint8Array }[] = []

      for (const piece of built.pieces) {
        const sources = []
        for (const { cue, take } of piece.sources) {
          const url = await api.signTake(take)
          if (!url) throw new Error(tf(dict.voiceExportNoFile, { file: take.file }))
          sources.push({
            url,
            startMs: takeStartMs(cue, take),
            rate: take.rate,
            gainDb: take.gainDb,
          })
        }
        const mix = await renderMix(sources, {
          durationMs: api.durationMs,
          onProgress: () => setProgress({ done: (done += 1), total: built.takes }),
        })
        files.push({ name: piece.name, bytes: encodeWav(mix.samples, mix.sampleRate) })
      }

      if (built.kind === "file") {
        downloadFile(built.name, files[0].bytes, WAV_MIME)
      } else {
        const entries: ZipEntry[] = files.map((file) => ({
          name: file.name,
          bytes: file.bytes,
        }))
        downloadFile(built.name, buildZip(entries, new Date()), ZIP_MIME)
      }
      setRunning(false)
      onClose()
    } catch (error) {
      setRunning(false)
      setFailed(error instanceof Error ? error.message : dict.voiceExportFailed)
    }
  }

  const toggleLang = (lang: string) => {
    setLangs((current) =>
      current.includes(lang)
        ? current.filter((item) => item !== lang)
        : available.filter((item) => item === lang || current.includes(item)),
    )
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(next) => {
        // Пока идёт сведение, закрывать нельзя: окно — единственное место, где
        // видно ход, а прервать декодирование на полпути всё равно нечем.
        if (!next && !running) onClose()
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.voiceExportTitle}</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
                {t.srtExportLanguages}
              </h3>
              <span className="text-[12px] text-ws-5">{t.voiceExportLanguagesHint}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {available.map((code) => {
                const on = langs.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={on}
                    disabled={running}
                    onClick={() => toggleLang(code)}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded border px-3 text-[13px] disabled:opacity-50",
                      on
                        ? "border-ws-action bg-ws-action/[0.18] text-ws-1"
                        : "border-foreground/[0.10] text-ws-4 hover:border-foreground/25 hover:text-ws-2",
                    )}
                  >
                    {languageName(code, uiLang)}
                    <span
                      className={cn("font-mono text-[11px]", on ? "text-ws-accent" : "text-ws-5")}
                    >
                      {code}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/*
            Формат не выбирается: сведение идёт в браузере, а он умеет отдать
            только несжатый звук. MP3 и остальное появятся, когда рендер уедет на
            сервер с ffmpeg.
          */}
          <section className="grid grid-cols-[110px_1fr] items-baseline gap-3">
            <span className="text-[13px] text-ws-2">{t.srtExportFormat}</span>
            <span className="text-[13px] text-ws-4">
              {t.voiceFmtWav}
              <span className="ml-2 text-[12px] text-ws-5">{t.voiceExportWavOnly}</span>
            </span>
          </section>

          <section className="grid grid-cols-[110px_1fr] items-start gap-3">
            <span className="pt-1.5 text-[13px] text-ws-2">{t.srtExportLayout}</span>
            <div className="flex flex-col gap-1.5">
              <LayoutOption
                active={layout === "per-track"}
                disabled={running}
                label={t.voiceExportLayoutPerTrack}
                onClick={() => setLayout("per-track")}
              />
              <LayoutOption
                active={layout === "single"}
                disabled={running}
                label={t.voiceExportLayoutSingle}
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
                disabled={running}
                onClick={() => setTracks(allTracks)}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline disabled:opacity-50"
              >
                {t.srtExportSelectAll}
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => setTracks([])}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline disabled:opacity-50"
              >
                {t.srtExportSelectNone}
              </button>
            </div>

            <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
              {voice.doc.tracks.map((track) => {
                const takes = countExportedTakes(voice.doc, track.id, langs)
                return (
                  <label
                    key={track.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-foreground/[0.06] px-3 py-2 last:border-b-0 hover:bg-foreground/[0.03]"
                  >
                    <input
                      type="checkbox"
                      disabled={running}
                      checked={tracks.includes(track.id)}
                      onChange={() =>
                        setTracks((current) =>
                          current.includes(track.id)
                            ? current.filter((id) => id !== track.id)
                            : current.concat([track.id]),
                        )
                      }
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
                    {/*
                      Дорожка без тейков в выгрузку не попадёт вовсе — про это
                      честнее сказать до нажатия, а не отдать архив без файла.
                    */}
                    <span
                      className={cn(
                        "flex-none text-[12px] tabular-nums",
                        takes === 0 ? "text-ws-5" : "text-ws-4",
                      )}
                    >
                      {tf(t.voiceTakesShort, { count: takes })}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>

          {result?.resampled ? (
            <p className="flex items-start gap-2 text-pretty text-[12px] leading-relaxed text-[#e0a33a]">
              <TriangleAlert className="mt-[2px] h-[15px] w-[15px] shrink-0" />
              {t.voiceExportPitchWarning}
            </p>
          ) : null}
        </div>

        <div className="flex flex-none items-center gap-3 border-t border-foreground/[0.07] px-5 py-3.5">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ws-3">
            {failed ? (
              <span className="text-ws-playhead">{failed}</span>
            ) : running ? (
              tf(t.voiceExportProgress, { done: progress.done, total: progress.total })
            ) : !result ? (
              t.voiceExportNothing
            ) : result.kind === "file" ? (
              tf(t.voiceExportSummaryFile, { name: result.name, takes: result.takes })
            ) : (
              tf(t.voiceExportSummaryArchive, {
                name: result.name,
                files: result.pieces.length,
                takes: result.takes,
              })
            )}
          </p>
          <button
            type="button"
            onClick={() => void execute({ langs, trackIds: tracks, layout })}
            disabled={!result || running}
            className="flex h-[34px] flex-none items-center gap-2 rounded bg-ws-action px-4 text-[13px] font-semibold text-white hover:bg-ws-action-hover disabled:opacity-40"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t.srtExportRun}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LayoutOption({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded border px-3 py-2 text-left text-[13px] disabled:opacity-50",
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
