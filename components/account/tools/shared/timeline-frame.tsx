"use client"

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import type { Track } from "@/lib/tools/dialog/dialog-doc"
import type { Peaks } from "@/lib/tools/dialog/peaks"
import { MAX_PPS, MIN_PPS, msToX, xToMs } from "@/lib/tools/dialog/timeline"
import type { EditorClock } from "./editor-state"
import { TimelineMinimap, type OverviewBlock } from "./timeline-minimap"
import { TimelineRuler } from "./timeline-ruler"
import { useViewportSource, type ViewportSource } from "./viewport"

/** Хвост после конца материала, чтобы последний клип не липнул к краю. */
export const TAIL_MS = 3000
/** Высота линейки времени — та же, что внутри `TimelineRuler`. */
export const RULER_H = 40
/** Отступ, на который отводим показываемый клип от края окна. */
const REVEAL_PAD_PX = 96
/**
 * Полоса у края, в которой курсор воспроизведения тянет полотно за собой.
 *
 * Не ноль: если ждать, пока курсор буквально дойдёт до края, он на кадр-два
 * пропадает из виду.
 */
const EDGE_PX = 28
/**
 * Куда попадает курсор после скачка при проигрывании.
 *
 * Треть окна остаётся позади, две трети — впереди. Позади нужно оставить: без
 * этого курсор оказывается вплотную к левому краю, и не видно, что он только что
 * прошёл. Впереди — потому что смотрят вперёд, и чем больше видно, тем реже
 * скачок; при мелком масштабе окно длиннее, поэтому и шаг сам собой больше.
 */
const PAGE_LANDING = 1 / 3
/** Насколько быстро полотно уезжает, когда курсор мыши вышел за край окна. */
const DRAG_SPEED = 0.35
const DRAG_MAX_STEP_PX = 60

