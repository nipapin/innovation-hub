"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  EyeOff,
  Minus,
  Plus,
  RotateCcw,
  Scaling,
  Search,
  Trash2,
} from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  TAKE_GAIN_MAX,
  TAKE_GAIN_MIN,
  type Cue,
  type Track,
  type VoiceTake,
} from "@/lib/tools/dialog/dialog-doc"
import {
  msToX,
  ppsToSlider,
  sliderToPps,
  snapMs,
  xToMs,
  zoomStep,
} from "@/lib/tools/dialog/timeline"
import {
  isTakeStale,
  selectedTake,
  synthText,
  takeEndMs,
  takeStartMs,
  takesFor,
  voiceSample,
} from "@/lib/tools/dialog/voice"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { keyLabel } from "../shared/editor-state"
import { peakBars, type Peaks } from "@/lib/tools/dialog/peaks"
import { TimelineFrame } from "../shared/timeline-frame"
import { TrackColorPicker } from "../shared/track-color-picker"
import { withAlpha } from "../shared/tokens"
import { useVoice } from "./voice-context"

/** Порог, отделяющий клик от перетаскивания. */
const DRAG_THRESHOLD_PX = 3
/** Ручка скорости у правого края клипа. */
const HANDLE_PX = 8
/** Клип уже этого — ручки нет: иначе за тело не взяться. */
const MIN_HANDLE_WIDTH_PX = 20
/** Какую долю высоты дорожки занимает волна тейка. */
const WAVE_SHARE = 0.6
/** Высота полосы, за которую берут линию громкости, и пикселей на децибел. */
const GAIN_HIT_PX = 10
const GAIN_PX_PER_DB = 4

/**
 * Зона 4 инструмента озвучки.
 *
 * Слои перевёрнуты по сравнению с редактором титров: **титры уходят на задний
 * план** полупрозрачными блоками — они здесь ориентир, «где и что сказано», их
 * не двигают и не режут, — а на переднем плане тейки, которые как раз и правят.
 */
export function TimelinePane() {
  const { t } = useWorkspace()
  const voice = useVoice()
  const cue = voice.doc.cues.find((item) => item.id === voice.selectedCueId)

  // Блоками — реплики видимых дорожек: в озвучке ориентируются по ним же, а
  // тейков у реплики может не быть вовсе, и карта из них зияла бы дырами там,
  // где работа как раз и не сделана.
  const overview = useMemo(() => {
    const colors = new Map(voice.visibleTracks.map((track) => [track.id, track.color]))
    return voice.doc.cues
      .filter((item) => colors.has(item.trackId))
      .map((item) => ({
        startMs: item.startMs,
        endMs: item.endMs,
        color: withAlpha(colors.get(item.trackId) ?? "", 0.9),
      }))
  }, [voice.doc.cues, voice.visibleTracks])

  return (
    <TimelineFrame
      overview={overview}
      overviewLabel={t.srtMinimap}
      tracks={voice.visibleTracks}
      trackH={voice.prefs.trackH}
      durationMs={voice.durationMs}
      pps={voice.pps}
      setPps={voice.setPps}
      clock={voice.clock}
      mainPeaks={voice.mainPeaks}
      showMainWave={voice.prefs.mainWave}
      reveal={{
        key: voice.selectedCueId,
        atMs: cue?.startMs ?? 0,
        trackId: cue?.trackId ?? null,
      }}
      toolbar={(minimap) => <Toolbar minimap={minimap} />}
      columnHeader={<ColumnHeader />}
      renderRow={(track) => <TrackRow track={track} />}
      renderLane={(track) => <Lane track={track} />}
    />
  )
}

