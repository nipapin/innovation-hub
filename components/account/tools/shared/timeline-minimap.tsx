"use client"

import { useCallback, useEffect, useRef } from "react"

import { peakBars, type Peaks } from "@/lib/tools/dialog/peaks"
import type { EditorClock } from "./editor-state"
import { readToken } from "./tokens"
import type { ViewportSource } from "./viewport"

/**
 * Миникарта таймлинии — весь материал в одну строку над дорожками.
 *
 * Зачем: полотно длиннее окна в десятки раз, и добраться с начала в конец можно
 * было только прокруткой — колесом с зажатым Shift, много и долго. Здесь всё
 * помещается сразу: видно, где вообще есть речь, и рамкой — какой кусок сейчас
 * на экране. Рамку можно взять и перетащить, и это единственный способ попасть в
 * конец материала одним движением.
 *
 * Занимает пустое место между кнопками инструментов и масштабом, растягиваясь по
 * ширине: своей ширины у неё нет вовсе, и ею же задаётся масштаб карты. Поэтому
 * ширину меряем у себя (`ResizeObserver`), а не считаем от окна.
 *
 * Рисование — canvas, положение рамки и курсора — стили по подписке. Ни то, ни
 * другое не проходит через состояние React: прокрутка идёт покадрово, и рендер
 * дерева на каждый кадр съел бы всё.
 */

/** Высота карты: та же, что у кнопок в строке, чтобы не растить панель. */
const H = 28
/** Полоса блоков сверху; остаток высоты занимает волна. */
const BLOCK_H = 7
const BLOCK_TOP = 3
/** Рамку уже этого не рисуем: за неё нельзя взяться. */
const MIN_FRAME_PX = 8

export type OverviewBlock = {
  startMs: number
  endMs: number
  /** Цвет дорожки; пусто — цвет по умолчанию. */
  color?: string | null
}

