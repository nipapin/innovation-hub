"use client"

import { useEffect, useRef } from "react"
import { AudioLines, Film, Pause, Play, SkipBack, SkipForward } from "lucide-react"

import { formatTc } from "@/lib/tools/dialog/timecode"
import { cn } from "@/lib/utils"
import type { EditorClock } from "./editor-state"

/**
 * Зона превью — общая для инструментов раздела.
 *
 * Видео здесь единственные часы: ни таймлиния, ни списки своего времени не
 * имеют, они читают `currentTime` и рисуют по нему. Второй источник времени
 * означал бы рассинхрон, который потом невозможно поймать.
 *
 * Что показывать поверх кадра и что играть вместе с ним — решает инструмент и
 * передаёт готовыми узлами: у титров это текст реплики и стемы дорожек, у
 * озвучки — те же титры и сгенерированные тейки. Каркасу разница неизвестна.
 */
export function PreviewPane({
  videoRef,
  videoUrl,
  missing,
  muted,
  durationMs,
  clock,
  labels,
  onStep,
  overlay,
  audio,
  sound,
  silent,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  videoUrl: string | null
  /** Что написать вместо кадра, когда видео нет. */
  missing: string
  muted: boolean
  durationMs: number
  clock: EditorClock
  labels: { play: string; prev: string; next: string; sound: string }
  onStep: (direction: 1 | -1) => void
  /** Поверх кадра: титры или что положит инструмент. */
  overlay?: React.ReactNode
  /** Скрытые проигрыватели: стемы дорожек, тейки озвучки. */
  audio?: React.ReactNode
  /** Что сейчас звучит — строкой, которую собрал инструмент. */
  sound: React.ReactNode
  /** Не слышно ничего: иконка приглушается. */
  silent?: boolean
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-ws-well p-3">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[5px] border border-foreground/[0.07] bg-black">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            muted={muted}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-ws-5">
            <Film className="h-10 w-10" />
            <p className="text-[12px] tracking-[0.32px]">{missing}</p>
          </div>
        )}
        {overlay}
      </div>

      {audio}

      <Transport
        clock={clock}
        durationMs={durationMs}
        labels={labels}
        onStep={onStep}
      />

      <div className="flex items-center gap-2.5 rounded-[5px] border border-foreground/[0.07] bg-ws-raised px-3 py-2.5">
        <AudioLines
          className={cn("h-[18px] w-[18px] shrink-0", silent ? "text-ws-5" : "text-ws-accent")}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.32px] text-ws-4">
            {labels.sound}
          </span>
          <span className="truncate text-[13px] text-ws-2">{sound}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Транспорт. Часы обновляются подпиской и правят текст узла напрямую: при
 * шестидесяти кадрах в секунду `setState` перерисовывал бы всю зону.
 */
function Transport({
  clock,
  durationMs,
  labels,
  onStep,
}: {
  clock: EditorClock
  durationMs: number
  labels: { play: string; prev: string; next: string }
  onStep: (direction: 1 | -1) => void
}) {
  const nowRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = nowRef.current
      if (el) el.textContent = formatTc(ms)
    })
  }, [clock])

  return (
    <div className="flex items-center gap-2.5 rounded-[5px] border border-foreground/[0.07] bg-ws-raised px-2.5 py-2">
      <button
        type="button"
        onClick={clock.togglePlay}
        title={labels.play}
        className="flex h-8 w-8 items-center justify-center rounded bg-ws-action text-white hover:bg-ws-action-hover"
      >
        {clock.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={() => onStep(-1)}
        title={labels.prev}
        className="flex h-[30px] w-[30px] items-center justify-center rounded border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        <SkipBack className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        title={labels.next}
        className="flex h-[30px] w-[30px] items-center justify-center rounded border border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        <SkipForward className="h-[18px] w-[18px]" />
      </button>
      <div className="flex-1" />
      <span ref={nowRef} className="font-mono text-[13px] tabular-nums text-ws-1">
        {formatTc(0)}
      </span>
      <span className="font-mono text-[13px] tabular-nums text-ws-4">
        / {formatTc(durationMs)}
      </span>
    </div>
  )
}
