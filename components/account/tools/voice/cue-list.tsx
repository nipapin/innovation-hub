"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Mic, RotateCcw, Scaling, TriangleAlert } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTrack, type Cue } from "@/lib/tools/dialog/dialog-doc"
import { formatTc } from "@/lib/tools/dialog/timecode"
import {
  cueVoice,
  isTakeStale,
  selectedTake,
  synthText,
  takeEndMs,
  takesFor,
} from "@/lib/tools/dialog/voice"
import { cn } from "@/lib/utils"
import { useVoice } from "./voice-context"

/** Сетка строки: номер · тайминг · титр · текст для синтеза · тейк. */
const GRID = "44px 150px 1fr 1fr 168px"

/**
 * Зона 3 инструмента озвучки: реплики и то, чем их озвучивают.
 *
 * Две колонки вместо «оригинал ↔ перевод». Первая — титр, только чтение: он
 * правится в своём инструменте, и вторая точка правды на один текст была бы
 * источником расхождений. Вторая — то, что уходит в синтез: начинается копией
 * титра и правится целиком, вместе с тегами эмоций.
 */
export function CueList() {
  const { t } = useWorkspace()
  const voice = useVoice()
  const listRef = useRef<HTMLDivElement | null>(null)
  const [activeCueId, setActiveCueId] = useState<string | null>(null)

  useEffect(() => {
    return voice.clock.subscribe((ms) => {
      const hit = voice.doc.cues.find((c) => ms >= c.startMs && ms <= c.endMs)
      setActiveCueId((current) => (current === (hit?.id ?? null) ? current : hit?.id ?? null))
    })
  }, [voice.clock, voice.doc.cues])

  useEffect(() => {
    if (!voice.selectedCueId || !listRef.current) return
    const row = listRef.current.querySelector(`[data-cue="${voice.selectedCueId}"]`)
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" })
  }, [voice.selectedCueId])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ws-well">
      <div className="flex h-11 flex-none items-center gap-2.5 border-b border-foreground/[0.07] px-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.4px] text-ws-accent">
          <span className="text-ws-action">—</span>
          {t.voiceZoneList}
        </div>
        <label className="flex h-[30px] max-w-[320px] flex-1 items-center gap-2 rounded-full border border-foreground/[0.07] bg-ws-raised px-2.5">
          <input
            value={voice.cueQuery}
            onChange={(e) => voice.setCueQuery(e.target.value)}
            placeholder={t.srtSearchCues}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ws-1 outline-none placeholder:text-ws-5"
          />
        </label>
      </div>

      <div
        style={{ gridTemplateColumns: GRID }}
        className="grid h-8 flex-none items-center border-b border-foreground/[0.07] bg-ws-panel px-3 text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4"
      >
        <div>{t.srtColNum}</div>
        <div>{t.srtColTiming}</div>
        <div className="pl-3">{t.voiceColCue}</div>
        <div className="pl-3">
          {t.voiceColMarkup}
          <span className="ml-1.5 font-mono normal-case text-ws-5">{voice.lang}</span>
        </div>
        <div className="pl-3">{t.voiceColTake}</div>
      </div>

      <div
        ref={listRef}
        className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto py-1"
        style={{ fontSize: voice.prefs.fontSize }}
      >
        {voice.rows.map((cue, index) => (
          <CueRow key={cue.id} cue={cue} number={index + 1} playing={cue.id === activeCueId} />
        ))}
        {voice.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ws-4">{t.srtNoCues}</p>
        ) : null}
      </div>
    </div>
  )
}

