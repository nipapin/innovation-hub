"use client"

import { useEffect, useRef } from "react"

import { peakBars, type Peaks } from "@/lib/tools/dialog/peaks"
import { buildTicks } from "@/lib/tools/dialog/timeline"
import { formatTcShort } from "@/lib/tools/dialog/timecode"
import { readTimelinePalette } from "./tokens"
import type { ViewportSource } from "./viewport"

const RULER_H = 40
const WAVE_H = 20

/**
 * Линейка времени: подписи, засечки и — по желанию — общая волна.
 *
 * Всё одним canvas: на длинном полотне засечки отдельными элементами дают
 * тысячи узлов, из которых видно двадцать. Рисуем только видимый кусок и
 * перерисовываем на скролле (§17.1).
 */
export function TimelineRuler({
  durationMs,
  pps,
  peaks,
  showWave,
  viewport,
  onScrub,
}: {
  durationMs: number
  pps: number
  peaks: Peaks | null
  showWave: boolean
  viewport: ViewportSource
  onScrub: (event: React.PointerEvent<HTMLDivElement>) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const props = useRef({ durationMs, pps, peaks, showWave })
  props.current = { durationMs, pps, peaks, showWave }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const palette = readTimelinePalette(hostRef.current)

    const draw = (view: { left: number; width: number }) => {
      const { durationMs: total, pps: scale, peaks: data, showWave: wave } = props.current
      const width = Math.max(0, Math.ceil(view.width))
      const dpr = window.devicePixelRatio || 1
      canvas.style.left = `${view.left}px`
      canvas.style.width = `${width}px`
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.round(RULER_H * dpr)

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, RULER_H)

      ctx.font =
        '10px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
      ctx.textBaseline = "top"
      for (const tick of buildTicks(total, scale)) {
        const x = Math.round(tick.x - view.left)
        if (x < -80 || x > width + 80) continue
        ctx.fillStyle = palette.tick
        ctx.fillRect(x, 0, 1, RULER_H)
        ctx.fillStyle = palette.tickLabel
        ctx.fillText(formatTcShort(tick.ms), x + 5, 4)
      }

      if (!wave || !data) return
      // Так же как на дорожках: размахом вверх от нижнего края, чтобы шкала и
      // полотно читались одинаково.
      const bars = peakBars(data, width, scale / 1000, view.left)
      const base = RULER_H - 1
      ctx.globalAlpha = 0.5
      ctx.fillStyle = palette.wave
      for (let x = 0; x < width; x += 1) {
        const amplitude = Math.max(Math.abs(bars.min[x]), Math.abs(bars.max[x]))
        const barHeight = Math.max(1, amplitude * WAVE_H)
        ctx.fillRect(x, base - barHeight, 1, barHeight)
      }
      ctx.globalAlpha = 1
    }

    return viewport.subscribe(draw)
  }, [viewport, durationMs, pps, peaks, showWave])

  return (
    <div
      ref={hostRef}
      onPointerDown={onScrub}
      className="sticky top-0 z-[3] h-10 cursor-ew-resize border-b border-foreground/[0.07] bg-ws-panel"
    >
      <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", top: 0, height: RULER_H }} />
    </div>
  )
}
