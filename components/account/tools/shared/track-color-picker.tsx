"use client"

import { useState } from "react"
import { Check } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TRACK_PALETTE } from "@/lib/tools/dialog/dialog-doc"

/**
 * Цвет дорожки.
 *
 * Полоска слева от имени — она же и кнопка: цвет здесь не украшение, а метка
 * персонажа, и менять её логично там, где она видна. Выбор из готовых оттенков,
 * а не пипеткой: на тёмном фоне свободный выбор легко даёт цвет, которого не
 * видно ни на волне, ни на клипе.
 */
export function TrackColorPicker({
  color,
  onPick,
}: {
  color: string
  onPick: (color: string) => void
}) {
  const { t } = useWorkspace()
  // Оттенки — обычные кнопки, а не пункты меню (сетка из квадратов), поэтому
  // закрытие после выбора за нами: цвет выбран, держать меню открытым нечего.
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t.srtTrackColor}
          aria-label={t.srtTrackColor}
          onClick={(e) => e.stopPropagation()}
          className="h-7 w-[6px] flex-none rounded-sm transition-transform hover:scale-x-150"
          style={{ background: color }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[184px]">
        <DropdownMenuLabel className="text-[11.5px] uppercase tracking-[1.4px] text-ws-5">
          {t.srtTrackColor}
        </DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1.5 p-1.5">
          {TRACK_PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              onClick={() => {
                onPick(swatch)
                setOpen(false)
              }}
              className="flex h-8 items-center justify-center rounded border border-foreground/10 hover:border-foreground/40"
              style={{ background: swatch }}
            >
              {swatch.toLowerCase() === color.toLowerCase() ? (
                <Check className="h-4 w-4 text-black/70" />
              ) : null}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
