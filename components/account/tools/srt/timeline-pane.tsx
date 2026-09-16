"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpDown,
  AudioLines,
  ChevronsRightLeft,
  EyeOff,
  Minus,
  MousePointer2,
  Plus,
  Scissors,
  Search,
  SquarePlus,
  Trash2,
} from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { tf } from "@/components/account/i18n"
import {
  canMergeCues,
  mergeSurvivorId,
  translationOf,
  type Cue,
  type Track,
} from "@/lib/tools/dialog/dialog-doc"
import {
  msToX,
  ppsToSlider,
  sliderToPps,
  snapEdges,
  snapMs,
  xToMs,
  zoomStep,
} from "@/lib/tools/dialog/timeline"
import { cn } from "@/lib/utils"
import {
  keyLabel,
} from "../shared/editor-state"
import {
  type TimelineTool,
} from "./prefs"
import { useSrt } from "./srt-context"
import { TimelineFrame } from "../shared/timeline-frame"
import { withAlpha } from "../shared/tokens"
import { TrackColorPicker } from "../shared/track-color-picker"
import { type ViewportSource } from "../shared/viewport"
import { WaveCanvas } from "../shared/wave-canvas"

/** Порог, отделяющий клик от перетаскивания (§17.5). */
const DRAG_THRESHOLD_PX = 3
/** Клип уже этого — ручек нет вовсе, иначе за него не взяться (§17.4). */
const MIN_HANDLE_WIDTH_PX = 18
/** Минимальная длительность реплики при растягивании. */
const MIN_CUE_MS = 200
/** Какую долю высоты дорожки занимает волна у нижнего края. */
const WAVE_SHARE = 0.5

const RAZOR_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke='%23ff4d00' stroke-width='2'><circle cx='6' cy='18' r='3'/><circle cx='18' cy='18' r='3'/><path d='M8 16 L20 3 M16 16 L4 3'/></svg>\") 12 12, crosshair"

function cursorFor(tool: TimelineTool, overClip: boolean): string {
  if (tool === "razor") return RAZOR_CURSOR
  if (tool === "create") return "crosshair"
  // Перенос ходит только вверх-вниз, и курсор обязан это показывать до того,
  // как человек потянет и обнаружит, что вбок реплика не идёт.
  if (tool === "shift") return overClip ? "ns-resize" : "default"
  if (tool === "merge") return "default"
  return overClip ? "grab" : "default"
}

/** Зона 4: панель дорожек слева и полотно справа. */
export function TimelinePane() {
  const { t } = useWorkspace()
  const srt = useSrt()
  const cue = srt.doc.cues.find((item) => item.id === srt.selectedCueId)

  // Что показать на миникарте: реплики видимых дорожек, каждая цветом своей.
  // Скрытая дорожка не показывается и здесь — карта обязана совпадать с тем, что
  // под ней, иначе по ней нельзя ориентироваться.
  const overview = useMemo(() => {
    const colors = new Map(srt.visibleTracks.map((track) => [track.id, track.color]))
    return srt.doc.cues
      .filter((item) => colors.has(item.trackId))
      .map((item) => ({
        startMs: item.startMs,
        endMs: item.endMs,
        color: withAlpha(colors.get(item.trackId) ?? "", 0.9),
      }))
  }, [srt.doc.cues, srt.visibleTracks])

  return (
    <TimelineFrame
      overview={overview}
      overviewLabel={t.srtMinimap}
      tracks={srt.visibleTracks}
      trackH={srt.prefs.trackH}
      durationMs={srt.durationMs}
      pps={srt.pps}
      setPps={srt.setPps}
      clock={srt.clock}
      mainPeaks={srt.mainPeaks}
      showMainWave={srt.prefs.mainWave}
      reveal={{
        key: srt.selectedCueId,
        atMs: cue?.startMs ?? 0,
        trackId: cue?.trackId ?? null,
      }}
      toolbar={(minimap) => <TimelineToolbar minimap={minimap} />}
      columnHeader={<TrackColumnHeader />}
      renderRow={(track) => <TrackHeader track={track} />}
      renderLane={(track, context) => (
        <Lane track={track} viewport={context.viewport} lanesRef={context.lanesRef} />
      )}
    />
  )
}

