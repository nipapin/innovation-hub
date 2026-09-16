"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Ear,
  HelpCircle,
  Loader2,
  Mic,
  Settings,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { ResizeGrip } from "@/components/account/resize-grip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDragSize } from "@/components/account/use-drag-size"
import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  docDurationMs,
  moveTrack as moveTrackOp,
  removeTrack as removeTrackOp,
  renameTrack as renameTrackOp,
  setTrackColor as setTrackColorOp,
  type DialogDoc,
  type VoiceTake,
} from "@/lib/tools/dialog/dialog-doc"
import { MAX_PPS, MIN_PPS } from "@/lib/tools/dialog/timeline"
import {
  addTake as addTakeOp,
  adjustTake as adjustTakeOp,
  clearMarkup as clearMarkupOp,
  fitTakeToCue,
  removeTake as removeTakeOp,
  removeTakes as removeTakesOp,
  resetTake as resetTakeOp,
  selectTake as selectTakeOp,
  selectedTake,
  setMarkup as setMarkupOp,
  setTrackVoice as setTrackVoiceOp,
  synthText,
  voicedCount,
} from "@/lib/tools/dialog/voice"
import { cn } from "@/lib/utils"
import { SourcePicker } from "../source-picker"
import {
  useHeldTool,
  usePlayerClock,
  useUndoableDoc,
  useViewPrefs,
  type TrackFlags,
  type TrackMode,
} from "../shared/editor-state"
import { BuildTaskScreen } from "../shared/build-task"
import { SaveBadge } from "../shared/save-badge"
import { useAutosave } from "../shared/use-autosave"
import {
  findEntry,
  signGet,
  useAutoPeaks,
  useDocPeaks,
  usePeaksByPath,
  useSignedUrls,
  useTaskFolder,
  useTaskVideo,
  type FolderEntry,
} from "../shared/use-task-folder"
import { useTools, type ToolInstance } from "../tools-context"
import { CueList } from "./cue-list"
import { VoiceExportDialog, type VoiceExportRequest } from "./export-dialog"
import { VoiceHelpDialog } from "./help-dialog"
import { PreviewPane } from "./preview-pane"
import { TimelinePane } from "./timeline-pane"
import {
  DEFAULT_VOICE_LEFT_W,
  DEFAULT_VOICE_PREFS,
  DEFAULT_VOICE_TIMELINE_H,
  matchesHotkey,
  voicePrefsKey,
} from "./prefs"
import { VoiceSettingsDialog } from "./settings-dialog"
import { useGenerationQueue } from "./use-generation"
import { VoiceProvider, type VoiceApi, type VoiceSoundMode } from "./voice-context"

/**
 * Инструмент озвучки.
 *
 * Тот же документ и та же папка, что у редактора титров: озвучка — следующий шаг
 * над тем же материалом, а не отдельная сущность. Отсюда и переиспользование:
 * чтение папки, автосохранение, часы, полотно и превью взяты из каркаса, своё
 * здесь — список реплик, слой тейков на таймлинии и генерация.
 */