function CueRow({ cue, number, playing }: { cue: Cue; number: number; playing: boolean }) {
  const { t } = useWorkspace()
  const voice = useVoice()
  const track = findTrack(voice.doc, cue.trackId)
  const selected = cue.id === voice.selectedCueId
  const markup = cueVoice(cue).markup[voice.lang] ?? ""
  const spoken = synthText(voice.doc, cue, voice.lang)
  const cueText = voice.lang === voice.doc.languages.original
    ? cue.text
    : cue.tr[voice.lang]?.text ?? ""

  return (
    <div
      data-cue={cue.id}
      onClick={() => voice.selectCue(cue.id)}
      style={{ gridTemplateColumns: GRID }}
      className={cn(
        "mx-2 mb-1.5 grid cursor-pointer items-stretch rounded-[5px] border-b border-foreground/[0.05] border-l-[3px] px-3 py-3.5",
        selected ? "border-l-ws-action bg-ws-select/[0.10]" : "border-l-transparent",
        !selected && playing && "bg-foreground/[0.03]",
        !selected && "hover:bg-foreground/[0.03]",
      )}
    >
      <div className="pt-1.5 font-mono text-[0.88em] tabular-nums text-ws-4">
        {String(number).padStart(3, "0")}
      </div>
      <div className="flex flex-col gap-0.5 pt-1 font-mono text-[0.88em] tabular-nums">
        <span className="text-ws-2">{formatTc(cue.startMs)}</span>
        <span className="text-ws-4">{formatTc(cue.endMs)}</span>
        <span className="flex items-center gap-1 text-[0.9em] text-ws-5">
          <span
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: track?.color ?? "#5b9be0" }}
          />
          <span className="truncate">{track?.name ?? cue.trackId}</span>
        </span>
      </div>

      {/* Титр: только чтение. Правится в редакторе титров. */}
      <div className="self-stretch px-3">
        <p className="whitespace-pre-wrap text-[1em] leading-[1.45] text-ws-3">
          {cueText || <span className="text-ws-5">{t.voiceNoText}</span>}
        </p>
      </div>

      <MarkupField cue={cue} value={markup} fallback={cueText} />

      <TakeCell cue={cue} spoken={spoken} />
    </div>
  )
}

/** Пока правят, документ не дёргаем на каждую букву — но и до blur не тянем. */
const COMMIT_DELAY_MS = 400

/**
 * Текст для синтеза.
 *
 * В поле лежит **текст, а не подсказка**: пока своей разметки нет, там копия
 * титра — её и правят. Подсказка не годилась: поставить курсор в середину неё
 * некуда, а от первой же буквы она пропадала, унося с собой оригинал, — тогда как
 * править надо именно оригинал, вписывая в него теги.
 *
 * В документе при этом по-прежнему пусто, пока текст совпадает с титром: пустая
 * разметка означает «синтезируй титр как есть», и связь с титром лучше сохранить —
 * иначе правка титра в своём инструменте перестала бы доходить до озвучки. Копия
 * заводится с первым отличием, кнопка возвращает связь.
 */