function TimelineToolbar({ minimap }: { minimap: React.ReactNode }) {
  const { t } = useWorkspace()
  const srt = useSrt()

  // Подпись на кнопке — из текущей раскладки, а не из литерала: клавиши
  // переназначаются в настройках, и подсказка обязана это показывать.
  const tools: { id: TimelineTool; icon: typeof MousePointer2; title: string }[] = [
    { id: "select", icon: MousePointer2, title: t.srtToolSelect },
    { id: "create", icon: SquarePlus, title: t.srtToolCreate },
    { id: "razor", icon: Scissors, title: t.srtToolRazor },
    { id: "shift", icon: ArrowUpDown, title: t.srtToolShift },
    { id: "merge", icon: ChevronsRightLeft, title: t.srtToolMerge },
  ]

  return (
    <div className="flex h-10 flex-none items-center gap-2.5 border-b border-foreground/[0.07] px-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.4px] text-ws-accent">
        <span className="text-ws-action">—</span>
        {t.srtTimeline}
      </div>

      <label className="flex h-7 w-[200px] items-center gap-2 rounded-full border border-foreground/[0.07] bg-ws-raised px-2.5">
        <Search className="h-[15px] w-[15px] shrink-0 text-ws-4" />
        <input
          value={srt.trackQuery}
          onChange={(e) => srt.setTrackQuery(e.target.value)}
          placeholder={t.srtSearchTracks}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ws-1 outline-none placeholder:text-ws-5"
        />
      </label>

      <button
        type="button"
        onClick={() => srt.setHideShy(!srt.hideShy)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded border border-foreground/[0.07] px-2.5 text-[12px]",
          srt.hideShy ? "bg-[#8b6fd6] text-ws-well" : "text-ws-3 hover:bg-ws-hover",
        )}
      >
        <EyeOff className="h-4 w-4" />
        {t.srtShy}
      </button>

      <span className="h-5 w-px bg-foreground/[0.07]" />

      <div className="flex items-center gap-[3px] rounded-md border border-foreground/[0.07] bg-ws-raised p-[3px]">
        {tools.map((item) => {
          const Icon = item.icon
          const active = srt.tool === item.id
          const shortcut = keyLabel(srt.prefs.keymap[item.id])
          return (
            <button
              key={item.id}
              type="button"
              title={tf(item.title, { key: shortcut })}
              onClick={() => srt.setTool(item.id)}
              className={cn(
                "relative flex h-6 w-[30px] items-center justify-center rounded",
                active ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
              )}
            >
              <Icon className="h-[17px] w-[17px]" />
              <span className="absolute bottom-0 right-[2px] font-mono text-[8px] opacity-70">
                {shortcut}
              </span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        title={tf(t.srtMainWave, { key: keyLabel(srt.prefs.keymap.mainWave) })}
        onClick={() => srt.setPref("mainWave", !srt.prefs.mainWave)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded border border-foreground/[0.07]",
          srt.prefs.mainWave ? "bg-ws-action/25 text-ws-accent" : "text-ws-3 hover:bg-ws-hover",
        )}
      >
        <AudioLines className="h-4 w-4" />
      </button>

      {minimap}

      <div
        title={t.srtZoomWheel}
        className="flex h-7 items-center gap-2 rounded border border-foreground/[0.07] bg-ws-raised px-2.5"
      >
        <button
          type="button"
          title={t.srtZoomOut}
          onClick={() => srt.setPps(zoomStep(srt.pps, -1))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm text-ws-3 hover:text-ws-1"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={ppsToSlider(srt.pps)}
          onChange={(e) => srt.setPps(sliderToPps(Number(e.target.value)))}
          aria-label={t.srtZoom}
          className="h-1 w-[140px] cursor-ew-resize accent-ws-action"
        />
        <button
          type="button"
          title={t.srtZoomIn}
          onClick={() => srt.setPps(zoomStep(srt.pps, 1))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm text-ws-3 hover:text-ws-1"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="w-[52px] text-right font-mono text-[11px] tabular-nums text-ws-3">
          {tf(t.srtZoomLabel, { pps: Math.round(srt.pps) })}
        </span>
      </div>
    </div>
  )
}

/**
 * Панель дорожек. Скроллится не сама: повторяет вертикальный сдвиг полотна,
 * иначе имя дорожки уезжает от своей полосы.
 */
/** Шапка панели дорожек: название зоны и режимы работы с дорожками. */
function TrackColumnHeader() {
  const { t } = useWorkspace()
  const srt = useSrt()

  return (
    <div className="flex h-10 flex-none items-center gap-1 border-b border-foreground/[0.07] px-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
        {t.srtTracks}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        title={t.srtAddTrackHint}
        onClick={srt.ops.addTrack}
        className="flex h-6 w-6 items-center justify-center rounded border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        <Plus className="h-[15px] w-[15px]" />
      </button>
      <ModeButton
        title={t.srtTrackReorderHint}
        on={srt.trackMode === "reorder"}
        onClick={() => srt.setTrackMode(srt.trackMode === "reorder" ? "none" : "reorder")}
        activeClass="border-ws-action bg-ws-action/20 text-ws-1"
      >
        <ArrowDownUp className="h-[15px] w-[15px]" />
      </ModeButton>
      <ModeButton
        title={t.srtTrackDeleteHint}
        on={srt.trackMode === "delete"}
        onClick={() => srt.setTrackMode(srt.trackMode === "delete" ? "none" : "delete")}
        activeClass="border-destructive bg-destructive/20 text-ws-1"
      >
        <Trash2 className="h-[15px] w-[15px]" />
      </ModeButton>
    </div>
  )
}

function TrackHeader({ track }: { track: Track }) {
  const { t } = useWorkspace()
  const srt = useSrt()
  const flags = srt.flags[track.id]
  const selected = track.id === srt.selectedTrackId
  const wave = srt.peaksFor(track.id)
  const ordered = srt.doc.tracks.slice().sort((a, b) => a.no - b.no)
  const first = ordered[0]?.id === track.id
  const last = ordered[ordered.length - 1]?.id === track.id

  /**
   * Удаление дорожки уносит её реплики, поэтому спрашиваем — и говорим сколько.
   * Пустую дорожку убираем сразу: терять там нечего.
   */
  const remove = () => {
    const own = srt.doc.cues.filter((cue) => cue.trackId === track.id).length
    if (own > 0 && !window.confirm(tf(t.srtTrackDeleteConfirm, { name: track.name, cues: own }))) {
      return
    }
    srt.ops.removeTrack(track.id)
  }

  return (
    <div
      onClick={() => srt.selectTrack(track.id)}
      style={{ height: srt.prefs.trackH }}
      className={cn(
        "flex items-center gap-1.5 border-b border-foreground/[0.06] px-2.5",
        selected && "bg-ws-select/[0.10]",
      )}
    >
      <TrackColorPicker
        color={track.color}
        onPick={(color) => srt.ops.setTrackColor(track.id, color)}
      />
      <TrackName track={track} />
      {!wave.own && wave.peaks ? (
        <span
          title={t.srtSharedWave}
          className="flex-none rounded-full border border-foreground/[0.10] px-1.5 text-[10px] text-ws-5"
        >
          {t.srtSharedWaveShort}
        </span>
      ) : null}
      {srt.trackMode === "reorder" ? (
        <>
          <TrackFlagButton
            title={t.srtTrackUp}
            active={false}
            activeClass=""
            disabled={first}
            onClick={() => srt.ops.moveTrack(track.id, -1)}
          >
            <ArrowUp className="h-[14px] w-[14px]" />
          </TrackFlagButton>
          <TrackFlagButton
            title={t.srtTrackDown}
            active={false}
            activeClass=""
            disabled={last}
            onClick={() => srt.ops.moveTrack(track.id, 1)}
          >
            <ArrowDown className="h-[14px] w-[14px]" />
          </TrackFlagButton>
        </>
      ) : srt.trackMode === "delete" ? (
        <TrackFlagButton
          title={tf(t.srtTrackDelete, { name: track.name })}
          active={false}
          activeClass=""
          onClick={() => remove()}
          className="border-destructive/40 text-destructive hover:bg-destructive/15"
        >
          <Trash2 className="h-[14px] w-[14px]" />
        </TrackFlagButton>
      ) : (
        <>
          <TrackFlagButton
            title={wave.peaks ? t.srtTrackWave : t.srtTrackNoWave}
            active={Boolean(wave.peaks) && (flags?.wave ?? false)}
            disabled={!wave.peaks}
            onClick={() => srt.toggleFlag(track.id, "wave")}
            activeClass="text-ws-accent"
          >
            <AudioLines className="h-[14px] w-[14px]" />
          </TrackFlagButton>
          <TrackFlagButton
            title={t.srtSolo}
            active={flags?.solo ?? false}
            onClick={() => srt.toggleFlag(track.id, "solo")}
            activeClass="bg-ws-out text-ws-well"
          >
            <span className="text-[11px] font-bold">S</span>
          </TrackFlagButton>
          <TrackFlagButton
            title={t.srtMute}
            active={flags?.mute ?? false}
            onClick={() => srt.toggleFlag(track.id, "mute")}
            activeClass="bg-[#e0a33a] text-ws-well"
          >
            <span className="text-[11px] font-bold">M</span>
          </TrackFlagButton>
          <TrackFlagButton
            title={t.srtShy}
            active={flags?.shy ?? false}
            onClick={() => srt.toggleFlag(track.id, "shy")}
            activeClass="bg-[#8b6fd6] text-ws-well"
          >
            <EyeOff className="h-[14px] w-[14px]" />
          </TrackFlagButton>
        </>
      )}
    </div>
  )
}

/**
 * Имя дорожки: смотрится как текст, правится по двойному клику.
 *
 * Было поле ввода, всегда готовое к правке, — и оно перехватывало всё, что
 * происходит над именем: колесо, выделение, случайный клик посреди
 * перетаскивания. Переименование — редкая операция, ей достаточно двойного
 * клика; всё остальное время это подпись.
 */
function TrackName({ track }: { track: Track }) {
  const { t } = useWorkspace()
  const srt = useSrt()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(track.name)

  if (!editing) {
    return (
      <span
        title={t.srtRenameTrackHint}
        onDoubleClick={() => {
          setDraft(track.name)
          setEditing(true)
        }}
        className="min-w-0 flex-1 cursor-default select-none truncate px-1.5 text-[13px] font-medium text-ws-1"
      >
        {track.name}
      </span>
    )
  }

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== track.name) srt.ops.renameTrack(track.id, next)
  }

  return (
    <input
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setEditing(false)
      }}
      className="h-7 min-w-0 flex-1 rounded border border-ws-action bg-ws-well px-1.5 text-[13px] font-medium text-ws-1 outline-none"
    />
  )
}