function Toolbar({ minimap }: { minimap: React.ReactNode }) {
  const { t } = useWorkspace()
  const voice = useVoice()

  return (
    <div className="flex h-10 flex-none items-center gap-2.5 border-b border-foreground/[0.07] px-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.4px] text-ws-accent">
        <span className="text-ws-action">—</span>
        {t.voiceZoneTimeline}
      </div>

      <label className="flex h-7 w-[200px] items-center gap-2 rounded-full border border-foreground/[0.07] bg-ws-raised px-2.5">
        <Search className="h-[15px] w-[15px] shrink-0 text-ws-4" />
        <input
          value={voice.trackQuery}
          onChange={(e) => voice.setTrackQuery(e.target.value)}
          placeholder={t.srtSearchTracks}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ws-1 outline-none placeholder:text-ws-5"
        />
      </label>

      <button
        type="button"
        onClick={() => voice.setHideShy(!voice.hideShy)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded border border-foreground/[0.07] px-2.5 text-[12px]",
          voice.hideShy ? "bg-[#8b6fd6] text-ws-well" : "text-ws-3 hover:bg-ws-hover",
        )}
      >
        <EyeOff className="h-4 w-4" />
        {t.srtShy}
      </button>

      <button
        type="button"
        title={tf(t.srtMainWave, { key: keyLabel(voice.prefs.keymap.mainWave) })}
        onClick={() => voice.setPref("mainWave", !voice.prefs.mainWave)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded border border-foreground/[0.07]",
          voice.prefs.mainWave ? "bg-ws-action/25 text-ws-accent" : "text-ws-3 hover:bg-ws-hover",
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
          onClick={() => voice.setPps(zoomStep(voice.pps, -1))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm text-ws-3 hover:text-ws-1"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={ppsToSlider(voice.pps)}
          onChange={(e) => voice.setPps(sliderToPps(Number(e.target.value)))}
          aria-label={t.srtZoom}
          className="h-1 w-[140px] cursor-ew-resize accent-ws-action"
        />
        <button
          type="button"
          title={t.srtZoomIn}
          onClick={() => voice.setPps(zoomStep(voice.pps, 1))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm text-ws-3 hover:text-ws-1"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="w-[52px] text-right font-mono text-[11px] tabular-nums text-ws-3">
          {tf(t.srtZoomLabel, { pps: Math.round(voice.pps) })}
        </span>
      </div>
    </div>
  )
}

function ColumnHeader() {
  const { t } = useWorkspace()
  const voice = useVoice()

  return (
    <div className="flex h-10 flex-none items-center gap-1 border-b border-foreground/[0.07] px-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
        {t.srtTracks}
      </span>
      <div className="flex-1" />
      <ModeButton
        title={t.srtTrackReorderHint}
        on={voice.trackMode === "reorder"}
        onClick={() => voice.setTrackMode(voice.trackMode === "reorder" ? "none" : "reorder")}
        activeClass="border-ws-action bg-ws-action/20 text-ws-1"
      >
        <ArrowDownUp className="h-[15px] w-[15px]" />
      </ModeButton>
      <ModeButton
        title={t.srtTrackDeleteHint}
        on={voice.trackMode === "delete"}
        onClick={() => voice.setTrackMode(voice.trackMode === "delete" ? "none" : "delete")}
        activeClass="border-destructive bg-destructive/20 text-ws-1"
      >
        <Trash2 className="h-[15px] w-[15px]" />
      </ModeButton>
    </div>
  )
}

/**
 * Строка дорожки.
 *
 * Кроме цвета и имени — **пример голоса**: то, по чему синтез будет говорить за
 * этого персонажа. По умолчанию стем из оригинала, отделённый на предыдущем шаге.
 */
function TrackRow({ track }: { track: Track }) {
  const { t } = useWorkspace()
  const voice = useVoice()
  const flags = voice.flags[track.id]
  const selected = track.id === voice.selectedTrackId
  const ordered = voice.doc.tracks.slice().sort((a, b) => a.no - b.no)
  const first = ordered[0]?.id === track.id
  const last = ordered[ordered.length - 1]?.id === track.id
  const sample = voiceSample(track)

  const remove = () => {
    const own = voice.doc.cues.filter((cue) => cue.trackId === track.id).length
    if (own > 0 && !window.confirm(tf(t.srtTrackDeleteConfirm, { name: track.name, cues: own }))) {
      return
    }
    voice.ops.removeTrack(track.id)
  }

  return (
    <div
      onClick={() => voice.selectTrack(track.id)}
      style={{ height: voice.prefs.trackH }}
      className={cn(
        "flex items-center gap-1.5 border-b border-foreground/[0.06] px-2.5",
        selected && "bg-ws-select/[0.10]",
      )}
    >
      <TrackColorPicker
        color={track.color}
        onPick={(color) => voice.ops.setTrackColor(track.id, color)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <TrackName track={track} />
        <span
          title={sample ? tf(t.voiceSampleIs, { file: sample }) : t.voiceSampleNone}
          className="truncate px-1.5 font-mono text-[10px] text-ws-5"
        >
          {sample ?? t.voiceSampleNone}
        </span>
      </div>

      {voice.trackMode === "reorder" ? (
        <>
          <FlagButton title={t.srtTrackUp} disabled={first} onClick={() => voice.ops.moveTrack(track.id, -1)}>
            <ArrowUp className="h-[14px] w-[14px]" />
          </FlagButton>
          <FlagButton title={t.srtTrackDown} disabled={last} onClick={() => voice.ops.moveTrack(track.id, 1)}>
            <ArrowDown className="h-[14px] w-[14px]" />
          </FlagButton>
        </>
      ) : voice.trackMode === "delete" ? (
        <FlagButton
          title={tf(t.srtTrackDelete, { name: track.name })}
          onClick={remove}
          className="border-destructive/40 text-destructive hover:bg-destructive/15"
        >
          <Trash2 className="h-[14px] w-[14px]" />
        </FlagButton>
      ) : (
        <>
          <FlagButton
            title={t.srtSolo}
            active={flags?.solo ?? false}
            activeClass="bg-ws-out text-ws-well"
            onClick={() => voice.toggleFlag(track.id, "solo")}
          >
            <span className="text-[11px] font-bold">S</span>
          </FlagButton>
          <FlagButton
            title={t.srtMute}
            active={flags?.mute ?? false}
            activeClass="bg-[#e0a33a] text-ws-well"
            onClick={() => voice.toggleFlag(track.id, "mute")}
          >
            <span className="text-[11px] font-bold">M</span>
          </FlagButton>
          <FlagButton
            title={t.srtShy}
            active={flags?.shy ?? false}
            activeClass="bg-[#8b6fd6] text-ws-well"
            onClick={() => voice.toggleFlag(track.id, "shy")}
          >
            <EyeOff className="h-[14px] w-[14px]" />
          </FlagButton>
        </>
      )}
    </div>
  )
}

function TrackName({ track }: { track: Track }) {
  const { t } = useWorkspace()
  const voice = useVoice()
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
        className="min-w-0 cursor-default select-none truncate px-1.5 text-[13px] font-medium text-ws-1"
      >
        {track.name}
      </span>
    )
  }

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== track.name) voice.ops.renameTrack(track.id, next)
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
      className="h-6 min-w-0 rounded border border-ws-action bg-ws-well px-1.5 text-[13px] font-medium text-ws-1 outline-none"
    />
  )
}

