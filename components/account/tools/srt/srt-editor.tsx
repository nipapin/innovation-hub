"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Captions,
  Download,
  HelpCircle,
  ChevronDown,
  Loader2,
  RotateCcw,
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
  addCue as addCueOp,
  addLanguage as addLanguageOp,
  addTrack as addTrackOp,
  docDurationMs,
  mergeCueWithNext,
  mergeCues as mergeCuesOp,
  moveCueToTrack,
  moveTrack as moveTrackOp,
  removeCue as removeCueOp,
  removeTrack as removeTrackOp,
  removeLanguage as removeLanguageOp,
  renameTrack as renameTrackOp,
  setTrackColor as setTrackColorOp,
  setCueTiming,
  setCueText,
  setCueTranslation,
  splitCue as splitCueOp,
} from "@/lib/tools/dialog/dialog-doc"
import { buildExport, type ExportResult } from "@/lib/tools/dialog/export"
import type { DialogDoc } from "@/lib/tools/dialog/dialog-doc"
import {
  fullRestoreScope,
  restoreFromSrt,
  sourcePathsFor,
} from "@/lib/tools/dialog/restore"
import { buildZip } from "@/lib/tools/dialog/zip"
import { MAX_PPS, MIN_PPS, zoomStep } from "@/lib/tools/dialog/timeline"
import { cn } from "@/lib/utils"
import { SourcePicker } from "../source-picker"
import { useTools, type ToolInstance } from "../tools-context"
import { CueList } from "./cue-list"
import {
  useHeldTool,
  usePlayerClock,
  useUndoableDoc,
  useViewPrefs,
  type SoundMode,
  type TrackFlags,
  type TrackMode,
} from "../shared/editor-state"
import {
  DEFAULT_LEFT_W,
  DEFAULT_PREFS,
  DEFAULT_TIMELINE_H,
  viewPrefsKey,
  type HotkeyAction,
  type TimelineTool,
} from "./prefs"
import { downloadFile, ZIP_MIME } from "../shared/download"
import { SrtExportDialog } from "./export-dialog"
import { SrtHelpDialog } from "./help-dialog"
import { SrtRestoreDialog } from "./restore-dialog"
import { LanguagePicker, languageName } from "../shared/language-picker"
import { PreviewPane } from "./preview-pane"
import { SrtProvider, type SrtApi } from "./srt-context"
import { TimelinePane } from "./timeline-pane"
import {
  findEntry,
  loadSrtSources,
  useAutoPeaks,
  useDocPeaks,
  useSignedUrls,
  useTaskFolder,
  useTaskVideo,
} from "../shared/use-task-folder"
import { SrtSettingsDialog } from "./settings-dialog"
import {
  BuildTaskScreen,
  collectTaskDoc,
  postVersion,
  taskVersions,
} from "../shared/build-task"
import { SaveBadge } from "../shared/save-badge"
import { useAutosave } from "../shared/use-autosave"
import type { FolderEntry } from "../shared/use-task-folder"

/**
 * Редактор титров по дорожкам персонажей.
 *
 * Раскладка — зоны из §13: топбар, превью и список реплик в одной строке,
 * таймлиния во всю ширину под ними. Скроллятся панели, страница — никогда
 * ([UI_GUIDE §8.2](../../../../docs/UI_GUIDE.md)).
 */