export function VoiceEditor({ tool }: { tool: ToolInstance }) {
  const { t } = useWorkspace()
  const { closeTool } = useTools()
  const { state, reload } = useTaskFolder(tool)

  const loaded = state.kind === "ready" ? state.doc : null
  const { doc, apply, reset, undo, redo, version } = useUndoableDoc<DialogDoc>(loaded)

  const save = useAutosave({
    toolId: tool.id,
    doc,
    version,
    revision: loaded?.revision ?? 0,
    onMerged: reset,
    networkError: t.driveUnavailable,
    goneError: t.srtSaveGone,
  })

  const markClean = save.markClean
  useEffect(() => {
    reset(loaded)
    markClean()
  }, [loaded, markClean, reset])

  const { prefs, setPref, resetPrefs } = useViewPrefs(voicePrefsKey(tool.id), DEFAULT_VOICE_PREFS)
  const left = useDragSize({
    initial: DEFAULT_VOICE_LEFT_W,
    min: 320,
    max: 760,
    axis: "x",
    storageKey: `ffworks-voice-left:${tool.id}`,
  })
  const bottom = useDragSize({
    initial: DEFAULT_VOICE_TIMELINE_H,
    min: 180,
    max: 700,
    axis: "y",
    invert: true,
    storageKey: `ffworks-voice-timeline:${tool.id}`,
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [lang, setLangState] = useState<string | null>(null)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [cueQuery, setCueQuery] = useState("")
  const [trackQuery, setTrackQuery] = useState("")
  const [hideShy, setHideShy] = useState(false)
  const [flags, setFlags] = useState<Record<string, TrackFlags>>({})
  const [trackMode, setTrackMode] = useState<TrackMode>("none")
  const [soundMode, setSoundMode] = useState<VoiceSoundMode>("takes")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportReq, setExportReq] = useState<VoiceExportRequest | null>(null)

  const durationMs = doc ? docDurationMs(doc) : 0
  const clock = usePlayerClock(videoRef, durationMs)

  // Настройки читаются в момент прихода тейка, а не когда заводилась очередь: их
  // могли поменять, пока шла генерация.
  const autoFit = useRef({ shrink: prefs.autoFitShrink, stretch: prefs.autoFitStretch })
  autoFit.current = { shrink: prefs.autoFitShrink, stretch: prefs.autoFitStretch }

  /**
   * Язык озвучки.
   *
   * Всегда конкретный: первый перевод, а если переводов нет — оригинал. Озвучить
   * можно и оригинал (перезапись), но «ничего» нельзя, поэтому пустого значения
   * здесь не бывает.
   */
  const effectiveLang = lang ?? doc?.languages.targets[0] ?? doc?.languages.original ?? "und"

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null
  const entries = state.kind === "ready" ? state.entries : []
  const video = useTaskVideo(projectId, folderPath, entries, doc)
  const peaks = useDocPeaks(projectId, folderPath, entries, doc)
  // Волны, которых в папке нет, считаются в фоне и рисуются по мере готовности.
  const autoPeaks = useAutoPeaks({ toolId: tool.id, projectId, folderPath, entries, doc })

  useEffect(() => {
    if (!doc) return
    setFlags((current) => {
      let changed = false
      const next = { ...current }
      for (const track of doc.tracks) {
        if (!next[track.id]) {
          next[track.id] = { solo: false, mute: false, shy: false, wave: true }
          changed = true
        }
      }
      return changed ? next : current
    })
    setSelectedTrackId((current) => current ?? doc.tracks[0]?.id ?? null)
  }, [doc])

  const visibleTracks = useMemo(() => {
    if (!doc) return []
    const query = trackQuery.trim().toLowerCase()
    return doc.tracks
      .filter(
        (track) =>
          (!hideShy || !flags[track.id]?.shy) &&
          (!query || track.name.toLowerCase().includes(query)),
      )
      .sort((a, b) => a.no - b.no)
  }, [doc, flags, hideShy, trackQuery])

  const rows = useMemo(() => {
    if (!doc) return []
    const query = cueQuery.trim().toLowerCase()
    if (!query) return doc.cues
    return doc.cues.filter((cue) =>
      synthText(doc, cue, effectiveLang).toLowerCase().includes(query),
    )
  }, [cueQuery, doc, effectiveLang])

  /**
   * Что звучит (§5.2 плана).
   *
   * По умолчанию — выбранные тейки видимых дорожек, а звук видео заглушён:
   * человек проверяет дубляж. `solo` сужает набор, `mute` убирает дорожку.
   */
  const audibleTakes = useMemo(() => {
    if (!doc || soundMode === "original") return []
    const soloed = doc.tracks.some((track) => flags[track.id]?.solo)
    const allowed = new Set(
      visibleTracks
        .filter((track) => {
          const flag = flags[track.id]
          if (flag?.mute) return false
          return soloed ? Boolean(flag?.solo) : true
        })
        .map((track) => track.id),
    )
    const out: { cue: typeof doc.cues[number]; take: VoiceTake }[] = []
    for (const cue of doc.cues) {
      if (!allowed.has(cue.trackId)) continue
      const take = selectedTake(cue, effectiveLang)
      if (take) out.push({ cue, take })
    }
    return out
  }, [doc, effectiveLang, flags, soundMode, visibleTracks])

  const takeEntries = useMemo(() => {
    if (!folderPath || !doc) return []
    const out: { path: string; s3Key: string }[] = []
    for (const cue of doc.cues) {
      const take = selectedTake(cue, effectiveLang)
      if (!take) continue
      const entry = findEntry(entries, folderPath, take.file)
      if (entry?.s3Key) out.push({ path: take.file, s3Key: entry.s3Key })
    }
    return out
  }, [doc, effectiveLang, entries, folderPath])

  const takeUrls = useSignedUrls(
    projectId,
    takeEntries.map((item) => item.s3Key),
  )
  const takePeaks = usePeaksByPath(
    projectId,
    folderPath,
    entries,
    useMemo(() => {
      if (!doc) return []
      return doc.cues
        .map((cue) => selectedTake(cue, effectiveLang)?.peaks)
        .filter((path): path is string => Boolean(path))
    }, [doc, effectiveLang]),
  )

  const generation = useGenerationQueue({
    toolId: tool.id,
    doc,
    lang: effectiveLang,
    concurrency: prefs.concurrency,
    onTake: useCallback(
      (cueId: string, take: VoiceTake) =>
        // Вписывание — частью той же правки, а не отдельной: иначе «отменить»
        // после генерации возвращало бы скорость, оставляя тейк, и жать пришлось
        // бы дважды.
        apply((d) => {
          const next = addTakeOp(d, cueId, take)
          return fitTakeToCue(next, cueId, take.id, autoFit.current)
        }),
      [apply, autoFit],
    ),
    networkError: t.driveUnavailable,
    // Синтезируем то, что уже сохранено: правку разметки надо успеть донести.
    beforeRequest: save.flush,
  })

  const selectCue = useCallback(
    (cueId: string, options?: { seek?: boolean }) => {
      setSelectedCueId(cueId)
      const cue = doc?.cues.find((c) => c.id === cueId)
      if (!cue) return
      setSelectedTrackId(cue.trackId)
      if (options?.seek !== false) clock.seek(cue.startMs)
    },
    [clock, doc],
  )

  const ops = useMemo<VoiceApi["ops"]>(
    () => ({
      setMarkup: (cueId, markup, gesture) =>
        apply((d) => setMarkupOp(d, cueId, effectiveLang, markup), gesture),
      clearMarkup: (cueId) => apply((d) => clearMarkupOp(d, cueId, effectiveLang)),
      selectTake: (cueId, takeId) => apply((d) => selectTakeOp(d, cueId, takeId)),
      removeTake: (cueId, takeId) => apply((d) => removeTakeOp(d, cueId, takeId)),
      removeTakes: (cueId) => apply((d) => removeTakesOp(d, cueId, effectiveLang)),
      adjustTake: (cueId, takeId, patch, gesture) =>
        apply((d) => adjustTakeOp(d, cueId, takeId, patch), gesture),
      resetTake: (cueId, takeId) => apply((d) => resetTakeOp(d, cueId, takeId)),
      fitTake: (cueId, takeId) => apply((d) => fitTakeToCue(d, cueId, takeId)),
      setTrackVoice: (trackId, patch) => apply((d) => setTrackVoiceOp(d, trackId, patch)),
      renameTrack: (trackId, name) => apply((d) => renameTrackOp(d, trackId, name)),
      setTrackColor: (trackId, color) => apply((d) => setTrackColorOp(d, trackId, color)),
      moveTrack: (trackId, direction) => apply((d) => moveTrackOp(d, trackId, direction)),
      removeTrack: (trackId) => apply((d) => removeTrackOp(d, trackId, new Date().toISOString())),
      undo,
      redo,
    }),
    [apply, effectiveLang, redo, undo],
  )

  const held = useHeldTool<"none">("none", () => undefined)

  useEffect(() => {
    const editable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return
      if (settingsOpen || helpOpen) {
        if (event.code === "Escape") {
          setHelpOpen(false)
          setSettingsOpen(false)
          event.preventDefault()
        }
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.code === "KeyS") {
          event.preventDefault()
          save.flush()
          return
        }
        if (event.code !== "KeyZ") return
        event.preventDefault()
        if (event.shiftKey) ops.redo()
        else ops.undo()
        return
      }

      const keymap = prefs.keymap
      if (event.code === keymap.playPause) clock.togglePlay()
      else if (event.code === keymap.mainWave) setPref("mainWave", !prefs.mainWave)
      else if (event.code === keymap.original) {
        setSoundMode((current) => (current === "takes" ? "original" : "takes"))
      } else if (event.code === keymap.generate) {
        if (selectedCueId) generation.generate(selectedCueId)
      } else if (event.code === keymap.fit) {
        const cue = doc?.cues.find((c) => c.id === selectedCueId)
        const take = cue ? selectedTake(cue, effectiveLang) : null
        if (cue && take) ops.fitTake(cue.id, take.id)
      } else if (matchesHotkey(event.code, keymap.removeTake)) {
        /*
          Удаление версий с клавиатуры.

          Обычное нажатие убирает текущую версию, и её место занимает следующая —
          так перебором можно снести все по очереди, слушая, что осталось. С
          `Shift` убираются сразу все версии этой реплики на этом языке.
        */
        const cue = doc?.cues.find((c) => c.id === selectedCueId)
        if (!cue) return
        if (event.shiftKey) {
          ops.removeTakes(cue.id)
        } else {
          const take = selectedTake(cue, effectiveLang)
          if (!take) return
          ops.removeTake(cue.id, take.id)
        }
      } else if (event.code === "F1") {
        setHelpOpen(true)
      } else if (event.code === "Escape") {
        setTrackMode("none")
      } else {
        return
      }
      event.preventDefault()
    }

    const onKeyUp = (event: KeyboardEvent) => held.release(event.code)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [
    clock,
    doc,
    effectiveLang,
    generation,
    held,
    helpOpen,
    ops,
    prefs.keymap,
    prefs.mainWave,
    save,
    selectedCueId,
    setPref,
    settingsOpen,
  ])

  useEffect(() => {
    if (save.state.kind !== "merged") return
    toast.info(
      tf(t.srtSaveMergedNote, {
        taken: save.state.taken,
        conflicts: save.state.conflicts,
      }),
    )
  }, [save.state, t.srtSaveMergedNote])

  const taskName = folderPath?.split("/").pop() ?? doc?.id ?? "dialog"

  const api = useMemo<VoiceApi | null>(() => {
    if (!doc) return null
    return {
      doc,
      taskName,
      durationMs,
      mediaEndMs: doc.media.durationMs || durationMs,
      prefs,
      setPref,
      resetView: () => {
        resetPrefs()
        left.setSize(DEFAULT_VOICE_LEFT_W)
        bottom.setSize(DEFAULT_VOICE_TIMELINE_H)
      },
      pps: prefs.zoom,
      setPps: (value) => setPref("zoom", Math.min(MAX_PPS, Math.max(MIN_PPS, value))),
      lang: effectiveLang,
      setLang: setLangState,
      selectedCueId,
      selectedTrackId,
      selectCue,
      selectTrack: setSelectedTrackId,
      cueQuery,
      setCueQuery,
      trackQuery,
      setTrackQuery,
      hideShy,
      setHideShy,
      flags,
      toggleFlag: (trackId, key) =>
        setFlags((current) => ({
          ...current,
          [trackId]: {
            ...(current[trackId] ?? { solo: false, mute: false, shy: false, wave: true }),
            [key]: !current[trackId]?.[key],
          },
        })),
      trackMode,
      setTrackMode,
      clock,
      video,
      peaksFor: (trackId) => {
        const own = peaks.byTrack[trackId] ?? autoPeaks.byTrack[trackId]
        return own
          ? { peaks: own, own: true }
          : { peaks: peaks.main ?? autoPeaks.main, own: false }
      },
      mainPeaks: peaks.main ?? autoPeaks.main,
      peaksForTake: (take) => (take.peaks ? takePeaks[take.peaks] ?? null : null),
      takeUrl: (take) => {
        const key = takeEntries.find((item) => item.path === take.file)?.s3Key
        return key ? takeUrls[key] ?? null : null
      },
      signTake: async (take) => {
        // Уже подписанная ссылка годится: она из того же хранилища и живёт
        // дольше, чем идёт выгрузка.
        const cached = takeEntries.find((item) => item.path === take.file)?.s3Key
        if (cached && takeUrls[cached]) return takeUrls[cached]
        if (!projectId || !folderPath) return null
        const entry = findEntry(entries, folderPath, take.file)
        return entry?.s3Key ? signGet(projectId, entry.s3Key) : null
      },
      visibleTracks,
      rows,
      soundMode,
      setSoundMode,
      mainMuted: soundMode === "takes",
      audibleTakes,
      genState: generation.state,
      genPending: generation.pending,
      generate: generation.generate,
      generateAll: generation.generateAll,
      cancelAll: generation.cancelAll,
      ops,
      openSettings: () => setSettingsOpen(true),
      openHelp: () => setHelpOpen(true),
    }
  }, [
    audibleTakes,
    bottom,
    clock,
    cueQuery,
    doc,
    durationMs,
    effectiveLang,
    entries,
    flags,
    folderPath,
    generation,
    hideShy,
    left,
    projectId,
    ops,
    peaks,
    autoPeaks,
    prefs,
    resetPrefs,
    rows,
    selectCue,
    selectedCueId,
    selectedTrackId,
    setPref,
    soundMode,
    takeEntries,
    takePeaks,
    takeUrls,
    taskName,
    trackMode,
    trackQuery,
    video,
    visibleTracks,
  ])

  const languages = doc ? [doc.languages.original, ...doc.languages.targets] : []
  const voiced = doc ? voicedCount(doc, effectiveLang) : 0
  /**
   * Языки, на которых есть хоть один тейк.
   *
   * Быстрые пункты меню берут именно их, а не все объявленные: «выгрузить всё» на
   * документе с тремя переводами и озвучкой одного из них должно отдать один
   * файл, а не архив с двумя пустыми папками.
   */
  const voicedLangs = useMemo(
    () => (doc ? languages.filter((code) => voicedCount(doc, code) > 0) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  )

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 flex-none items-center gap-2.5 border-b border-foreground/[0.07] px-3 md:px-4">
        <SourcePicker tool={tool} />
        <button
          type="button"
          title={t.srtSettings}
          onClick={() => setSettingsOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <Settings className="h-[17px] w-[17px]" />
        </button>

        {doc ? (
          <div className="flex items-center gap-1 rounded-md border border-foreground/[0.07] bg-ws-raised p-[3px]">
            {languages.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLangState(code)}
                className={cn(
                  "h-[26px] rounded px-2.5 text-[12px] font-semibold uppercase",
                  code === effectiveLang ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
                )}
              >
                {code}
              </button>
            ))}
          </div>
        ) : null}

        {/*
          Две кнопки, а не переключатель: у переключателя надпись описывает то ли
          текущее состояние, то ли то, что будет по нажатию, и понять это можно
          только нажав. Здесь горит то, что слушаешь.
        */}
        {doc ? (
          <div
            title={t.voiceListenHint}
            className="flex items-center gap-1 rounded-md border border-foreground/[0.07] bg-ws-raised p-[3px]"
          >
            <button
              type="button"
              onClick={() => setSoundMode("takes")}
              className={cn(
                "flex h-[26px] items-center gap-1.5 rounded px-2.5 text-[12px] font-semibold",
                soundMode === "takes" ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
              )}
            >
              <Mic className="h-[14px] w-[14px]" />
              {t.voiceListenTakes}
            </button>
            <button
              type="button"
              onClick={() => setSoundMode("original")}
              className={cn(
                "flex h-[26px] items-center gap-1.5 rounded px-2.5 text-[12px] font-semibold",
                soundMode === "original" ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
              )}
            >
              <Ear className="h-[14px] w-[14px]" />
              {t.voiceListenOriginal}
            </button>
          </div>
        ) : null}

        <div className="flex-1" />

        {doc ? (
          <span className="hidden items-center gap-1.5 font-mono text-[12px] tabular-nums text-ws-3 xl:flex">
            <Mic className="h-4 w-4 text-ws-5" />
            {tf(t.voiceCounters, { voiced, total: doc.cues.length })}
          </span>
        ) : null}

        {doc ? (
          <button
            type="button"
            onClick={
              api && api.genPending > 0 ? api.cancelAll : api ? api.generateAll : undefined
            }
            className={cn(
              "flex h-[34px] items-center gap-2 rounded px-3 text-[13px] font-semibold",
              api && api.genPending > 0
                ? "border border-foreground/[0.07] text-ws-2 hover:bg-ws-hover"
                : "bg-ws-action text-white hover:bg-ws-action-hover",
            )}
          >
            {api && api.genPending > 0 ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {tf(t.voiceGenerating, { count: api.genPending })}
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                {t.voiceGenerateAll}
              </>
            )}
          </button>
        ) : null}

        {doc ? <SaveBadge state={save.state} dirty={save.dirty} onFlush={save.flush} /> : null}

        <button
          type="button"
          title={t.srtHotkeys}
          onClick={() => setHelpOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <HelpCircle className="h-[18px] w-[18px]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!doc}
              className="flex h-[34px] items-center gap-2 rounded border border-foreground/[0.07] px-3 text-[13px] text-ws-2 hover:bg-ws-hover disabled:opacity-40"
            >
              <Download className="h-[17px] w-[17px]" />
              {t.srtExport}
              <ChevronDown className="h-[15px] w-[15px] text-ws-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[340px]">
            <ExportMenuItem
              title={t.voiceExportAllSingle}
              note={
                voicedLangs.length === 0
                  ? t.voiceExportNothing
                  : tf(t.voiceExportLangsNote, { langs: voicedLangs.length })
              }
              disabled={voicedLangs.length === 0}
              onClick={() =>
                setExportReq({ layout: "single", langs: voicedLangs, autoRun: true })
              }
            />
            <ExportMenuItem
              title={t.voiceExportAllTracks}
              note={
                voicedLangs.length === 0
                  ? t.voiceExportNothing
                  : tf(t.voiceExportTracksNote, { tracks: doc?.tracks.length ?? 0 })
              }
              disabled={voicedLangs.length === 0}
              onClick={() =>
                setExportReq({ layout: "per-track", langs: voicedLangs, autoRun: true })
              }
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                setExportReq({ layout: "per-track", langs: [effectiveLang], autoRun: false })
              }
              className="cursor-pointer focus:bg-foreground/10"
            >
              {t.srtExportAdvanced}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          title={t.toolClose}
          onClick={closeTool}
          className="flex h-[34px] w-[34px] items-center justify-center rounded border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </header>

      {api ? (
        <VoiceProvider value={api}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="relative flex-none" style={{ width: left.size }}>
                <PreviewPane videoRef={videoRef} />
                <ResizeGrip
                  orientation="vertical"
                  side="right"
                  label={t.srtResizePreview}
                  dragging={left.dragging}
                  onPointerDown={left.onPointerDown}
                  onKeyDown={left.onKeyDown}
                  className="right-[-5px]"
                />
              </div>
              <CueList />
            </div>
            <div className="relative flex-none" style={{ height: bottom.size }}>
              <ResizeGrip
                orientation="horizontal"
                side="top"
                label={t.srtResizeTimeline}
                dragging={bottom.dragging}
                onPointerDown={bottom.onPointerDown}
                onKeyDown={bottom.onKeyDown}
                className="top-[-5px]"
              />
              <TimelinePane />
            </div>
          </div>
          <VoiceExportDialog request={exportReq} onClose={() => setExportReq(null)} />
        </VoiceProvider>
      ) : (
        <EmptyArea state={state} tool={tool} onBuilt={reload} />
      )}

      {/*
        Настройки и справка — вне провайдера: они нужны и когда папка не выбрана,
        иначе кнопка в топбаре есть, а окно не открывается.
      */}
      <VoiceSettingsDialog
        tool={tool}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        setPref={setPref}
        resetView={() => {
          resetPrefs()
          left.setSize(DEFAULT_VOICE_LEFT_W)
          bottom.setSize(DEFAULT_VOICE_TIMELINE_H)
        }}
        onOpenHelp={() => {
          setSettingsOpen(false)
          setHelpOpen(true)
        }}
      />
      <VoiceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} keymap={prefs.keymap} />
    </section>
  )
}