function MarkupField({
  cue,
  value,
  fallback,
}: {
  cue: Cue
  value: string
  fallback: string
}) {
  const { t } = useWorkspace()
  const voice = useVoice()
  /** Что должно быть в поле: своя разметка, а если её нет — копия титра. */
  const shown = value || fallback
  const [draft, setDraft] = useState(shown)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(shown)
  }, [shown])

  /**
   * Правка в документ. Возвращает то, что теперь показывать в поле.
   *
   * Текст, совпавший с титром, разметкой не считается — иначе одно случайное
   * нажатие в поле отцепляло бы реплику от титра навсегда.
   */
  const commit = useCallback(
    (text: string): string => {
      const trimmed = text.trim()
      if (!trimmed || trimmed === fallback.trim()) {
        if (value) voice.ops.clearMarkup(cue.id)
        return fallback
      }
      if (text !== value) voice.ops.setMarkup(cue.id, text, `markup:${cue.id}`)
      return text
    },
    [cue.id, fallback, value, voice.ops],
  )

  // Дописываем не только на blur: кнопка «Озвучить» в Safari фокус не забирает,
  // и синтез уехал бы с текстом до правки.
  useEffect(() => {
    if (!focused.current || draft === shown) return
    const timer = setTimeout(() => commit(draft), COMMIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [commit, draft, shown])

  return (
    <div className="relative self-stretch px-3">
      <textarea
        value={draft}
        rows={2}
        placeholder={t.voiceMarkupPlaceholder}
        onFocus={() => {
          focused.current = true
          voice.selectCue(cue.id)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false
          setDraft(commit(draft))
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(shown)
            e.currentTarget.blur()
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
        }}
        // Событие не пускаем в строку: выбор уже сделан на `focus`, а второй
        // вызов сбросил бы каретку в начало текста.
        onClick={(e) => e.stopPropagation()}
        className="h-full min-h-[54px] w-full resize-none overflow-hidden rounded border border-transparent bg-transparent py-1.5 pl-2 pr-7 text-[1em] leading-[1.45] text-ws-1 outline-none hover:border-foreground/[0.10] focus:border-ws-action focus:bg-ws-well"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
      {/*
        Кнопка — она же и признак того, что у реплики своя разметка: поле теперь
        всегда выглядит заполненным, и отличить копию от связи с титром иначе не
        по чему.
      */}
      {value ? (
        <button
          type="button"
          title={t.voiceRestoreCue}
          onClick={(e) => {
            e.stopPropagation()
            voice.ops.clearMarkup(cue.id)
            setDraft(fallback)
          }}
          className="absolute right-3 top-0 flex h-6 w-6 items-center justify-center rounded bg-ws-well/80 text-[#e0a33a] hover:bg-ws-hover hover:text-ws-1"
        >
          <RotateCcw className="h-[14px] w-[14px]" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * Состояние озвучки реплики.
 *
 * Кнопка синтеза, длительность результата и расхождение с титром. Расхождение
 * показывается, но ничего не запрещает: попадать в длительность инструмент не
 * обязан, важно только начало. Ужать до титра — по кнопке, а не само.
 */
function TakeCell({ cue, spoken }: { cue: Cue; spoken: string }) {
  const { t } = useWorkspace()
  const voice = useVoice()
  const state = voice.genState(cue.id)
  const take = selectedTake(cue, voice.lang)
  const versions = takesFor(cue, voice.lang).length
  const stale = take ? isTakeStale(voice.doc, cue, take) : false
  const overMs = take ? takeEndMs(cue, take) - cue.endMs : 0
  const nothingToSay = spoken.trim().length === 0

  const seconds = (ms: number) => tf(t.voiceSeconds, { value: (ms / 1000).toFixed(1) })
  const signed = (ms: number) =>
    tf(t.voiceSeconds, { value: `${ms > 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(1)}` })

  return (
    <div className="flex flex-col gap-1 px-3 pt-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        {state.kind === "running" ? (
          <span className="flex h-7 items-center gap-1.5 rounded border border-foreground/[0.07] px-2 text-[11px] text-ws-3">
            <Loader2 className="h-[14px] w-[14px] animate-spin" />
            {t.voiceRunning}
          </span>
        ) : state.kind === "queued" ? (
          <span className="flex h-7 items-center rounded border border-foreground/[0.07] px-2 text-[11px] text-ws-4">
            {t.voiceQueued}
          </span>
        ) : (
          <button
            type="button"
            disabled={nothingToSay}
            title={nothingToSay ? t.voiceNoText : take ? t.voiceRegenerate : t.voiceGenerate}
            onClick={() => voice.generate(cue.id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-semibold",
              nothingToSay
                ? "cursor-default border border-foreground/[0.07] text-ws-5"
                : take
                  ? "border border-foreground/[0.07] text-ws-2 hover:bg-ws-hover"
                  : "bg-ws-action text-white hover:bg-ws-action-hover",
            )}
          >
            <Mic className="h-[14px] w-[14px]" />
            {take ? t.voiceAgain : t.voiceDo}
          </button>
        )}

        {/*
          Кнопка есть при любом тейке, а не только у вылезшего за титр: ужать
          можно и наоборот — растянуть короткий, — и прятать действие до тех пор,
          пока оно «понадобится», значит его не найдут. Горит она только когда
          тейк действительно вылез.
        */}
        {take ? (
          <button
            type="button"
            title={t.voiceFit}
            onClick={() => voice.ops.fitTake(cue.id, take.id)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded border",
              overMs > 0
                ? "border-[#e0a33a]/40 text-[#e0a33a] hover:bg-ws-hover"
                : "border-foreground/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1",
            )}
          >
            <Scaling className="h-[14px] w-[14px]" />
          </button>
        ) : null}

        {stale ? (
          <span title={t.voiceStale} className="text-[#e0a33a]">
            <TriangleAlert className="h-[15px] w-[15px]" />
          </span>
        ) : null}
      </div>

      {state.kind === "failed" ? (
        <button
          type="button"
          onClick={() => voice.generate(cue.id)}
          title={state.message}
          className="self-start text-left text-[11px] text-ws-playhead underline-offset-4 hover:underline"
        >
          {t.voiceFailed}
        </button>
      ) : take ? (
        <span className="font-mono text-[11px] tabular-nums text-ws-4">
          {seconds(Math.round(take.durationMs / take.rate))}
          <span className={cn("ml-1.5", overMs > 0 ? "text-[#e0a33a]" : "text-ws-5")}>
            {signed(overMs)}
          </span>
        </span>
      ) : null}

      {versions > 1 ? (
        <span className="text-[11px] text-ws-5">{tf(t.voiceTakeCount, { count: versions })}</span>
      ) : null}
    </div>
  )
}