export function SrtEditor({ tool }: { tool: ToolInstance }) {
  const { t, lang: uiLang } = useWorkspace()
  const { closeTool } = useTools()
  const { state, reload } = useTaskFolder(tool)

  const loaded = state.kind === "ready" ? state.doc : null
  const { doc, apply, reset, undo, redo, version } = useUndoableDoc(loaded)

  /**
   * Автосохранение. Правки уходят в папку сами: инструмент работает только
   * онлайн, и папка в хранилище — единственное место, где живут файлы.
   */
  const save = useAutosave({
    toolId: tool.id,
    doc,
    version,
    revision: loaded?.revision ?? 0,
    onMerged: reset,
    networkError: t.driveUnavailable,
    goneError: t.srtSaveGone,
  })

  // Загрузка документа — не правка человека: помечаем чистым, иначе инструмент
  // запишет в папку только что прочитанный файл.
  const markClean = save.markClean
  useEffect(() => {
    reset(loaded)
    markClean()
  }, [loaded, markClean, reset])

  // Замечания разбора показываем один раз при открытии: это не ошибки, работать
  // можно, но знать о них человек должен (§6 контракта, пункты 6 и 7).
  const warned = useRef<string | null>(null)
  useEffect(() => {
    if (state.kind !== "ready" || warned.current === state.doc.id) return
    warned.current = state.doc.id
    for (const warning of state.warnings) {
      if (warning.kind === "beyondDuration") {
        toast.warning(tf(t.srtWarnBeyondDuration, { count: warning.count }))
      } else {
        toast.warning(tf(t.srtWarnExtraLanguages, { langs: warning.langs.join(", ") }))
      }
    }
  }, [state, t.srtWarnBeyondDuration, t.srtWarnExtraLanguages])

  useEffect(() => {
    if (save.state.kind !== "merged") return
    toast.info(
      tf(t.srtSaveMergedNote, {
        taken: save.state.taken,
        conflicts: save.state.conflicts,
      }),
    )
  }, [save.state, t.srtSaveMergedNote])

  const { prefs, setPref, resetPrefs } = useViewPrefs(viewPrefsKey(tool.id), DEFAULT_PREFS)
  const left = useDragSize({
    initial: DEFAULT_LEFT_W,
    min: 320,
    max: 760,
    axis: "x",
    storageKey: `ffworks-srt-left:${tool.id}`,
  })
  const bottom = useDragSize({
    initial: DEFAULT_TIMELINE_H,
    min: 160,
    max: 700,
    axis: "y",
    invert: true,
    storageKey: `ffworks-srt-timeline:${tool.id}`,
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(0)

  const [tool_, setTool] = useState<TimelineTool>("select")
  const [lang, setLang] = useState<string | null>(null)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [cueQuery, setCueQuery] = useState("")
  const [trackQuery, setTrackQuery] = useState("")
  const [hideShy, setHideShy] = useState(false)
  const [flags, setFlags] = useState<Record<string, TrackFlags>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [trackMode, setTrackMode] = useState<TrackMode>("none")

  const durationMs = doc ? docDurationMs(doc) : 0
  const clock = usePlayerClock(videoRef, durationMs)

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null
  const entries = state.kind === "ready" ? state.entries : []
  const video = useTaskVideo(projectId, folderPath, entries, doc)
  const versions = useMemo(() => taskVersions(entries, folderPath), [entries, folderPath])
  const peaks = useDocPeaks(projectId, folderPath, entries, doc)
  // Волны, которых в папке нет, считаются в фоне и рисуются по мере готовности.
  const autoPeaks = useAutoPeaks({ toolId: tool.id, projectId, folderPath, entries, doc })

  /**
   * Матрица звука (§15.3), в том виде, в каком её описал владелец: по
   * умолчанию звучит основная дорожка — звук видео, дорожки персонажей молчат.
   * Solo и mute — два способа её разобрать, и оба глушат видео: иначе к стему
   * добавлялся бы микс, где тот же голос уже есть.
   *
   * Solo старше mute: включённый solo отвечает на вопрос «что я хочу слышать»
   * целиком, и выключенное раньше не должно этот ответ править. Поэтому режим
   * один, а не два независимых флага.
   */
  const soundMode = useMemo<SoundMode>(() => {
    if (!doc) return "main"
    if (doc.tracks.some((track) => flags[track.id]?.solo)) return "solo"
    // В задаче без стемов вычитать голос из общего микса нечем, и mute там
    // означал бы «тишина вместо всего» — не то, что человек нажимал.
    const stems = doc.tracks.some((track) => Boolean(track.audio))
    if (stems && doc.tracks.some((track) => flags[track.id]?.mute)) return "mute"
    return "main"
  }, [doc, flags])
  /** Дорожки, которые должны звучать в этом режиме, — если есть свой звук. */
  const audibleTracks = useMemo(() => {
    if (!doc || soundMode === "main") return []
    return doc.tracks.filter((track) => {
      if (!track.audio) return false
      return soundMode === "solo" ? Boolean(flags[track.id]?.solo) : !flags[track.id]?.mute
    })
  }, [doc, flags, soundMode])
  const trackAudioEntries = useMemo(() => {
    if (!folderPath) return []
    return audibleTracks
      .map((track) => ({ id: track.id, entry: findEntry(entries, folderPath, track.audio) }))
      .filter((item): item is { id: string; entry: FolderEntry } => Boolean(item.entry?.s3Key))
  }, [entries, folderPath, audibleTracks])
  const trackAudioUrls = useSignedUrls(
    projectId,
    trackAudioEntries.map((item) => item.entry.s3Key ?? ""),
  )

  // Дорожки заводятся из документа: solo, mute и shy — состояние вида, в файл
  // они не пишутся (§15.3), но появиться должны сразу, а не по первому клику.
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

  /** Идентификатор для новой записи: `c_` у реплики, `t_` у дорожки (§2.3). */
  const makeId = useCallback((prefix: "c" | "t") => {
    nextId.current += 1
    return `${prefix}_l${Date.now().toString(36)}${nextId.current.toString(36)}`
  }, [])

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

  const visibleTracks = useMemo(() => {
    if (!doc) return []
    const query = trackQuery.trim().toLowerCase()
    return doc.tracks
      .filter(
        (track) =>
          (!hideShy || !flags[track.id]?.shy) &&
          (!query || track.name.toLowerCase().includes(query)),
      )
      // Порядок на экране задаёт `no`, а не порядок в массиве: так панель
      // дорожек и полотно всегда согласны между собой и с тем, что в файле.
      .sort((a, b) => a.no - b.no)
  }, [doc, flags, hideShy, trackQuery])

  const rows = useMemo(() => {
    if (!doc) return []
    const query = cueQuery.trim().toLowerCase()
    if (!query) return doc.cues
    return doc.cues.filter((cue) => {
      const translations = Object.values(cue.tr).map((tr) => tr.text).join(" ")
      return `${cue.text} ${translations}`.toLowerCase().includes(query)
    })
  }, [cueQuery, doc])

  const ops = useMemo<SrtApi["ops"]>(
    () => ({
      setText: (cueId, text) => apply((d) => setCueText(d, cueId, text)),
      setTranslation: (cueId, language, text) =>
        apply((d) => setCueTranslation(d, cueId, language, text)),
      setTiming: (cueId, startMs, endMs, trackId, gesture) =>
        apply((d) => {
          const moved = setCueTiming(d, cueId, startMs, endMs)
          // Перенос на другую дорожку — не то же, что сдвиг во времени: он
          // запоминает, куда автоматика приписала реплику изначально.
          return trackId ? moveCueToTrack(moved, cueId, trackId) : moved
        }, gesture),
      addCue: (trackId, startMs, endMs) => {
        const id = makeId("c")
        apply((d) => addCueOp(d, trackId, startMs, endMs, id))
        return id
      },
      removeCue: (cueId) => {
        apply((d) => removeCueOp(d, cueId, new Date().toISOString()))
        setSelectedCueId((current) => (current === cueId ? null : current))
      },
      splitCue: (cueId, atMs) => apply((d) => splitCueOp(d, cueId, atMs, makeId("c"))),
      mergeNext: (cueId) => apply((d) => mergeCueWithNext(d, cueId)),
      mergeCues: (aId, bId) => apply((d) => mergeCuesOp(d, aId, bId)),
      renameTrack: (trackId, name) => apply((d) => renameTrackOp(d, trackId, name)),
      setTrackColor: (trackId, color) => apply((d) => setTrackColorOp(d, trackId, color)),
      removeTrack: (trackId) => apply((d) => removeTrackOp(d, trackId, new Date().toISOString())),
      moveTrack: (trackId, direction) => apply((d) => moveTrackOp(d, trackId, direction)),
      // Восстановление проходит через историю: «отменить» возвращает то, что было
      // до сброса, — иначе откат правок сам оказался бы необратимым.
      replaceDoc: (next) => apply(() => next),
      addLanguage: (code) => {
        apply((d) => addLanguageOp(d, code))
        setLang(code.trim().toLowerCase())
      },
      removeLanguage: (code) => {
        apply((d) => removeLanguageOp(d, code))
        setLang((current) => (current === code ? null : current))
      },
      addTrack: () => apply((d) => addTrackOp(d, makeId("t"), t.srtNewTrack)),
      undo,
      redo,
    }),
    [apply, makeId, redo, t.srtNewTrack, undo],
  )

  const held = useHeldTool(tool_, setTool)

  /** Код физической кнопки → действие. Пересобирается при переназначении. */
  const actionByCode = useMemo(() => {
    const map = new Map<string, HotkeyAction>()
    for (const [action, code] of Object.entries(prefs.keymap)) {
      map.set(code, action as HotkeyAction)
    }
    return map
  }, [prefs.keymap])

  // Горячие клавиши. Внутри полей ввода не работают: там буквы принадлежат
  // тексту, а не инструменту (§18.4). Клавиша опознаётся по `event.code` —
  // по физической кнопке, поэтому русская раскладка ничего не ломает.
  useEffect(() => {
    const editable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return

      // При открытом окне клавиши принадлежат ему: Space в настройках должен
      // нажимать кнопку под курсором, а не запускать воспроизведение.
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

      const action = actionByCode.get(event.code)
      if (
        action === "select" ||
        action === "create" ||
        action === "razor" ||
        action === "shift" ||
        action === "merge"
      ) {
        held.press(event.code, action, event.repeat)
        event.preventDefault()
        return
      }
      if (action === "playPause") {
        clock.togglePlay()
      } else if (action === "mainWave") {
        setPref("mainWave", !prefs.mainWave)
      } else if (event.code === "Delete" || event.code === "Backspace") {
        if (selectedCueId) ops.removeCue(selectedCueId)
      } else if (event.code === "Equal" || event.code === "NumpadAdd") {
        setPref("zoom", zoomStep(prefs.zoom, 1))
      } else if (event.code === "Minus" || event.code === "NumpadSubtract") {
        setPref("zoom", zoomStep(prefs.zoom, -1))
      } else if (event.code === "F1") {
        setHelpOpen(true)
      } else if (event.code === "Escape") {
        setHelpOpen(false)
        setSettingsOpen(false)
        setTrackMode("none")
      } else {
        return
      }
      event.preventDefault()
    }

    const onKeyUp = (event: KeyboardEvent) => held.release(event.code)

    window.addEventListener("keydown", onKeyDown)
    // `keyup` слушаем без оглядки на цель: клавишу могли отпустить, уже уведя
    // фокус в поле, и тогда временный инструмент завис бы включённым.
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [
    actionByCode,
    clock,
    held,
    helpOpen,
    ops,
    prefs.mainWave,
    prefs.zoom,
    save,
    selectedCueId,
    setPref,
    settingsOpen,
  ])

  /** Имя задачи — папка, в которой она лежит. Основа имён всех выгрузок. */
  const taskName = folderPath?.split("/").pop() ?? doc?.id ?? "dialog"
  const selectedTrack = doc?.tracks.find((track) => track.id === selectedTrackId) ?? null

  /**
   * Формат из настроек — подписью у быстрых пунктов.
   *
   * Информация не основная, но важная: пункты меню не спрашивают формат, и без
   * подписи «Всё — архивом» молча отдаёт WebVTT человеку, который ждал SRT.
   */
  const formatLabel =
    prefs.exportFmt === "vtt"
      ? t.srtFmtShortVtt
      : prefs.exportFmt === "srt-bom"
        ? t.srtFmtShortSrtBom
        : t.srtFmtShortSrt

  /** Сырьё титров из папки — по запросу окна восстановления. */
  const loadSources = useCallback(
    (paths: string[]) =>
      loadSrtSources(projectId, folderPath, entries, paths, doc?.languages.original ?? null),
    [doc?.languages.original, entries, folderPath, projectId],
  )

  /**
   * Новая версия: собрать документ из папки заново.
   *
   * Здесь же, в меню восстановления, а не в отдельном углу: и то и другое —
   * ответ на «вернуть как было», только версия помнит ещё и ручные правки.
   * Текущий документ откладывается сервером, поэтому подтверждения не спрашиваем:
   * терять нечего.
   */
  const newVersion = useCallback(async () => {
    if (!doc || !projectId || !folderPath) return
    const id = toast.loading(t.srtVersionBusy)
    try {
      const { doc: fresh } = await collectTaskDoc({
        projectId,
        folderPath,
        entries,
        originalLang: doc.languages.original,
        onProgress: (progress) => toast.loading(progress.step, { id }),
        steps: { srt: t.srtBuildReading, media: t.srtBuildMedia, write: t.srtBuildWriting },
      })
      const result = await postVersion(tool.id, { action: "replace", doc: fresh })
      if (result.ok) {
        toast.success(
          result.archived ? tf(t.srtVersionArchived, { file: result.archived }) : t.srtVersionCreated,
          { id },
        )
        reload()
      } else {
        toast.error(result.message, { id })
      }
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : t.srtVersionFailed, { id })
    }
  }, [doc, entries, folderPath, projectId, reload, t, tool.id])

  /**
   * Сбросить всё до машинного результата.
   *
   * Спрашиваем прямо: это не отмена, а возврат к тому, с чего начиналось, и
   * правки человека по всем дорожкам и языкам исчезнут. Обратимо через
   * «отменить», но узнать об этом после — плохое утешение.
   */
  const restoreEverything = useCallback(async () => {
    if (!doc) return
    if (!window.confirm(t.srtRestoreAllConfirm)) return
    const scope = fullRestoreScope(doc)
    const sources = await loadSources(sourcePathsFor(doc, scope))
    if (sources.size === 0) {
      toast.error(t.srtRestoreNoSources)
      return
    }
    const report = restoreFromSrt(doc, sources, scope)
    if (report.changed === 0 && report.restored === 0 && report.renamed === 0) {
      toast.info(t.srtRestoreNothing)
      return
    }
    apply(() => report.doc)
    toast.success(
      tf(t.srtRestoreSummary, {
        changed: report.changed,
        restored: report.restored,
        renamed: report.renamed,
      }),
    )
  }, [apply, doc, loadSources, t])

  /** Отдать человеку то, что насчитал `buildExport`: файл или архив. */
  const deliver = useCallback((result: ExportResult | null) => {
    if (!result) return
    if (result.kind === "file") downloadFile(result.name, result.text, result.mime)
    else downloadFile(result.name, buildZip(result.entries, new Date()), ZIP_MIME)
  }, [])

  /**
   * Быстрые выгрузки.
   *
   * Три случая, которые нужны почти всегда. Формат берётся из настроек, язык —
   * из переключателя в топбаре; «все дорожки архивом» выгружает **все языки**,
   * какие есть в документе: «выгрузить всё» должно значить всё, а не «всё на
   * том языке, который сейчас открыт». Остальное собирается в расширенном окне,
   * чтобы меню не превращалось в форму.
   */
  const exportSelectedTrack = useCallback(() => {
    if (!doc || !selectedTrack) return
    deliver(
      buildExport(doc, taskName, {
        format: prefs.exportFmt,
        langs: [lang],
        trackIds: [selectedTrack.id],
        layout: "per-track",
      }),
    )
  }, [deliver, doc, lang, prefs.exportFmt, selectedTrack, taskName])

  const exportEverything = useCallback(() => {
    if (!doc) return
    deliver(
      buildExport(doc, taskName, {
        format: prefs.exportFmt,
        langs: [null, ...doc.languages.targets],
        trackIds: doc.tracks.map((track) => track.id),
        layout: "per-track",
      }),
    )
  }, [deliver, doc, prefs.exportFmt, taskName])

  const exportSingleFile = useCallback(() => {
    if (!doc) return
    deliver(
      buildExport(doc, taskName, {
        format: prefs.exportFmt,
        langs: [lang],
        trackIds: doc.tracks.map((track) => track.id),
        layout: "single",
      }),
    )
  }, [deliver, doc, lang, prefs.exportFmt, taskName])

  const api = useMemo<SrtApi | null>(() => {
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
        left.setSize(DEFAULT_LEFT_W)
        bottom.setSize(DEFAULT_TIMELINE_H)
      },
      pps: prefs.zoom,
      setPps: (value) => setPref("zoom", Math.min(MAX_PPS, Math.max(MIN_PPS, value))),
      tool: tool_,
      setTool,
      lang,
      setLang,
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
      trackMode,
      setTrackMode,
      loadSources,
      toggleFlag: (trackId, key) =>
        setFlags((current) => ({
          ...current,
          [trackId]: {
            ...(current[trackId] ?? { solo: false, mute: false, shy: false, wave: true }),
            [key]: !current[trackId]?.[key],
          },
        })),
      clock,
      video,
      soundMode,
      audibleTrackIds: trackAudioEntries.map((item) => item.id),
      mainMuted: soundMode !== "main",
      trackAudioUrl: (trackId) => {
        const key = trackAudioEntries.find((item) => item.id === trackId)?.entry.s3Key
        return key ? trackAudioUrls[key] ?? null : null
      },
      peaksFor: (trackId) => {
        const own = peaks.byTrack[trackId] ?? autoPeaks.byTrack[trackId]
        return own
          ? { peaks: own, own: true }
          : { peaks: peaks.main ?? autoPeaks.main, own: false }
      },
      mainPeaks: peaks.main ?? autoPeaks.main,
      visibleTracks,
      rows,
      ops,
      openSettings: () => setSettingsOpen(true),
      openHelp: () => setHelpOpen(true),
    }
  }, [
    bottom,
    clock,
    cueQuery,
    doc,
    durationMs,
    flags,
    hideShy,
    lang,
    left,
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
    taskName,
    tool_,
    trackAudioEntries,
    trackMode,
    loadSources,
    trackAudioUrls,
    trackQuery,
    video,
    visibleTracks,
  ])

  return (
    <section ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
            <LangTab active={lang === null} label={t.srtColOriginal} onClick={() => setLang(null)} />
            {doc.languages.targets.map((code) => (
              <LangTab
                key={code}
                active={lang === code}
                title={languageName(code, uiLang)}
                label={
                  doc.languages.targets.length > 1 ? code.toUpperCase() : t.srtColTranslation
                }
                onClick={() => setLang(code)}
              />
            ))}
            {/*
              Кнопка есть всегда, даже когда переводов в папке нет: перевод тут
              не только правят, но и пишут с нуля — а писать некуда, пока не
              сказано, на каком языке.
            */}
            <LanguagePicker
              taken={doc.languages.targets}
              original={doc.languages.original}
              onPick={(code) => ops.addLanguage(code)}
              onRemove={(code) => ops.removeLanguage(code)}
            />
          </div>
        ) : null}

        <div className="flex-1" />

        {doc ? (
          <span className="hidden items-center gap-1.5 font-mono text-[12px] tabular-nums text-ws-3 xl:flex">
            <Captions className="h-4 w-4 text-ws-5" />
            {tf(t.srtCounters, { cues: doc.cues.length, tracks: doc.tracks.length })}
          </span>
        ) : null}

        {doc ? <SaveBadge state={save.state} dirty={save.dirty} onFlush={save.flush} /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t.srtRestoreTitle}
              disabled={!doc}
              className="flex h-[34px] items-center gap-1.5 rounded border border-foreground/[0.07] px-2 text-ws-3 hover:bg-ws-hover hover:text-ws-1 disabled:opacity-40"
            >
              <RotateCcw className="h-[17px] w-[17px]" />
              {/*
                В какой версии работаем — видно без открытия окна. Номер тот же,
                под которым текущий документ отложится: подпись не меняется от
                самого действия.
              */}
              <span className="font-mono text-[11.5px] leading-none text-ws-4">
                v{versions.currentNo}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[280px]">
            <DropdownMenuItem
              onClick={() => void restoreEverything()}
              className="cursor-pointer flex-col items-start gap-0.5 focus:bg-foreground/10"
            >
              <span>{t.srtRestoreAll}</span>
              <span className="text-[12px] text-ws-4">{t.srtRestoreAllNote}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void newVersion()}
              className="cursor-pointer flex-col items-start gap-0.5 focus:bg-foreground/10"
            >
              <span>{t.srtVersionNew}</span>
              <span className="text-[12px] text-ws-4">{t.srtVersionNewNote}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setRestoreOpen(true)}
              className="cursor-pointer focus:bg-foreground/10"
            >
              {t.srtRestoreAdvanced}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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
          <DropdownMenuContent align="end" className="min-w-[320px]">
            <ExportMenuItem
              title={t.srtExportTrack}
              note={selectedTrack ? selectedTrack.name : t.srtExportNoTrack}
              format={formatLabel}
              disabled={!selectedTrack}
              onClick={exportSelectedTrack}
            />
            <ExportMenuItem
              title={t.srtExportArchive}
              note={tf(t.srtExportArchiveNote, {
                langs: doc ? doc.languages.targets.length + 1 : 1,
              })}
              format={formatLabel}
              onClick={exportEverything}
            />
            <ExportMenuItem
              title={t.srtExportSingle}
              format={formatLabel}
              onClick={exportSingleFile}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setExportOpen(true)}
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
        <SrtProvider value={api}>
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
                  // Ручка сидит верхом на границе зон, а не поверх соседа:
                  // иначе она перехватывает клики по краю списка реплик.
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
          {/* Внутри провайдера: окну нужен документ, дорожки и текущий язык. */}
          <SrtExportDialog open={exportOpen} onOpenChange={setExportOpen} />
          <SrtRestoreDialog
            open={restoreOpen}
            onOpenChange={setRestoreOpen}
            tool={tool}
            entries={entries}
            onReloaded={reload}
          />
        </SrtProvider>
      ) : (
        <EmptyArea state={state} tool={tool} onBuilt={reload} />
      )}

      <SrtSettingsDialog
        tool={tool}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        setPref={setPref}
        resetView={() => {
          resetPrefs()
          left.setSize(DEFAULT_LEFT_W)
          bottom.setSize(DEFAULT_TIMELINE_H)
        }}
        onOpenHelp={() => {
          setSettingsOpen(false)
          setHelpOpen(true)
        }}
      />
      <SrtHelpDialog open={helpOpen} onOpenChange={setHelpOpen} keymap={prefs.keymap} />
    </section>
  )
}

/**
 * Состояние записи.
 *
 * Отдельная строка в топбаре, а не тихая работа в фоне: человек правит чужой
 * материал в чужой папке и должен видеть, что правки доехали. Кнопка «сохранить
 * сейчас» появляется, когда есть что записывать, — на случай, когда ждать
 * затишья не хочется.
 */

/** Пункт меню экспорта: что выгружаем слева, в каком формате — справа. */
function ExportMenuItem({
  title,
  note,
  format,
  disabled,
  onClick,
}: {
  title: string
  note?: string
  format: string
  disabled?: boolean
  onClick: () => void
}) {
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
      <span className="shrink-0 self-center font-mono text-[11px] text-ws-5">{format}</span>
    </DropdownMenuItem>
  )
}

function LangTab({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "h-[26px] rounded px-2.5 text-[12px] font-semibold",
        active ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
      )}
    >
      {label}
    </button>
  )
}

/** Пока документа нет: приглашение выбрать папку, ожидание или ошибка. */
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