function TrackFlagButton({
  title,
  active,
  activeClass,
  disabled,
  className,
  onClick,
  children,
}: {
  title: string
  active: boolean
  activeClass: string
  disabled?: boolean
  className?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-6 w-6 flex-none items-center justify-center rounded border border-foreground/[0.07]",
        active ? activeClass : "text-ws-3 hover:bg-ws-hover",
        className,
        disabled && "cursor-default text-ws-5 opacity-50 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

/** Кнопка-режим в шапке панели дорожек: включена — горит. */
function ModeButton({
  title,
  on,
  activeClass,
  onClick,
  children,
}: {
  title: string
  on: boolean
  activeClass: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded border",
        on ? activeClass : "border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1",
      )}
    >
      {children}
    </button>
  )
}

/** Полоса одной дорожки: волна, серая зона за концом материала, клипы. */
function Lane({
  track,
  viewport,
  lanesRef,
}: {
  track: Track
  viewport: ViewportSource
  lanesRef: React.RefObject<HTMLDivElement | null>
}) {
  const srt = useSrt()
  const flags = srt.flags[track.id]
  // Приглушены клипы дорожек, которых сейчас не слышно (§15.3). В режиме solo
  // это все, кроме выбранных, — включая те, что кто-то раньше выключил через
  // mute: solo старше, и картинка обязана совпадать со звуком.
  const dimmed =
    srt.soundMode === "solo"
      ? !flags?.solo
      : srt.soundMode === "mute"
        ? Boolean(flags?.mute)
        : false
  const selected = track.id === srt.selectedTrackId
  const wave = srt.peaksFor(track.id)
  const height = srt.prefs.trackH
  const waveH = Math.max(14, Math.round(height * WAVE_SHARE))

  const startDrag = useClipDrag(lanesRef)

  const onLaneDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (srt.tool !== "create" || event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      const startMs = Math.max(0, xToMs(event.clientX - rect.left, srt.pps))
      const id = srt.ops.addCue(track.id, startMs, startMs + 2000)
      srt.selectTrack(track.id)
      startDrag(event, { id, trackId: track.id, startMs, endMs: startMs + 2000 }, "right")
    },
    [srt, startDrag, track.id],
  )

  return (
    <div
      onPointerDown={onLaneDown}
      style={{ height, cursor: cursorFor(srt.tool, false) }}
      className={cn(
        "relative border-b border-foreground/[0.06]",
        selected && "bg-ws-select/[0.05]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 top-0 border-l border-foreground/[0.10] bg-ws-well/60"
        style={{ left: msToX(srt.mediaEndMs, srt.pps) }}
      />
      {srt.doc.cues
        .filter((cue) => cue.trackId === track.id)
        .map((cue) => (
          <Clip
            key={cue.id}
            cue={cue}
            height={height}
            dimmed={dimmed}
            onDrag={startDrag}
          />
        ))}
      {/*
        Волна — последней, то есть поверх клипов, но полосой у нижнего края.
        Под клипами она пропадала именно там, где нужна: по ней ищут настоящее
        начало речи. Текст титра при этом прижат к верху клипа, так что они не
        спорят. Кликам волна не мешает — `pointer-events: none`.
      */}
      {flags?.wave === false ? null : (
        <WaveCanvas
          peaks={wave.peaks}
          pps={srt.pps}
          height={waveH}
          color={wave.own ? track.color : null}
          opacity={wave.own ? (flags?.solo ? 0.85 : 0.6) : 0.24}
          viewport={viewport}
        />
      )}
    </div>
  )
}

function Clip({
  cue,
  height,
  dimmed,
  onDrag,
}: {
  cue: Cue
  height: number
  dimmed: boolean
  onDrag: ReturnType<typeof useClipDrag>
}) {
  const srt = useSrt()
  const selected = cue.id === srt.selectedCueId
  const left = msToX(cue.startMs, srt.pps)
  const width = Math.max(3, msToX(cue.endMs - cue.startMs, srt.pps))
  const handles = width >= MIN_HANDLE_WIDTH_PX && srt.tool !== "merge"

  // На клипе — текст выбранного языка. Перевода ещё нет — показываем оригинал
  // приглушённо: так на глаз видно, что именно осталось перевести, и полотно не
  // превращается в ряд пустых прямоугольников.
  const translated = srt.lang ? translationOf(cue, srt.lang) : ""
  const untranslated = Boolean(srt.lang) && !translated
  const label = translated || cue.text

  /**
   * Объединение: выбранная реплика — точка отсчёта, кликают по соседней.
   *
   * Кандидаты подсвечиваются заранее, остальные получают курсор «нельзя»: иначе
   * правило «только соседние и только на одной дорожке» приходилось бы
   * выяснивать методом проб.
   */
  const mergeMode = srt.tool === "merge"
  const anchorId = srt.selectedCueId
  const isAnchor = mergeMode && cue.id === anchorId
  const mergeable =
    mergeMode && anchorId != null && canMergeCues(srt.doc, anchorId, cue.id)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (srt.tool === "razor") {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        srt.selectCue(cue.id)
        srt.ops.splitCue(cue.id, cue.startMs + xToMs(event.clientX - rect.left, srt.pps))
        return
      }
      if (srt.tool === "merge") {
        event.preventDefault()
        event.stopPropagation()
        // Клик по неподходящей реплике не ошибка, а смена точки отсчёта: так
        // выбирают следующую пару, не переключая инструмент.
        if (!mergeable || anchorId == null) {
          srt.selectCue(cue.id)
          return
        }
        const survivor = mergeSurvivorId(srt.doc, anchorId, cue.id)
        srt.ops.mergeCues(anchorId, cue.id)
        if (survivor) srt.selectCue(survivor, { seek: false })
        return
      }
      onDrag(event, cue, "move")
    },
    [anchorId, cue, mergeable, onDrag, srt],
  )

  return (
    <div
      onPointerDown={onPointerDown}
      title={label}
      style={{
        left,
        width,
        height: Math.max(20, height - 18),
        top: 6,
        opacity: dimmed ? 0.35 : 1,
        cursor: mergeMode
          ? mergeable
            ? "pointer"
            : isAnchor
              ? "default"
              : "not-allowed"
          : cursorFor(srt.tool, true),
      }}
      className={cn(
        "absolute flex items-start overflow-hidden rounded border",
        selected
          ? "border-ws-action bg-ws-action/30"
          : "border-ws-accent/40 bg-ws-accent/[0.14]",
        cue.status === "approved" && !selected && "bg-ws-accent/25",
        mergeable && "border-dashed border-ws-out bg-ws-out/20",
      )}
    >
      {handles ? (
        <div
          onPointerDown={(e) => onDrag(e, cue, "left")}
          className={cn(
            "absolute bottom-0 left-0 top-0 w-[6px] cursor-ew-resize",
            selected ? "bg-ws-action/90" : "bg-ws-accent/35",
          )}
        />
      ) : null}
      <span
        className={cn(
          "pointer-events-none truncate px-3 pt-[3px] text-[12px]",
          untranslated ? "italic text-ws-3 opacity-70" : "text-ws-1",
        )}
      >
        {label}
      </span>
      {handles ? (
        <div
          onPointerDown={(e) => onDrag(e, cue, "right")}
          className={cn(
            "absolute bottom-0 right-0 top-0 w-[6px] cursor-ew-resize",
            selected ? "bg-ws-action/90" : "bg-ws-accent/35",
          )}
        />
      ) : null}
    </div>
  )
}

