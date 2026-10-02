"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

/**
 * JSON деревом: объекты и массивы сворачиваются.
 *
 * Своё, без библиотек (план §2): нужен только показ разобранного значения.
 * Сначала раскрыты два уровня — дальше файл обычно уже читается по сводке
 * «{…} 12 эл.», а длинный конфиг целиком в глаза не бросается.
 */

const OPEN_DEPTH = 2

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-ws-5">null</span>
  if (typeof value === "string") {
    return <span className="break-all text-chart-2">{JSON.stringify(value)}</span>
  }
  return <span className="text-chart-3">{String(value)}</span>
}

function Node({
  name,
  value,
  depth,
}: {
  name: string | null
  value: unknown
  depth: number
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(depth < OPEN_DEPTH)
  const label =
    name === null ? null : <span className="text-ws-2">{name}: </span>

  if (value === null || typeof value !== "object") {
    return (
      <div className="pl-[18px]">
        {label}
        <Scalar value={value} />
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, i) => [String(i), item])
    : Object.entries(value as Record<string, unknown>)
  const [openBr, closeBr] = isArray ? ["[", "]"] : ["{", "}"]

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? t.textJsonCollapse : t.textJsonExpand}
        className="flex items-center text-left hover:text-ws-1"
      >
        <ChevronRight
          className={cn(
            "mr-0.5 h-3.5 w-3.5 shrink-0 text-ws-4 transition-transform",
            open && "rotate-90",
          )}
        />
        {label}
        <span className="text-ws-4">
          {open ? openBr : `${openBr}…${closeBr}`}
        </span>
        {open ? null : (
          <span className="ml-1.5 text-ws-5">
            {tf(t.textJsonItems, { count: entries.length })}
          </span>
        )}
      </button>
      {open ? (
        <>
          <div className="ml-[7px] border-l border-foreground/[0.07] pl-2">
            {entries.map(([key, item]) => (
              <Node
                key={key}
                name={isArray ? key : JSON.stringify(key)}
                value={item}
                depth={depth + 1}
              />
            ))}
          </div>
          <div className="pl-[18px] text-ws-4">{closeBr}</div>
        </>
      ) : null}
    </div>
  )
}

export function JsonTree({
  value,
  className,
}: {
  value: unknown
  className?: string
}) {
  return (
    <div className={cn("font-mono text-[12px] leading-[1.6] text-ws-2", className)}>
      <Node name={null} value={value} depth={0} />
    </div>
  )
}
