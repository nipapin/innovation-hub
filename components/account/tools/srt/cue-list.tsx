"use client"

import { useEffect, useRef, useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTrack, translationOf, type Cue } from "@/lib/tools/dialog/dialog-doc"
import { formatDuration, formatTc } from "@/lib/tools/dialog/timecode"
import { cn } from "@/lib/utils"
import { useSrt } from "./srt-context"

/** Сетка строки: номер · тайминг · оригинал · перевод · дорожка. */
const GRID = "44px 168px 1fr 1fr 116px"

/**
 * Зона 3: список реплик.
 *
 * Строка — реплика: слева тайминг, дальше оригинал и перевод рядом. Правка
 * идёт прямо в строке, без модалок: на вычитке человек проходит сотни реплик
 * подряд, и каждое лишнее движение умножается на эти сотни.
 */
export function CueList() {
  const { t } = useWorkspace()
  const srt = useSrt()
  // Колонка перевода правит выбранный язык, а на вкладке «Оригинал» — первый из
  // списка: иначе на документе с одним переводом колонка выглядела бы мёртвой.
  const translationLang = srt.lang ?? srt.doc.languages.targets[0] ?? null
  const listRef = useRef<HTMLDivElement | null>(null)
  const [activeCueId, setActiveCueId] = useState<string | null>(null)

  // Текущая реплика подсвечивается на всех трёх поверхностях (§15.5). Время
  // приходит подпиской, поэтому перерисовывается только эта подсветка.
  useEffect(() => {
    return srt.clock.subscribe((ms) => {
      const hit = srt.doc.cues.find((c) => ms >= c.startMs && ms <= c.endMs)
      setActiveCueId((current) => (current === (hit?.id ?? null) ? current : hit?.id ?? null))
    })
  }, [srt.clock, srt.doc.cues])

  // Выбор с таймлинии должен быть виден в списке, иначе правка идёт вслепую.
  useEffect(() => {
    if (!srt.selectedCueId || !listRef.current) return
    const row = listRef.current.querySelector(`[data-cue="${srt.selectedCueId}"]`)
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" })
    }
  }, [srt.selectedCueId])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ws-well">
      <div className="flex h-11 flex-none items-center gap-2.5 border-b border-foreground/[0.07] px-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.4px] text-ws-accent">
          <span className="text-ws-action">—</span>
          {t.srtCues}
        </div>
        <label className="flex h-[30px] max-w-[320px] flex-1 items-center gap-2 rounded-full border border-foreground/[0.07] bg-ws-raised px-2.5">
          <Search className="h-4 w-4 shrink-0 text-ws-4" />
          <input
            value={srt.cueQuery}
            onChange={(e) => srt.setCueQuery(e.target.value)}
            placeholder={t.srtSearchCues}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ws-1 outline-none placeholder:text-ws-5"
          />
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            const trackId = srt.selectedTrackId ?? srt.doc.tracks[0]?.id
            if (!trackId) return
            const at = srt.clock.getTimeMs()
            srt.selectCue(srt.ops.addCue(trackId, at, at + 2000), { seek: false })
          }}
          className="flex h-[30px] items-center gap-1.5 rounded border border-foreground/[0.07] px-2.5 text-[12px] text-ws-2 hover:bg-ws-hover"
        >
          <Plus className="h-4 w-4" />
          {t.srtNewCue}
        </button>
      </div>

      <div
        style={{ gridTemplateColumns: GRID }}
        className="grid h-8 flex-none items-center border-b border-foreground/[0.07] bg-ws-panel px-3 text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4"
      >
        <div>{t.srtColNum}</div>
        <div>{t.srtColTiming}</div>
        <div className="pl-3">{t.srtColOriginal}</div>
        <div className="pl-3">
          {t.srtColTranslation}
          {translationLang ? (
            <span className="ml-1.5 font-mono normal-case text-ws-5">{translationLang}</span>
          ) : null}
        </div>
        <div className="pl-3">{t.srtColTrack}</div>
      </div>

      <div
        ref={listRef}
        className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto py-1"
        style={{ fontSize: srt.prefs.fontSize }}
      >
        {srt.rows.map((cue, index) => (
          <CueRow
            key={cue.id}
            cue={cue}
            number={index + 1}
            playing={cue.id === activeCueId}
            lang={translationLang}
          />
        ))}
        {srt.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ws-4">{t.srtNoCues}</p>
        ) : null}
      </div>
    </div>
  )
}