type DragMode = "move" | "left" | "right"
type DragCue = { id: string; trackId: string; startMs: number; endMs: number }

/**
 * Перетаскивание клипа: сдвиг, растягивание за ручку и перенос на другую
 * дорожку инструментом переноса.
 *
 * Порог в 3 px отделяет клик от перетаскивания — без него любой выбор реплики
 * сдвигал бы её на пиксель (§17.5).
 */
function useClipDrag(lanesRef: React.RefObject<HTMLDivElement | null>) {
  const srt = useSrt()
  const srtRef = useRef(srt)
  srtRef.current = srt

  return useCallback(
    (event: React.PointerEvent<HTMLElement>, cue: DragCue, mode: DragMode) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const api = srtRef.current
      api.selectCue(cue.id, { seek: false })
      api.selectTrack(cue.trackId)

      const startX = event.clientX
      const startY = event.clientY
      const { startMs, endMs } = cue
      const pps = api.pps
      const visible = api.visibleTracks
      const lanesRect = lanesRef.current?.getBoundingClientRect() ?? null
      const trackH = api.prefs.trackH
      const gesture = `${mode}:${cue.id}:${event.timeStamp}`
      let moved = false

      const move = (e: PointerEvent) => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        // Порог считаем по обеим осям: перенос между дорожками — жест
        // вертикальный, и по одному dx его начало не поймать.
        if (
          !moved &&
          mode === "move" &&
          Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD_PX
        ) {
          return
        }
        moved = true

        // Инструмент переноса двигает реплику только по дорожкам: тайминги
        // остаются те же. Иначе одно движение мыши меняет сразу и персонажа, и
        // время — а это две разные правки, и вторая тут случайная.
        if (mode === "move" && srtRef.current.tool === "shift") {
          if (!lanesRect) return
          const index = Math.max(
            0,
            Math.min(visible.length - 1, Math.floor((e.clientY - lanesRect.top) / trackH)),
          )
          const nextTrack = visible[index]?.id
          if (!nextTrack) return
          srtRef.current.ops.setTiming(cue.id, startMs, endMs, nextTrack, gesture)
          return
        }

        const delta = xToMs(dx, pps)
        let nextStart = startMs
        let nextEnd = endMs

        if (mode === "move") {
          nextStart = Math.max(0, startMs + delta)
          nextEnd = nextStart + (endMs - startMs)
        } else if (mode === "left") {
          nextStart = Math.min(endMs - MIN_CUE_MS, Math.max(0, startMs + delta))
        } else {
          nextEnd = Math.max(startMs + MIN_CUE_MS, endMs + delta)
        }

        if (srtRef.current.prefs.snap) {
          const edges = snapEdges(srtRef.current.doc.cues, cue.trackId, cue.id)
          if (mode !== "right") {
            const snapped = snapMs(nextStart, edges, pps)
            if (mode === "move") nextEnd += snapped - nextStart
            nextStart = snapped
          }
          if (mode !== "left") nextEnd = snapMs(nextEnd, edges, pps)
        }

        srtRef.current.ops.setTiming(cue.id, nextStart, nextEnd, undefined, gesture)
      }

      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    },
    [lanesRef],
  )
}