export function TimelineMinimap({
  blocks,
  durationMs,
  peaks,
  showWave,
  laneWidth,
  viewport,
  scroller,
  clock,
  label,
}: {
  blocks: OverviewBlock[]
  /** Полная длительность полотна вместе с хвостом. */
  durationMs: number
  peaks: Peaks | null
  showWave: boolean
  /** Ширина полотна в пикселях при текущем масштабе. */
  laneWidth: number
  viewport: ViewportSource
  scroller: React.RefObject<HTMLElement | null>
  clock: EditorClock
  label: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const headRef = useRef<HTMLDivElement | null>(null)
  /** Своя ширина в пикселях: от неё считается всё остальное. */
  const widthRef = useRef(0)

  const live = useRef({ blocks, durationMs, peaks, showWave, laneWidth })
  live.current = { blocks, durationMs, peaks, showWave, laneWidth }

  /** Пиксель карты на миллисекунду материала. */
  const scaleOf = useCallback(() => {
    const { durationMs: total } = live.current
    return total > 0 ? widthRef.current / total : 0
  }, [])

  /** Рамка видимого куска: где она и какой ширины. */
  const layoutFrame = useCallback(() => {
    const el = frameRef.current
    const host = scroller.current
    if (!el || !host) return
    const width = widthRef.current
    // Полотно короче окна — оно растянуто на всю ширину, и видно всё сразу.
    const content = Math.max(live.current.laneWidth, host.clientWidth, 1)
    const ratio = width / content
    const w = Math.min(width, Math.max(MIN_FRAME_PX, host.clientWidth * ratio))
    const left = Math.min(width - w, Math.max(0, host.scrollLeft * ratio))
    el.style.width = `${w}px`
    el.style.transform = `translateX(${left}px)`
  }, [scroller])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    const { blocks: items, durationMs: total, peaks: data, showWave: wave } = live.current
    const width = Math.max(1, Math.round(widthRef.current))
    const dpr = window.devicePixelRatio || 1

    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${H}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, H)
    if (total <= 0) return

    // Волна во всю высоту и приглушённо: она здесь фон, по которому читается,
    // где вообще есть звук, а не предмет рассматривания.
    if (wave && data) {
      const waveTop = BLOCK_TOP + BLOCK_H + 1
      const waveH = H - waveTop - 1
      const mid = waveTop + waveH / 2
      const bars = peakBars(data, width, width / total)
      ctx.fillStyle = readToken(host, "--ws-accent", 0.34)
      for (let x = 0; x < width; x += 1) {
        const lo = bars.min[x]
        const hi = bars.max[x]
        const top = mid - (hi * waveH) / 2
        const bottom = mid - (lo * waveH) / 2
        const h = Math.max(1, bottom - top)
        ctx.fillRect(x, top, 1, h)
      }
    }

    // Блоки титров одной полосой, без разбивки по дорожкам: на двадцати восьми
    // пикселях высоты дорожки превратились бы в нечитаемые волоски, а вопрос,
    // на который отвечает карта, — «где вообще есть реплики», а не «на какой
    // они дорожке».
    const fallback = readToken(host, "--ws-accent", 0.85)
    for (const block of items) {
      const from = Math.max(0, Math.min(total, block.startMs))
      const to = Math.max(from, Math.min(total, block.endMs))
      const x = (from / total) * width
      const w = Math.max(1, ((to - from) / total) * width)
      ctx.fillStyle = block.color ?? fallback
      ctx.fillRect(x, BLOCK_TOP, w, BLOCK_H)
    }
  }, [])

  // Ширина своя и меняется от чужих причин: свернули панель дорожек, изменили
  // окно, добавили кнопку в строку. Меряем наблюдателем и перерисовываем.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const next = el.clientWidth
      if (next === widthRef.current) return
      widthRef.current = next
      draw()
      layoutFrame()
    })
    observer.observe(el)
    widthRef.current = el.clientWidth
    draw()
    layoutFrame()
    return () => observer.disconnect()
  }, [draw, layoutFrame])

  // Перерисовка на смену данных: реплики, волна, масштаб полотна.
  useEffect(() => {
    draw()
    layoutFrame()
  }, [blocks, peaks, showWave, durationMs, laneWidth, draw, layoutFrame])

  useEffect(() => viewport.subscribe(layoutFrame), [viewport, layoutFrame])

  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = headRef.current
      if (!el) return
      const scale = scaleOf()
      el.style.transform = `translateX(${ms * scale}px)`
    })
  }, [clock, scaleOf])

  /**
   * Перетаскивание.
   *
   * Взяли за рамку — она едет за курсором, сохраняя место захвата: так можно
   * подвинуть окно на чуть-чуть, не сбив его в точку под пальцем. Ткнули мимо —
   * окно прыгает серединой на это место и дальше ведётся так же. Это обычное
   * поведение миникарты, и обе половины нужны: первая для точной подводки,
   * вторая чтобы попасть в конец материала одним движением.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current
      const target = scroller.current
      if (!host || !target || event.button !== 0) return

      const rect = host.getBoundingClientRect()
      const width = widthRef.current
      const content = Math.max(live.current.laneWidth, target.clientWidth, 1)
      const ratio = width / content
      if (ratio <= 0) return

      const frameW = Math.min(width, Math.max(MIN_FRAME_PX, target.clientWidth * ratio))
      const frameLeft = Math.min(width - frameW, Math.max(0, target.scrollLeft * ratio))
      const startX = event.clientX - rect.left
      const inside = startX >= frameLeft && startX <= frameLeft + frameW
      const grab = inside ? startX - frameLeft : frameW / 2

      const pan = (clientX: number) => {
        const x = clientX - rect.left - grab
        const max = Math.max(0, content - target.clientWidth)
        target.scrollLeft = Math.min(max, Math.max(0, x / ratio))
      }
      pan(event.clientX)

      host.setPointerCapture(event.pointerId)
      const move = (e: PointerEvent) => pan(e.clientX)
      const up = () => {
        // Захват мог и не состояться (палец ушёл, элемент перерисовался):
        // отпускать незахваченный указатель — исключение.
        if (host.hasPointerCapture(event.pointerId)) {
          host.releasePointerCapture(event.pointerId)
        }
        host.removeEventListener("pointermove", move)
        host.removeEventListener("pointerup", up)
        host.removeEventListener("pointercancel", up)
      }
      host.addEventListener("pointermove", move)
      host.addEventListener("pointerup", up)
      host.addEventListener("pointercancel", up)
    },
    [scroller],
  )

  return (
    <div
      ref={hostRef}
      // Подсказкой, а не ролью: `scrollbar` требует `aria-valuenow`, которого у
      // карты нет — она показывает не одно число, а окно на материале. Зато сама
      // возможность перетащить рамку неочевидна, и о ней сказать стоит.
      title={label}
      onPointerDown={onPointerDown}
      style={{ height: H }}
      // `min-w-0` намеренно: в узком окне карта сжимается первой, а кнопки
      // инструментов и масштаб остаются целыми. Она здесь удобство, а они работа.
      className="relative min-w-0 flex-1 cursor-grab overflow-hidden rounded border border-foreground/[0.07] bg-ws-well active:cursor-grabbing"
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0" />
      <div
        ref={headRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 top-0 z-[2] w-px bg-ws-playhead will-change-transform"
      />
      {/*
        Цвета рамки — стилем со значениями токенов, а не классами `ws-accent/15`:
        токены объявлены голыми компонентами HSL, и `hsl(var(--x) / a)` даёт
        нужную прозрачность наверняка. Ошибись тут — и рамка станет сплошной
        заливкой поверх всей карты.
      */}
      <div
        ref={frameRef}
        aria-hidden
        style={{
          background: "hsl(var(--ws-accent) / 0.16)",
          borderColor: "hsl(var(--ws-accent) / 0.75)",
        }}
        className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1] rounded-[3px] border will-change-transform"
      />
    </div>
  )
}