function CueRow({
  cue,
  number,
  playing,
  lang,
}: {
  cue: Cue
  number: number
  playing: boolean
  lang: string | null
}) {
  const { t } = useWorkspace()
  const srt = useSrt()
  const track = findTrack(srt.doc, cue.trackId)
  const selected = cue.id === srt.selectedCueId

  return (
    <div
      data-cue={cue.id}
      onClick={() => srt.selectCue(cue.id)}
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
        <span className="text-ws-4">
          {formatTc(cue.endMs)} · {formatDuration(cue.endMs - cue.startMs)}
        </span>
      </div>
      <div className="self-stretch px-3">
        <CueField
          value={cue.text}
          placeholder={t.srtColOriginal}
          onActivate={() => srt.selectCue(cue.id)}
          onChange={(value) => srt.ops.setText(cue.id, value)}
          className="text-ws-1"
        />
      </div>
      <div className="self-stretch px-3">
        <CueField
          value={lang ? translationOf(cue, lang) : ""}
          // Языка нет — поле объясняет, что делать, а не молчит серым.
          placeholder={lang ? t.srtColTranslation : t.srtPickLanguage}
          disabled={!lang}
          onActivate={() => srt.selectCue(cue.id)}
          onChange={(value) => lang && srt.ops.setTranslation(cue.id, lang, value)}
          className="text-ws-2"
        />
      </div>
      <div className="flex items-start gap-1.5 px-3 py-1">
        <span className="flex h-[22px] max-w-full items-center gap-1.5 overflow-hidden rounded-full bg-ws-raised px-2 text-[11px] text-ws-3">
          <span
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: track?.color ?? "#5b9be0" }}
          />
          <span className="truncate">{track?.name ?? cue.trackId}</span>
        </span>
        <button
          type="button"
          title={t.srtDeleteCue}
          onClick={(e) => {
            e.stopPropagation()
            srt.ops.removeCue(cue.id)
          }}
          className="flex h-[22px] w-6 flex-none items-center justify-center rounded border border-transparent text-ws-5 hover:border-destructive/40 hover:text-destructive"
        >
          <Trash2 className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  )
}

/**
 * Поле реплики.
 *
 * Пока человек печатает, значение живёт в поле, а в документ уходит по
 * `blur`: правка на каждый символ гнала бы через историю undo по шагу на
 * букву, и одно «отменить» откатывало бы один символ (§18.1).
 */
function CueField({
  value,
  placeholder,
  disabled,
  onActivate,
  onChange,
  className,
}: {
  value: string
  placeholder: string
  disabled?: boolean
  /** Клик в поле — это и выбор реплики: курсор уходит на её начало. */
  onActivate: () => void
  onChange: (value: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  return (
    <textarea
      value={draft}
      rows={2}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true
        onActivate()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onChange(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value)
          e.currentTarget.blur()
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
      }}
      // Событие не пускаем в строку: выбор уже сделан на `focus`, а второй
      // вызов сбросил бы каретку в начало текста.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "h-full min-h-[54px] w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-2 py-1.5 text-[1em] leading-[1.45] outline-none hover:border-foreground/[0.10] focus:border-ws-action focus:bg-ws-well disabled:opacity-50",
        className,
      )}
      style={{ fieldSizing: "content" } as React.CSSProperties}
    />
  )
}
