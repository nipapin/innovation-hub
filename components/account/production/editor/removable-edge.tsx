"use client"

import { useState } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { useEditor } from "./editor-context"

/**
 * Связь с крестиком посередине: виден при наведении и у выделенной связи.
 * Удаление идёт тем же путём, что Delete/Backspace, — через `deleteElements`,
 * чтобы редактор получил обычное изменение и сохранил граф.
 */
export function RemovableEdge(props: EdgeProps) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const { deleteElements } = useReactFlow()
  const [hover, setHover] = useState(false)
  const [path, labelX, labelY] = getBezierPath(props)
  const visible = !readOnly && (hover || props.selected)

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        interactionWidth={24}
        className={cn(props.selected && "!stroke-ws-accent")}
      />
      {/* Широкая невидимая дорожка — чтобы наведение ловилось не только на тонкой линии. */}
      <path
        d={path}
        fill="none"
        strokeWidth={24}
        className="stroke-transparent"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label={t.productionEdRemoveEdge}
          title={t.productionEdRemoveEdge}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => void deleteElements({ edges: [{ id: props.id }] })}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className={cn(
            "nodrag nopan pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 bg-ws-panel text-ws-3 shadow-ws-panel transition-opacity hover:text-destructive",
            visible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