/**
 * Пункт меню экспорта: что выгружаем слева, формат — справа.
 *
 * Формат подписан у каждого пункта, хотя он один: в титрах он выбирается в
 * настройках, и человек привыкает искать его здесь. Когда появятся MP3 и
 * остальные, место под подпись уже будет.
 */
function ExportMenuItem({
  title,
  note,
  disabled,
  onClick,
}: {
  title: string
  note?: string
  disabled?: boolean
  onClick: () => void
}) {
  const { t } = useWorkspace()

  return (
    <DropdownMenuItem
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer gap-3 focus:bg-foreground/10"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{title}</span>
        {note ? <span className="truncate text-[12px] text-ws-4">{note}</span> : null}
      </span>
      <span className="shrink-0 self-center font-mono text-[11px] text-ws-5">{t.voiceFmtWav}</span>
    </DropdownMenuItem>
  )
}

function EmptyArea({
  state,
  tool,
  onBuilt,
}: {
  state: ReturnType<typeof useTaskFolder>["state"]
  tool: ToolInstance
  onBuilt: () => void
}) {
  const { t } = useWorkspace()

  // Документа нет, но папка на задачу похожа: собрать её — это работа
  // инструмента, а не повод показать ошибку.
  if (state.kind === "needsBuild") {
    return <BuildTaskScreen tool={tool} entries={state.entries} onDone={onBuilt} />
  }

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ws-4" />
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="flex max-w-[460px] items-start gap-2.5 text-[13.5px] leading-relaxed text-ws-3">
          <AlertTriangle className="mt-[2px] h-[17px] w-[17px] shrink-0 text-ws-playhead" />
          <span>{state.message}</span>
        </p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <p className="max-w-[420px] text-center text-[14px] leading-relaxed text-ws-4">
        {t.toolNoSource} — {t.toolPickSource.toLowerCase()}
      </p>
    </div>
  )
}
