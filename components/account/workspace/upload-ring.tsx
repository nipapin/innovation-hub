"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/**
 * Сколько крестик ждёт нажатия после первого клика.
 *
 * Отмена в один клик по кольцу была бы опасной: кольцо стоит посреди списка
 * файлов, мимо него промахиваются, а отменённый гигабайт заново едет столько
 * же. Поэтому первый клик только показывает крестик, а второй отменяет. Не
 * нажали — значит промахнулись, и через три секунды всё как было.
 */
const ARM_MS = 3000

/** Геометрия: roomy — полный режим, snug — панели IN / OUT и мобильный. */
const GEO = {
  roomy: {
    box: 136,
    stroke: 9,
    digits: "text-[32px]",
    sign: "text-[15px]",
    cross: "h-12 w-12",
  },
  snug: {
    box: 112,
    stroke: 8,
    digits: "text-[26px]",
    sign: "text-[13px]",
    cross: "h-10 w-10",
  },
} as const

/**
 * Кольцо заливки — в той папке, куда льют.
 *
 * Показывает себя само: рисуется всегда, а видно его, только пока есть
 * `uploadProgress`. Где именно рисовать, решает область файлов — она сверяет
 * свой логический путь с путём заливки (см. file-browser.tsx).
 */
export function UploadRing({ size = "roomy" }: { size?: "roomy" | "snug" }) {
  const { t, uploadProgress, cancelUpload } = useWorkspace()
  const [armed, setArmed] = useState(false)
  const active = !!uploadProgress

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  // Пачка кончилась — следующая начинается с невзведённого крестика.
  useEffect(() => {
    if (!active) setArmed(false)
  }, [active])

  if (!uploadProgress) return null

  const geo = GEO[size]
  const percent = Math.max(0, Math.min(100, Math.round(uploadProgress.percent)))
  const center = geo.box / 2
  const radius = (geo.box - geo.stroke) / 2
  const length = 2 * Math.PI * radius
  const label = tf(t.uploadPercentLabel, { percent })

  return (
    // Ловит указатель только сам значок: пока файл едет, список папки остаётся
    // рабочим — по нему можно листать и открывать соседние файлы.
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="flex w-full max-w-[260px] flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={() => (armed ? cancelUpload() : setArmed(true))}
          aria-label={armed ? t.uploadCancel : label}
          title={armed ? t.uploadCancel : label}
          style={{ width: geo.box, height: geo.box }}
          className="pointer-events-auto relative shrink-0 rounded-full bg-ws-panel/95 shadow-ws-menu"
        >
          <svg
            width={geo.box}
            height={geo.box}
            viewBox={`0 0 ${geo.box} ${geo.box}`}
            className="-rotate-90"
            aria-hidden
          >
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={geo.stroke}
              className="stroke-white/[0.09]"
            />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={geo.stroke}
              strokeLinecap="round"
              strokeDasharray={length}
              strokeDashoffset={length * (1 - percent / 100)}
              className={cn(
                "transition-[stroke-dashoffset] duration-200 ease-out",
                armed ? "stroke-destructive" : "stroke-ws-accent",
              )}
            />
          </svg>

          <span className="absolute inset-0 flex items-center justify-center">
            {armed ? (
              <X
                className={cn("text-destructive", geo.cross)}
                strokeWidth={2.5}
                aria-hidden
              />
            ) : (
              <span className="flex items-baseline text-ws-1">
                <span className={cn("font-semibold tabular-nums", geo.digits)}>
                  {percent}
                </span>
                <span className={cn("font-medium text-ws-3", geo.sign)}>%</span>
              </span>
            )}
          </span>
        </button>

        <span className="w-full truncate text-center text-[12.5px] text-ws-2">
          {uploadProgress.name}
        </span>
        {uploadProgress.total > 1 ? (
          <span className="-mt-1.5 text-[11.5px] text-ws-4">
            {tf(t.uploadOfTotal, {
              index: uploadProgress.index,
              total: uploadProgress.total,
            })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
