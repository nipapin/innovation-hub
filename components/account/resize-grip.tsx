"use client"

import { cn } from "@/lib/utils"

/**
 * Ручка изменения размера панели.
 *
 * Зона захвата шире видимой линии (11px), поэтому попасть курсором легко.
 * Постоянно видна короткая полоска-хват по центру края — это подсказка, что
 * панель тянется; при наведении и во время перетаскивания подсвечивается вся
 * линия. Клавиатурой — стрелками (Shift — крупный шаг).
 *
 * Ставится в контейнер с `position: relative`.
 */
export function ResizeGrip({
  orientation,
  side,
  label,
  dragging,
  onPointerDown,
  onKeyDown,
  className,
}: {
  orientation: "vertical" | "horizontal"
  /** На каком краю контейнера сидит ручка. */
  side: "left" | "right" | "top" | "bottom"
  label: string
  dragging: boolean
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  className?: string
}) {
  const vertical = orientation === "vertical"

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute z-20 flex items-center justify-center focus-visible:outline-none",
        vertical
          ? "bottom-0 top-0 w-[11px] cursor-col-resize"
          : "left-0 right-0 h-[11px] cursor-row-resize",
        side === "left" && "left-0",
        side === "right" && "right-0",
        side === "top" && "top-0",
        side === "bottom" && "bottom-0",
        className,
      )}
    >
      {/* линия по всему краю — проявляется при наведении */}
      <span
        aria-hidden
        className={cn(
          "absolute bg-transparent transition-colors",
          vertical
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
          "group-hover:bg-ws-select/70 group-focus-visible:bg-ws-select",
          dragging && "bg-ws-select",
        )}
      />
      {/* короткий хват по центру — виден всегда */}
      <span
        aria-hidden
        className={cn(
          "relative rounded-full bg-foreground/15 transition-colors group-hover:bg-ws-select group-focus-visible:bg-ws-select",
          vertical ? "h-9 w-[3px]" : "h-[3px] w-9",
          dragging && "bg-ws-select",
        )}
      />
    </div>
  )
}