export type LaneContext = {
  viewport: ViewportSource
  lanesRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Каркас таймлинии — общий для инструментов раздела.
 *
 * Берёт на себя всё, что не зависит от того, что лежит на дорожках: прокрутку и
 * зум (включая колесо с зажатым Cmd, где секунда под курсором остаётся на
 * месте), линейку, курсор воспроизведения, перемотку по линейке, показ
 * выбранного клипа и то, что панель дорожек слева повторяет вертикальный сдвиг
 * полотна.
 *
 * Что рисуется на дорожках, что в панели и что в её шапке — решает инструмент и
 * передаёт узлами. Каркасу неизвестно, титры там или тейки озвучки.
 */
export function TimelineFrame({
  tracks,
  trackH,
  durationMs,
  pps,
  setPps,
  clock,
  mainPeaks,
  showMainWave,
  reveal,
  overview,
  overviewLabel,
  toolbar,
  columnHeader,
  renderRow,
  renderLane,
}: {
  tracks: Track[]
  trackH: number
  /** Длительность материала без хвоста: его каркас добавит сам. */
  durationMs: number
  pps: number
  setPps: (value: number) => void
  clock: EditorClock
  mainPeaks: Peaks | null
  showMainWave: boolean
  /**
   * Что показать в окне. Прокрутка срабатывает на смену `key`, а не на каждую
   * перерисовку: иначе она спорила бы и с зумом, и с рукой человека.
   */
  reveal: { key: string | null; atMs: number; trackId: string | null } | null
  /** Что показать блоками на миникарте: реплики, тейки — решает инструмент. */
  overview: OverviewBlock[]
  overviewLabel: string
  /**
   * Строка над таймлинией. Приходит готовым узлом, но с одной вставкой:
   * миникарту каркас собирает сам — только он знает окно просмотра и полотно, —
   * а место ей в строке выбирает инструмент, у которого там свои кнопки.
   */
  toolbar: (minimap: React.ReactNode) => React.ReactNode
  columnHeader: React.ReactNode
  renderRow: (track: Track) => React.ReactNode
  renderLane: (track: Track, context: LaneContext) => React.ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const lanesRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const viewport = useViewportSource(scrollerRef)
  const fullMs = durationMs + TAIL_MS
  const laneWidth = msToX(fullMs, pps)

  const live = useRef({ pps, setPps, tracks, trackH, reveal, playing: clock.playing })
  live.current = { pps, setPps, tracks, trackH, reveal, playing: clock.playing }

  /** Секунда под курсором на момент зума — после смены масштаба вернём её на место. */
  const zoomAnchor = useRef<{ ms: number; x: number } | null>(null)

  // Зум колесом с Cmd / Ctrl / Alt. Слушаем сами, а не через `onWheel`: React
  // ставит пассивный обработчик, а без `preventDefault` браузер на Cmd+колесо
  // масштабирует всю страницу.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.metaKey || event.ctrlKey || event.altKey)) return
      event.preventDefault()
      const now = live.current
      const x = event.clientX - el.getBoundingClientRect().left
      zoomAnchor.current = { ms: xToMs(el.scrollLeft + x, now.pps), x }
      // Плавно и по экспоненте: шаг зума пропорционален текущему масштабу,
      // иначе на мелком масштабе колесо почти ничего не меняет.
      const next = now.pps * Math.exp(-event.deltaY * 0.003)
      now.setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, next)))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Возвращаем секунду под курсор до того, как кадр покажут: в обычном эффекте
  // это дало бы видимый прыжок полотна.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const anchor = zoomAnchor.current
    if (!el || !anchor) return
    zoomAnchor.current = null
    el.scrollLeft = Math.max(0, msToX(anchor.ms, pps) - anchor.x)
  }, [pps])

  const revealed = useRef<string | null>(null)
  useEffect(() => {
    const el = scrollerRef.current
    const now = live.current
    const target = now.reveal
    if (!el || !target || target.key === revealed.current) return
    revealed.current = target.key
    if (!target.key) return

    const x = msToX(target.atMs, now.pps)
    if (x < el.scrollLeft + REVEAL_PAD_PX) {
      el.scrollLeft = Math.max(0, x - REVEAL_PAD_PX)
    } else if (x > el.scrollLeft + el.clientWidth - REVEAL_PAD_PX) {
      el.scrollLeft = x - el.clientWidth + REVEAL_PAD_PX
    }

    const index = now.tracks.findIndex((track) => track.id === target.trackId)
    if (index < 0) return
    const top = RULER_H + index * now.trackH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + now.trackH > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + now.trackH - el.clientHeight
    }
  }, [reveal?.key])

  // Панель дорожек не скроллится сама: она повторяет сдвиг полотна, иначе имя
  // дорожки уезжает от своей полосы.
  useEffect(() => {
    return viewport.subscribe((view) => {
      const el = columnRef.current
      if (el) el.style.transform = `translateY(${-view.top}px)`
    })
  }, [viewport])

  /** Колесо над панелью дорожек листает полотно: своей прокрутки у неё нет. */
  const forwardWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop += event.deltaY
    el.scrollLeft += event.deltaX
  }, [])

  /**
   * Курсор воспроизведения следом за проигрыванием.
   *
   * Скачком, а не плавно: полотно, ползущее под неподвижным курсором, читается
   * хуже — глаз теряет, где он находится, потому что двигается всё сразу. Скачок
   * происходит редко и оставляет впереди две трети окна.
   *
   * Только во время проигрывания: при перетаскивании курсор ведут рукой, и там
   * полотно едет по-другому (см. `scrub`).
   */
  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = scrollerRef.current
      if (!el || !live.current.playing) return
      const x = msToX(ms, live.current.pps)
      const width = el.clientWidth
      if (x >= el.scrollLeft && x <= el.scrollLeft + width - EDGE_PX) return
      el.scrollLeft = Math.max(0, x - width * PAGE_LANDING)
    })
  }, [clock])

  /**
   * Перемотка по линейке.
   *
   * Пока тянут, полотно едет за курсором мыши: у края окна оно начинает
   * прокручиваться, а если курсор вышел за окно — курсор воспроизведения
   * встаёт на самый край и полотно уезжает под него. Так до конца материала можно
   * дотянуть одним движением, не отпуская кнопку, и курсор всё время виден.
   */
  const scrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const content = event.currentTarget
      const scroller = scrollerRef.current
      let clientX = event.clientX

      const seek = () => {
        // Границы читаем каждый раз: полотно едет, и та же точка экрана
        // означает уже другое время.
        const view = scroller?.getBoundingClientRect()
        const x = view ? Math.min(Math.max(clientX, view.left), view.right) : clientX
        clock.seek(xToMs(x - content.getBoundingClientRect().left, live.current.pps))
      }
      seek()

      /** Насколько курсор мыши вышел за полосу у края окна; 0 — не вышел. */
      const overshoot = (): number => {
        if (!scroller) return 0
        const view = scroller.getBoundingClientRect()
        if (clientX > view.right - EDGE_PX) return clientX - (view.right - EDGE_PX)
        if (clientX < view.left + EDGE_PX) return clientX - (view.left + EDGE_PX)
        return 0
      }

      let frame = 0
      const pan = () => {
        frame = requestAnimationFrame(pan)
        const past = overshoot()
        if (past === 0 || !scroller) return
        const step = Math.min(DRAG_MAX_STEP_PX, EDGE_PX * DRAG_SPEED + Math.abs(past) * DRAG_SPEED)
        const before = scroller.scrollLeft
        scroller.scrollLeft += Math.sign(past) * step
        // Упёрлись в край материала — дальше двигать нечего, но перемотку
        // повторить надо: курсор мог остаться не там, где его отпустят.
        if (scroller.scrollLeft !== before) seek()
      }
      frame = requestAnimationFrame(pan)

      const move = (e: PointerEvent) => {
        clientX = e.clientX
        seek()
      }
      const up = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    },
    [clock],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-ws-panel">
      {toolbar(
        <TimelineMinimap
          blocks={overview}
          durationMs={fullMs}
          peaks={mainPeaks}
          showWave={showMainWave}
          laneWidth={laneWidth}
          viewport={viewport}
          scroller={scrollerRef}
          clock={clock}
          label={overviewLabel}
        />,
      )}
      <div className="flex min-h-0 flex-1">
        <div
          onWheel={forwardWheel}
          className="flex w-[288px] flex-none flex-col border-r border-foreground/[0.07] bg-ws-well"
        >
          {columnHeader}
          <div className="min-h-0 flex-1 overflow-hidden">
            <div ref={columnRef} className="will-change-transform">
              {tracks.map((track) => (
                <div key={track.id}>{renderRow(track)}</div>
              ))}
            </div>
          </div>
        </div>

        <div ref={scrollerRef} className="relative min-w-0 flex-1 overflow-auto">
          <div className="relative" style={{ width: laneWidth, minWidth: "100%" }}>
            <TimelineRuler
              durationMs={fullMs}
              pps={pps}
              peaks={mainPeaks}
              showWave={showMainWave}
              viewport={viewport}
              onScrub={scrub}
            />
            <div ref={lanesRef}>
              {tracks.map((track) => (
                <div key={track.id}>{renderLane(track, { viewport, lanesRef })}</div>
              ))}
            </div>
            <Playhead pps={pps} clock={clock} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Курсор воспроизведения. Двигается подпиской, вне рендера React. */
function Playhead({ pps, clock }: { pps: number; clock: EditorClock }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = ref.current
      if (el) el.style.transform = `translateX(${msToX(ms, pps)}px)`
    })
  }, [clock, pps])

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute bottom-0 top-0 z-[4] w-px bg-ws-playhead will-change-transform"
    >
      <div
        className="absolute left-[-6px] top-0 h-[10px] w-[13px] bg-ws-playhead"
        style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
      />
    </div>
  )
}
