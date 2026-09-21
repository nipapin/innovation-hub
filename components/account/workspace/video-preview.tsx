"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react"

import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/** Ширина кадра-подсказки; высота считается из пропорции самого видео. */
const THUMB_WIDTH = 160
const SKIP_SECONDS = 5

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`
}

/**
 * Кадр под курсором на полосе перемотки.
 *
 * Второй, скрытый `<video>` с тем же адресом: у одного элемента нельзя
 * одновременно играть и отматывать на произвольную позицию ради картинки —
 * перемотка сбивала бы воспроизведение. Кадр рисуем в `<canvas>`, потому что сам
 * элемент показывать негде: он должен оставаться невидимым.
 *
 * `crossOrigin` здесь намеренно не выставлен: адрес превью ведёт редиректом на
 * чужой источник, и требование CORS сломало бы загрузку там, где заголовки на
 * бакете не настроены. Испорченный им canvas нам не мешает — кадр только
 * показывается, а попиксельно (`getImageData`, `toDataURL`) не читается.
 *
 * Скрытый элемент появляется только при первом наведении на полосу: без этого
 * каждое открытие превью тянуло бы файл дважды.
 */
function useScrubPreview(src: string) {
  const scrubRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [armed, setArmed] = useState(false)
  const [ready, setReady] = useState(false)

  // Очередь глубиной в один кадр. Курсор идёт по полосе быстрее, чем элемент
  // успевает отмотать, и без очереди каждое движение мыши ставило бы новый
  // currentTime поверх незавершённого — элемент захлёбывается и не отдаёт ни
  // одного кадра. Поэтому: пока идёт перемотка, храним только последнюю
  // запрошенную позицию, а после 'seeked' отматываем сразу к ней.
  const pendingRef = useRef<number | null>(null)
  const busyRef = useRef(false)

  const pump = useCallback(() => {
    const el = scrubRef.current
    if (!el || busyRef.current) return
    const next = pendingRef.current
    if (next === null) return
    pendingRef.current = null
    busyRef.current = true
    el.currentTime = next
  }, [])

  const arm = useCallback(() => setArmed(true), [])

  const request = useCallback(
    (time: number) => {
      if (!ready) return
      pendingRef.current = time
      pump()
    },
    [ready, pump],
  )

  const onSeeked = useCallback(() => {
    const el = scrubRef.current
    const canvas = canvasRef.current
    if (el && canvas) {
      const ratio = el.videoHeight / (el.videoWidth || 1)
      const height = Math.max(1, Math.round(THUMB_WIDTH * (ratio || 0.5625)))
      if (canvas.width !== THUMB_WIDTH || canvas.height !== height) {
        canvas.width = THUMB_WIDTH
        canvas.height = height
      }
      try {
        canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height)
      } catch {
        // Кадр — украшение: если отрисовка не удалась (например, из-за
        // ограничений на источник), перемотка обязана продолжать работать.
      }
    }
    busyRef.current = false
    pump()
  }, [pump])

  const node = armed ? (
    <video
      ref={scrubRef}
      src={src}
      muted
      playsInline
      preload="metadata"
      className="pointer-events-none absolute h-px w-px opacity-0"
      onLoadedData={() => setReady(true)}
      onSeeked={onSeeked}
    />
  ) : null

  return { node, canvasRef, arm, request, ready }
}

/**
 * Плеер превью со своей полосой перемотки.
 *
 * Нативные `controls` заменены не ради вида: они не умеют показывать кадр под
 * курсором, а он — главное, чего не хватало при поиске нужного места в ролике.
 *
 * Размер задаёт контейнер, как и у остальных видов превью: `h-full w-auto` на
 * самом элементе, обёртка `inline-flex`, чтобы панель управления была шириной
 * ровно с картинку, а не с колонку (у вертикального видео иначе висела бы над
 * пустотой).
 */
export function VideoPreview({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const { t } = useWorkspace()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [full, setFull] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [buffered, setBuffered] = useState(0)
  // Позиция курсора на полосе: null — курсора там нет. Во время перетаскивания
  // держим её же, поэтому кадр виден и когда тянут ползунок пальцем.
  const [hover, setHover] = useState<number | null>(null)
  const draggingRef = useRef(false)

  const scrub = useScrubPreview(src)

  const timeAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || !duration) return 0
      const rect = track.getBoundingClientRect()
      const ratio = (clientX - rect.left) / (rect.width || 1)
      return Math.min(duration, Math.max(0, ratio * duration))
    },
    [duration],
  )

  const seekTo = useCallback((time: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = time
    setCurrent(time)
  }, [])

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
  }, [])

  const toggleFull = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void wrap.requestFullscreen().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  // Перетаскивание слушаем на окне, а не на полосе: курсор при быстром движении
  // уходит за её границы, и на самой полосе события до отпускания не доходят.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      const time = timeAt(e.clientX)
      setHover(time)
      seekTo(time)
      scrub.request(time)
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setHover(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [timeAt, seekTo, scrub])

  const onTrackDown = (e: React.PointerEvent) => {
    if (!duration) return
    draggingRef.current = true
    const time = timeAt(e.clientX)
    setHover(time)
    seekTo(time)
    scrub.arm()
    scrub.request(time)
  }

  const onTrackMove = (e: React.PointerEvent) => {
    if (!duration || draggingRef.current) return
    const time = timeAt(e.clientX)
    setHover(time)
    scrub.arm()
    scrub.request(time)
  }

  /**
   * Стрелки и пробел на полосе. `stopPropagation` обязателен: рабочая область
   * слушает те же клавиши на окне (пробел закрывает превью, стрелки листают
   * соседние файлы), и без остановки всплытия перемотка закрывала бы окно.
   */
  const onTrackKeyDown = (e: React.KeyboardEvent) => {
    const el = videoRef.current
    if (!el) return
    let handled = true
    if (e.key === "ArrowRight") seekTo(Math.min(duration, el.currentTime + SKIP_SECONDS))
    else if (e.key === "ArrowLeft") seekTo(Math.max(0, el.currentTime - SKIP_SECONDS))
    else if (e.key === "Home") seekTo(0)
    else if (e.key === "End") seekTo(duration)
    else if (e.key === " " || e.key === "Enter") togglePlay()
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const progress = duration ? (current / duration) * 100 : 0
  const bufferedPct = duration ? (buffered / duration) * 100 : 0
  const hoverPct = duration && hover !== null ? (hover / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className={cn(
        "group relative inline-flex h-full max-w-full items-center justify-center bg-card",
        className,
      )}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const el = e.currentTarget
          const ranges = el.buffered
          // Интересует именно та часть, что идёт подряд от текущей позиции:
          // с Range-запросами буфер рваный, и последний диапазон может лежать
          // далеко впереди, где пользователь только что искал кадр.
          for (let i = 0; i < ranges.length; i += 1) {
            if (ranges.start(i) <= el.currentTime && ranges.end(i) >= el.currentTime) {
              setBuffered(ranges.end(i))
              return
            }
          }
        }}
        className="h-full w-auto max-w-full object-contain"
      />
      {scrub.node}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-background/80 to-transparent px-3 pb-2 pt-6",
          "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
          (!playing || hover !== null) && "opacity-100",
        )}
      >
        <div className="relative">
          {/* Кадр под курсором. Держится над полосой и прижат к её краям,
              чтобы у начала и конца ролика не уезжать за пределы плеера. */}
          {hover !== null && scrub.ready ? (
            <div
              className="pointer-events-none absolute bottom-5 z-10 -translate-x-1/2 rounded-md border border-border/60 bg-card p-1 shadow-lg"
              style={{
                left: `clamp(${THUMB_WIDTH / 2 + 6}px, ${hoverPct}%, calc(100% - ${THUMB_WIDTH / 2 + 6}px))`,
              }}
            >
              <canvas
                ref={scrub.canvasRef}
                className="block rounded-[3px]"
                style={{ width: THUMB_WIDTH }}
              />
              <span className="mt-0.5 block text-center text-[11px] tabular-nums text-foreground">
                {fmtTime(hover)}
              </span>
            </div>
          ) : null}

          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={t.previewSeek}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={fmtTime(current)}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerLeave={() => {
              if (!draggingRef.current) setHover(null)
            }}
            onKeyDown={onTrackKeyDown}
            // Высокая зона захвата при тонкой полосе: попасть курсором в 4px
            // трудно, поэтому полоса рисуется внутри отступов.
            className="cursor-pointer py-1.5 outline-none"
          >
            <div className="relative h-1 w-full rounded-full bg-secondary">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
                style={{ width: `${bufferedPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
                style={{ left: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-foreground">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? t.previewPause : t.previewPlay}
            className="rounded p-1 hover:bg-foreground/10"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? t.previewUnmute : t.previewMute}
            className="rounded p-1 hover:bg-foreground/10"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {fmtTime(current)} / {fmtTime(duration)}
          </span>
          <button
            type="button"
            onClick={toggleFull}
            aria-label={t.previewFullscreen}
            className="ml-auto rounded p-1 hover:bg-foreground/10"
          >
            {full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