function FlagButton({
  title,
  active,
  activeClass,
  disabled,
  className,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  activeClass?: string
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
        active && activeClass ? activeClass : "text-ws-3 hover:bg-ws-hover",
        className,
        disabled && "cursor-default text-ws-5 opacity-50 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

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

/** Полоса дорожки: титры фоном, тейки поверх. */
function Lane({ track }: { track: Track }) {
  const voice = useVoice()
  const flags = voice.flags[track.id]
  const soloed = Object.values(voice.flags).some((f) => f.solo)
  const dimmed = (soloed && !flags?.solo) || Boolean(flags?.mute)
  const selected = track.id === voice.selectedTrackId
  const height = voice.prefs.trackH
  const own = voice.doc.cues.filter((cue) => cue.trackId === track.id)

  return (
    <div
      style={{ height }}
      className={cn(
        "relative border-b border-foreground/[0.06]",
        selected && "bg-ws-select/[0.05]",
      )}
    >
      {/*
        Титры — фоном и без обработчиков: здесь их не двигают и не режут, это
        ориентир «где и что сказано». Клик по ним всё же выбирает реплику: так
        человек попадает в нужную строку списка, не отыскивая её глазами.
      */}
      {own.map((cue) => (
        <div
          key={`bg-${cue.id}`}
          onPointerDown={() => voice.selectCue(cue.id)}
          title={synthText(voice.doc, cue, voice.lang)}
          style={{
            left: msToX(cue.startMs, voice.pps),
            width: Math.max(2, msToX(cue.endMs - cue.startMs, voice.pps)),
          }}
          className={cn(
            "absolute bottom-0 top-0 overflow-hidden border-x border-foreground/[0.06] bg-foreground/[0.035]",
            cue.id === voice.selectedCueId && "bg-foreground/[0.07]",
          )}
        >
          <span className="pointer-events-none block truncate px-1.5 pt-0.5 text-[10px] text-ws-5">
            {synthText(voice.doc, cue, voice.lang)}
          </span>
        </div>
      ))}

      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 top-0 border-l border-foreground/[0.10] bg-ws-well/60"
        style={{ left: msToX(voice.mediaEndMs, voice.pps) }}
      />

      {own.map((cue) => {
        const take = selectedTake(cue, voice.lang)
        return take ? (
          <TakeClip
            key={take.id}
            cue={cue}
            take={take}
            color={track.color}
            height={height}
            dimmed={dimmed}
          />
        ) : null
      })}
    </div>
  )
}

/**
 * Клип тейка.
 *
 * Начинается в `startMs + offsetMs` и длится столько, сколько длится звук с
 * учётом скорости: попадать в длительность титра он не обязан, важно только
 * начало. Метка у левого края показывает начало реплики — по ней и видно, на
 * сколько тейк от него отъехал.
 *
 * Цвет — цвет своей дорожки, как и полоска у имени: на полотне с четырьмя
 * персонажами клипы одного цвета не дают понять, чей голос, — а именно это и
 * ищут глазами. Выделение остаётся отдельным цветом, иначе оно потерялось бы
 * среди дорожек.
 */
function TakeClip({
  cue,
  take,
  color,
  height,
  dimmed,
}: {
  cue: Cue
  take: VoiceTake
  color: string
  height: number
  dimmed: boolean
}) {
  const { t } = useWorkspace()
  const voice = useVoice()
  const selected = cue.id === voice.selectedCueId
  const startMs = takeStartMs(cue, take)
  const left = msToX(startMs, voice.pps)
  const width = Math.max(6, msToX(takeEndMs(cue, take) - startMs, voice.pps))
  const waveH = Math.max(12, Math.round(height * WAVE_SHARE))
  const stale = isTakeStale(voice.doc, cue, take)
  const versions = takesFor(cue, voice.lang)
  const drag = useTakeDrag()

  /**
   * Громкость колесом с Alt: тянуть её отдельной ручкой на клипе негде.
   *
   * Слушаем сами, а не через `onWheel`. Причина не в `preventDefault`, а в
   * порядке: React ставит обработчик на корень страницы, а зум таймлинии слушает
   * колесо на своём полотне — то есть **ниже** корня и, значит, раньше. Через
   * `onWheel` Alt+колесо над клипом сначала меняло масштаб и только потом
   * громкость. Свой слушатель на самом клипе идёт первым и останавливает событие,
   * не доводя его до полотна.
   */
  const clipRef = useRef<HTMLDivElement | null>(null)
  const live = useRef({ voice, cue, take })
  live.current = { voice, cue, take }

  useEffect(() => {
    const el = clipRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      const now = live.current
      now.voice.ops.adjustTake(now.cue.id, now.take.id, {
        gainDb: now.take.gainDb + (event.deltaY < 0 ? 1 : -1),
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  return (
    <div
      ref={clipRef}
      onDoubleClick={(event) => {
        event.stopPropagation()
        voice.ops.resetTake(cue.id, take.id)
      }}
      style={{
        left,
        width,
        height: Math.max(18, height - 16),
        top: 8,
        opacity: dimmed ? 0.4 : 1,
        background: withAlpha(color, selected ? 0.3 : 0.16),
        borderColor: stale ? "#e0a33a" : selected ? undefined : withAlpha(color, 0.55),
      }}
      className={cn(
        "absolute overflow-hidden rounded border",
        selected && !stale && "border-ws-action",
        stale && "border-dashed",
      )}
    >
      <div
        onPointerDown={(event) => drag(event, cue, take, "move")}
        style={{ cursor: "grab" }}
        className="absolute inset-0"
      />

      <TakeWave
        peaks={voice.peaksForTake(take)}
        color={color}
        widthPx={width}
        height={waveH}
      />

      {width >= MIN_HANDLE_WIDTH_PX ? <GainLine cue={cue} take={take} drag={drag} /> : null}

      <span className="pointer-events-none absolute left-1.5 top-0.5 flex items-center gap-1 font-mono text-[10px] tabular-nums text-ws-2">
        {take.offsetMs !== 0 ? <span>{formatOffset(take.offsetMs)}</span> : null}
        {take.rate !== 1 ? <span>{take.rate.toFixed(2)}×</span> : null}
        {take.gainDb !== 0 ? <span>{take.gainDb > 0 ? "+" : ""}{take.gainDb} dB</span> : null}
      </span>

      {/*
        Кнопка есть всегда, даже когда версия одна: за списком версий стоят ещё
        «вписать в реплику» и «сбросить подстройку», и появляться со второй генерации
        они не должны — нужны они как раз после первой.

        Правый верхний угол: волна прижата к нижнему краю, и снизу кнопка её
        закрывала — а по волне и правят.
      */}
      <div className="absolute right-0 top-0 z-[2]" style={{ marginRight: HANDLE_PX + 2 }}>
        <VersionPicker cue={cue} takes={versions} current={take} />
      </div>

      {width >= MIN_HANDLE_WIDTH_PX ? (
        <div
          onPointerDown={(event) => drag(event, cue, take, "rate")}
          title={t.voiceDragRate}
          style={{
            width: HANDLE_PX,
            cursor: "ew-resize",
            background: selected ? undefined : withAlpha(color, 0.5),
          }}
          className={cn("absolute bottom-0 right-0 top-0", selected && "bg-ws-action/90")}
        />
      ) : null}
    </div>
  )
}

/**
 * Волна тейка внутри клипа.
 *
 * Своя, а не общая с дорожками: та рисует полосу во всю ширину полотна и ставит
 * себя по смещению скролла, а здесь холст живёт внутри клипа и должен покрывать
 * ровно его. Тейк короткий — секунды, — поэтому рисуется целиком, без окна.
 */
function TakeWave({
  peaks,
  color,
  widthPx,
  height,
}: {
  peaks: Peaks | null
  /** Цвет дорожки: волна тейка — та же метка персонажа, что и сам клип. */
  color: string
  widthPx: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const width = Math.max(1, Math.floor(widthPx))
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!peaks) return

    // Вся длительность тейка растянута на ширину клипа: в ней уже учтена
    // скорость, поэтому отдельно её применять не надо.
    const bars = peakBars(peaks, width, width / Math.max(1, peaks.durationMs))
    ctx.globalAlpha = 0.7
    ctx.fillStyle = color
    for (let x = 0; x < width; x += 1) {
      const amplitude = Math.max(Math.abs(bars.min[x]), Math.abs(bars.max[x]))
      const barHeight = Math.max(1, amplitude * height)
      ctx.fillRect(x, height - barHeight, 1, barHeight)
    }
    ctx.globalAlpha = 1
  }, [color, height, peaks, widthPx])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0"
    />
  )
}

/**
 * Громкость тейка: линия через клип, которую тянут вверх и вниз.
 *
 * Линией, а не колесом: колесо с Alt работает, но об этом надо знать заранее, а
 * ручку видно. И линией, а не полосой у края: высота линии — это и есть уровень,
 * то есть она сама показывает то, что меняет, и не отнимает у клипа место.
 *
 * Тонкая и полупрозрачная нарочно: главное на клипе — волна, а линия рядом с ней
 * должна читаться как отметка, а не как второй объект. Ярче становится под
 * курсором, когда за неё собираются взяться.
 *
 * По краям линия не доходит до конца: там остаётся место, чтобы взяться за клип и
 * тянуть его влево-вправо, а справа — за ручку скорости.
 *
 * Вверх — громче. Двойной клик сбрасывает **только громкость**: двойной клик по
 * самому клипу сбрасывает все три числа, и попасть по нему, целясь в линию, было
 * бы досадно.
 */
function GainLine({
  cue,
  take,
  drag,
}: {
  cue: Cue
  take: VoiceTake
  drag: ReturnType<typeof useTakeDrag>
}) {
  const { t } = useWorkspace()
  const voice = useVoice()
  // 0 — самый тихий, 1 — самый громкий. Ноль децибел приходится на две трети
  // высоты: диапазон несимметричный (−24…+12), и приподнятая линия оставляет
  // место тому, что чаще нужно, — убавить.
  const level = (take.gainDb - TAKE_GAIN_MIN) / (TAKE_GAIN_MAX - TAKE_GAIN_MIN)

  return (
    <div
      onPointerDown={(event) => drag(event, cue, take, "gain")}
      onDoubleClick={(event) => {
        event.stopPropagation()
        voice.ops.adjustTake(cue.id, take.id, { gainDb: 0 })
      }}
      title={tf(t.voiceDragGain, { value: take.gainDb > 0 ? `+${take.gainDb}` : take.gainDb })}
      style={{
        left: HANDLE_PX,
        right: HANDLE_PX,
        bottom: `${level * 100}%`,
        height: GAIN_HIT_PX,
        // Полоса захвата шире линии, поэтому её сдвигаем на половину высоты:
        // иначе линия окажется у края полосы и мимо неё легко попасть.
        marginBottom: -GAIN_HIT_PX / 2,
        cursor: "ns-resize",
      }}
      className="group absolute z-[3] flex items-center"
    >
      <span className="h-px w-full bg-ws-accent/50 group-hover:h-[2px] group-hover:bg-ws-accent" />
    </div>
  )
}

/** Метка начала реплики отрисована сдвигом: `+120 мс` понятнее, чем пиксели. */
function formatOffset(ms: number): string {
  return `${ms > 0 ? "+" : "−"}${Math.abs(ms)}`
}

/**
 * Меню тейка на клипе: версии и подстройка.
 *
 * Не только версии, хотя счётчик на кнопке про них: сюда же вынесены «вписать в
 * титр» и «сброс», потому что делать это надо там, где смотрят на клип.
 */
function VersionPicker({
  cue,
  takes,
  current,
}: {
  cue: Cue
  takes: VoiceTake[]
  current: VoiceTake
}) {
  const { t } = useWorkspace()
  const voice = useVoice()
  /**
   * Меню закрываем сами.
   *
   * Пункты здесь — обычные кнопки, а не `DropdownMenuItem`: в строке версии их
   * две (выбрать и удалить), и пунктом меню такую строку не выразить. Значит и
   * закрытие на нас: выбрал — меню ушло. Удаление — исключение, после него меню
   * остаётся: версий убирают обычно несколько подряд.
   */
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t.voiceTakeMenu}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-5 items-center gap-0.5 rounded border border-foreground/[0.14] bg-ws-well/80 px-1 font-mono text-[10px] text-ws-2 hover:border-foreground/30"
        >
          {takes.indexOf(current) + 1}/{takes.length}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel className="text-[11.5px] uppercase tracking-[1.4px] text-ws-5">
          {t.voiceVersions}
        </DropdownMenuLabel>
        {takes.map((take, index) => (
          <div
            key={take.id}
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-foreground/5"
          >
            <button
              type="button"
              onClick={() => {
                voice.ops.selectTake(cue.id, take.id)
                setOpen(false)
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="w-4 flex-none text-ws-5">
                {take.id === current.id ? <Check className="h-3.5 w-3.5 text-ws-out" /> : null}
              </span>
              <span className="font-mono text-[11px] text-ws-4">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums text-ws-2">
                {tf(t.voiceSeconds, { value: (take.durationMs / 1000).toFixed(1) })}
              </span>
              <span className="flex-none font-mono text-[10px] text-ws-5">
                {new Date(take.createdAt).toLocaleTimeString()}
              </span>
            </button>
            <button
              type="button"
              title={takes.length > 1 ? t.voiceRemoveTake : t.voiceRemoveLastTake}
              onClick={() => voice.ops.removeTake(cue.id, take.id)}
              className="flex h-6 w-6 flex-none items-center justify-center rounded border border-transparent text-ws-5 hover:border-destructive/40 hover:text-destructive"
            >
              <Trash2 className="h-[14px] w-[14px]" />
            </button>
          </div>
        ))}
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={() => {
            voice.ops.fitTake(cue.id, current.id)
            setOpen(false)
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-foreground/5"
        >
          <Scaling className="h-[14px] w-[14px] text-ws-4" />
          {t.voiceFitShort}
        </button>
        <button
          type="button"
          onClick={() => {
            voice.ops.resetTake(cue.id, current.id)
            setOpen(false)
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-foreground/5"
        >
          <RotateCcw className="h-[14px] w-[14px] text-ws-4" />
          {t.voiceResetTake}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Перетаскивание клипа: тело меняет сдвиг, правый край — скорость, полоса слева —
 * громкость.
 *
 * Ничто из этого не портит файл: это три числа в документе, и «отменить» работает
 * как на любой другой правке.
 */
function useTakeDrag() {
  const voice = useVoice()
  const ref = useRef(voice)
  ref.current = voice

  return useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      cue: Cue,
      take: VoiceTake,
      mode: "move" | "rate" | "gain",
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const api = ref.current
      api.selectCue(cue.id, { seek: false })
      api.selectTrack(cue.trackId)

      const startX = event.clientX
      const startY = event.clientY
      const pps = api.pps
      const offset0 = take.offsetMs
      const rate0 = take.rate
      const gain0 = take.gainDb
      const widthMs = take.durationMs / rate0
      const gesture = `${mode}:${take.id}:${event.timeStamp}`
      let moved = false

      const move = (e: PointerEvent) => {
        if (mode === "gain") {
          // Вверх — громче: `clientY` растёт вниз, поэтому знак обратный.
          const dy = startY - e.clientY
          if (!moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return
          moved = true
          ref.current.ops.adjustTake(
            cue.id,
            take.id,
            { gainDb: Math.round(gain0 + dy / GAIN_PX_PER_DB) },
            gesture,
          )
          return
        }

        const dx = e.clientX - startX
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        moved = true
        const api2 = ref.current

        if (mode === "move") {
          let next = offset0 + xToMs(dx, pps)
          if (api2.prefs.snap) {
            // Прилипаем к началам реплик дорожки: начало тейка — то, что важно,
            // и попадать в него на глаз мучительно.
            const edges = api2.doc.cues
              .filter((item) => item.trackId === cue.trackId)
              .map((item) => item.startMs - cue.startMs)
            next = snapMs(next, edges, pps)
          }
          api2.ops.adjustTake(cue.id, take.id, { offsetMs: next }, gesture)
          return
        }

        // Тянем правый край: меняется скорость, а начало остаётся на месте.
        const nextWidth = Math.max(120, widthMs + xToMs(dx, pps))
        api2.ops.adjustTake(cue.id, take.id, { rate: take.durationMs / nextWidth }, gesture)
      }

      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    },
    [],
  )
}
