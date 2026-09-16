"use client"

import { Keyboard } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ExportFormat } from "@/lib/tools/dialog/export"
import type { ToolInstance } from "../tools-context"
import {
  HotkeySection,
  NativeSelect,
  ProjectRulesSection,
  SectionTitle,
  SliderRow,
  Toggle,
} from "../shared/settings-parts"
import {
  DEFAULT_KEYMAP,
  HOTKEY_ACTIONS,
  type HotkeyAction,
  type ViewPrefs,
} from "./prefs"

/**
 * Настройки инструмента.
 *
 * Здесь два разных вида настроек, и их важно не путать: вид (высота дорожек,
 * шрифт) — свойство экрана и живёт в `localStorage`, а список проектов и
 * правила чтения папки — свойство экземпляра и уходят в `user_tools.settings`,
 * чтобы работать с любой машины (§9).
 *
 * Элементы формы, строки клавиш и список проектов взяты из каркаса
 * (`shared/settings-parts.tsx`): у озвучки то же окно, отличаются только строки.
 */
export function SrtSettingsDialog({
  tool,
  open,
  onOpenChange,
  prefs,
  setPref,
  resetView,
  onOpenHelp,
}: {
  tool: ToolInstance
  open: boolean
  onOpenChange: (open: boolean) => void
  prefs: ViewPrefs
  setPref: <K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]) => void
  resetView: () => void
  onOpenHelp: () => void
}) {
  const { t } = useWorkspace()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[82vh] w-[680px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.srtSettings}</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-5 pt-4">
          <section className="flex flex-col gap-3">
            <SectionTitle>{t.srtSetInterface}</SectionTitle>
            <SliderRow
              label={t.srtSetTrackHeight}
              value={prefs.trackH}
              min={36}
              max={120}
              step={2}
              onChange={(value) => setPref("trackH", value)}
            />
            <SliderRow
              label={t.srtSetFontSize}
              value={prefs.fontSize}
              min={12}
              max={22}
              step={1}
              onChange={(value) => setPref("fontSize", value)}
            />
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>{t.srtTimeline}</SectionTitle>
            <div className="grid grid-cols-[220px_1fr] items-center gap-3">
              <span className="text-[13px] text-ws-2">{t.srtSetSnap}</span>
              <Toggle
                on={prefs.snap}
                onClick={() => setPref("snap", !prefs.snap)}
                label={t.srtSetSnap}
              />
            </div>
            <div className="grid grid-cols-[220px_1fr] items-center gap-3">
              <span className="text-[13px] text-ws-2">{t.srtSetExportFmt}</span>
              <NativeSelect
                value={prefs.exportFmt}
                onChange={(value) => setPref("exportFmt", value as ExportFormat)}
                className="w-[220px]"
                options={[
                  { value: "srt", label: t.srtFmtSrt },
                  { value: "srt-bom", label: t.srtFmtSrtBom },
                  { value: "vtt", label: t.srtFmtVtt },
                ]}
              />
            </div>
          </section>

          <HotkeySection<HotkeyAction>
            actions={HOTKEY_ACTIONS}
            labels={{
              select: t.srtHelpSelectTitle,
              create: t.srtHelpCreateTitle,
              razor: t.srtHelpRazorTitle,
              shift: t.srtHelpShiftTitle,
              merge: t.srtHelpMergeTitle,
              playPause: t.srtHelpPlayTitle,
              mainWave: t.srtHelpWaveTitle,
            }}
            keymap={prefs.keymap}
            onChange={(keymap) => setPref("keymap", keymap)}
            onReset={() => setPref("keymap", DEFAULT_KEYMAP)}
          />

          <ProjectRulesSection tool={tool} />
        </div>

        <div className="flex flex-none items-center gap-2.5 border-t border-foreground/[0.07] px-5 py-3.5">
          <button
            type="button"
            onClick={onOpenHelp}
            className="flex h-[34px] items-center gap-1.5 rounded border border-foreground/[0.07] px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
          >
            <Keyboard className="h-4 w-4" />
            {t.srtHotkeys}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={resetView}
            className="h-[34px] rounded border border-foreground/[0.07] px-3 text-[13px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            {t.srtResetLayout}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-[34px] rounded bg-ws-action px-4 text-[13px] font-semibold text-white hover:bg-ws-action-hover"
          >
            {t.srtDone}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
