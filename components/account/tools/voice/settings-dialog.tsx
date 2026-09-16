"use client"

import { Keyboard } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ToolInstance } from "../tools-context"
import {
  HotkeySection,
  ProjectRulesSection,
  SectionTitle,
  SliderRow,
  Toggle,
} from "../shared/settings-parts"
import {
  DEFAULT_VOICE_KEYMAP,
  VOICE_HOTKEY_ACTIONS,
  type VoiceHotkeyAction,
  type VoicePrefs,
} from "./prefs"

/**
 * Настройки инструмента озвучки.
 *
 * То же окно, что у редактора титров, и по той же причине разделения: вид живёт
 * в `localStorage`, список проектов — в `user_tools.settings` экземпляра.
 * Своего здесь два раздела — генерация и формат выгрузки; остальное взято из
 * каркаса без изменений.
 */
export function VoiceSettingsDialog({
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
  prefs: VoicePrefs
  setPref: <K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]) => void
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
              min={44}
              max={140}
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
              <span className="text-[13px] text-ws-2">{t.voiceSetSnap}</span>
              <Toggle
                on={prefs.snap}
                onClick={() => setPref("snap", !prefs.snap)}
                label={t.voiceSetSnap}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>{t.voiceSetGeneration}</SectionTitle>
            {/*
              Одновременных генераций — не «чем больше, тем лучше»: провайдер
              внешний и с ограничением по частоте, а на отказ уходит попытка.
            */}
            <SliderRow
              label={t.voiceSetConcurrency}
              value={prefs.concurrency}
              min={1}
              max={6}
              step={1}
              unit=""
              onChange={(value) => setPref("concurrency", value)}
            />
            <p className="text-pretty text-[12px] leading-relaxed text-ws-3">
              {t.voiceSetConcurrencyHint}
            </p>
            {/*
              Две половины одной работы, и они нужны по отдельности: ужать
              вылезшую за реплику озвучку надо почти всегда, а растягивать
              короткую — вопрос материала.
            */}
            <div className="grid grid-cols-[220px_1fr] items-center gap-3">
              <span className="text-[13px] text-ws-2">{t.voiceSetAutoFit}</span>
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Toggle
                    on={prefs.autoFitShrink}
                    onClick={() => setPref("autoFitShrink", !prefs.autoFitShrink)}
                    label={t.voiceSetAutoFitShrink}
                  />
                  <span className="text-[13px] text-ws-2">{t.voiceSetAutoFitShrink}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Toggle
                    on={prefs.autoFitStretch}
                    onClick={() => setPref("autoFitStretch", !prefs.autoFitStretch)}
                    label={t.voiceSetAutoFitStretch}
                  />
                  <span className="text-[13px] text-ws-2">{t.voiceSetAutoFitStretch}</span>
                </label>
              </div>
            </div>
            <p className="text-pretty text-[12px] leading-relaxed text-ws-3">
              {t.voiceSetAutoFitHint}
            </p>
            {/*
              Провайдера в настройках нет, потому что выбирать не из чего: синтез
              идёт на заглушке. Сказать это прямо лучше, чем оставить человека
              искать настройку, которой не существует.
            */}
            <div className="grid grid-cols-[220px_1fr] items-baseline gap-3">
              <span className="text-[13px] text-ws-2">{t.voiceSetProvider}</span>
              <span className="text-[13px] text-ws-4">{t.voiceSetProviderStub}</span>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>{t.srtSetExportFmt}</SectionTitle>
            <div className="grid grid-cols-[220px_1fr] items-baseline gap-3">
              <span className="text-[13px] text-ws-2">{t.voiceFmtWav}</span>
              <span className="text-pretty text-[12px] leading-relaxed text-ws-3">
                {t.voiceExportWavOnly}
              </span>
            </div>
          </section>

          <HotkeySection<VoiceHotkeyAction>
            actions={VOICE_HOTKEY_ACTIONS}
            labels={{
              generate: t.voiceHelpGenerateTitle,
              fit: t.voiceHelpFitTitle,
              // Подпись говорит и про `Shift`: иначе про вторую половину действия
              // узнать негде, кроме справки.
              removeTake: t.voiceSetRemoveTakeKey,
              playPause: t.srtHelpPlayTitle,
              original: t.voiceHelpListenTitle,
              mainWave: t.srtHelpWaveTitle,
            }}
            keymap={prefs.keymap}
            onChange={(keymap) => setPref("keymap", keymap)}
            onReset={() => setPref("keymap", DEFAULT_VOICE_KEYMAP)}
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
