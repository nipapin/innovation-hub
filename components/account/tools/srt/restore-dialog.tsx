"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, RotateCcw, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { mergeRebuild } from "@/lib/tools/dialog/build-doc"
import {
  fullRestoreScope,
  restoreFromSrt,
  sourcePathsFor,
  type RestoreScope,
} from "@/lib/tools/dialog/restore"
import type { SrtCue } from "@/lib/tools/dialog/srt-parse"
import { cn } from "@/lib/utils"
import {
  collectTaskDoc,
  deleteVersion,
  postVersion,
  taskVersions,
  type VersionResult,
} from "../shared/build-task"
import { languageName } from "../shared/language-picker"
import type { FolderEntry } from "../shared/use-task-folder"
import type { ToolInstance } from "../tools-context"
import { useSrt } from "./srt-context"

type Lang = string | null

/**
 * Восстановление из сырья папки.
 *
 * Устроено как расширенный экспорт, только наоборот: там человек выбирает, что
 * выгрузить, здесь — что сбросить. Пределы те же (дорожки и языки) плюс «что
 * именно»: текст, тайминги, дорожку, удалённые реплики.
 *
 * Сырьё читается при открытии окна, чтобы счётчик внизу показывал настоящее
 * число реплик, которые изменятся, а не обещание. Файла в папке нет — так и
 * скажем: восстанавливать было не из чего.
 */
export function SrtRestoreDialog({
  open,
  onOpenChange,
  tool,
  entries,
  onReloaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tool: ToolInstance
  entries: FolderEntry[]
  onReloaded: () => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const srt = useSrt()

  const [tracks, setTracks] = useState<string[]>(() => srt.doc.tracks.map((x) => x.id))
  const [langs, setLangs] = useState<Lang[]>([null])
  const [text, setText] = useState(true)
  const [timing, setTiming] = useState(true)
  const [track, setTrack] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [names, setNames] = useState(false)
  const [sources, setSources] = useState<Map<string, SrtCue[]> | null>(null)

  const available: Lang[] = useMemo(
    () => [null, ...srt.doc.languages.targets],
    [srt.doc.languages.targets],
  )

  useEffect(() => {
    if (!open) return
    setTracks(srt.doc.tracks.map((item) => item.id))
    setLangs([null])
    setText(true)
    setTiming(true)
    setTrack(false)
    setDeleted(false)
    setNames(false)
    setSources(null)
    let cancelled = false
    void (async () => {
      // Читаем сразу всё сырьё задачи: файлы маленькие, а пределы человек ещё
      // будет менять — второй заход к хранилищу на каждый чекбокс не нужен.
      const loaded = await srt.loadSources(sourcePathsFor(srt.doc, fullRestoreScope(srt.doc)))
      if (!cancelled) setSources(loaded)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const scope: RestoreScope = { trackIds: tracks, langs, text, timing, track, deleted, names }
  const preview = useMemo(
    () => (sources ? restoreFromSrt(srt.doc, sources, scope) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, srt.doc, tracks, langs, text, timing, track, deleted, names],
  )

  /**
   * Сколько изменится по каждому пункту отдельно.
   *
   * Без этих чисел окно непонятно: галочки стоят, а кнопка серая — и неясно,
   * то ли она сломана, то ли восстанавливать правда нечего. Ноль рядом с пунктом
   * отвечает на это сразу, ещё до нажатия.
   */
  const counts = useMemo(() => {
    if (!sources) return null
    const base: RestoreScope = {
      trackIds: tracks,
      langs,
      text: false,
      timing: false,
      track: false,
      deleted: false,
      names: false,
    }
    const one = (key: keyof RestoreScope, pick: (r: ReturnType<typeof restoreFromSrt>) => number) =>
      pick(restoreFromSrt(srt.doc, sources, { ...base, [key]: true }))
    return {
      text: one("text", (r) => r.changed),
      timing: one("timing", (r) => r.changed),
      names: one("names", (r) => r.renamed),
      track: one("track", (r) => r.changed),
      deleted: one("deleted", (r) => r.restored),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, srt.doc, tracks, langs])

  const nothingToDo =
    !preview || (preview.changed === 0 && preview.restored === 0 && preview.renamed === 0)

  const toggleLang = (lang: Lang) => {
    setLangs((current) =>
      current.includes(lang)
        ? current.filter((item) => item !== lang)
        : available.filter((item) => item === lang || current.includes(item)),
    )
  }

  const run = () => {
    if (!preview || nothingToDo) return
    srt.ops.replaceDoc(preview.doc)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-none border-b border-foreground/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.srtRestoreTitle}</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-elegant flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-4">
          <p className="text-pretty text-[12px] leading-relaxed text-ws-3">
            {t.srtRestoreHint}
          </p>

          <VersionsSection
            tool={tool}
            entries={entries}
            onChanged={() => {
              onOpenChange(false)
              onReloaded()
            }}
          />

          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
              {t.srtRestoreWhat}
            </h3>
            <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
              <Check
                on={text}
                label={t.srtRestoreText}
                note={t.srtRestoreTextNote}
                count={counts?.text}
                onChange={setText}
              />
              <Check
                on={timing}
                label={t.srtRestoreTiming}
                note={t.srtRestoreTimingNote}
                count={counts?.timing}
                onChange={setTiming}
              />
              <Check
                on={names}
                label={t.srtRestoreNames}
                note={t.srtRestoreNamesNote}
                count={counts?.names}
                onChange={setNames}
              />
              <Check
                on={track}
                label={t.srtRestoreTrack}
                note={t.srtRestoreTrackNote}
                count={counts?.track}
                onChange={setTrack}
              />
              <Check
                on={deleted}
                label={t.srtRestoreDeleted}
                note={t.srtRestoreDeletedNote}
                count={counts?.deleted}
                onChange={setDeleted}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
                {t.srtExportLanguages}
              </h3>
              <span className="text-[12px] text-ws-5">{t.srtRestoreLangsHint}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {available.map((lang) => {
                const on = langs.includes(lang)
                return (
                  <button
                    key={lang ?? "orig"}
                    type="button"
                    aria-pressed={on}
                    disabled={!text}
                    onClick={() => toggleLang(lang)}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded border px-3 text-[13px] disabled:opacity-40",
                      on
                        ? "border-ws-action bg-ws-action/[0.18] text-ws-1"
                        : "border-foreground/[0.10] text-ws-4 hover:border-foreground/25 hover:text-ws-2",
                    )}
                  >
                    {lang ? languageName(lang, uiLang) : t.srtColOriginal}
                    <span
                      className={cn("font-mono text-[11px]", on ? "text-ws-accent" : "text-ws-5")}
                    >
                      {lang ?? srt.doc.languages.original}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
                {t.srtExportTracks}
              </h3>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTracks(srt.doc.tracks.map((item) => item.id))}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline"
              >
                {t.srtExportSelectAll}
              </button>
              <button
                type="button"
                onClick={() => setTracks([])}
                className="text-[12px] text-ws-3 underline-offset-4 hover:text-ws-1 hover:underline"
              >
                {t.srtExportSelectNone}
              </button>
            </div>
            <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
              {srt.doc.tracks.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-foreground/[0.06] px-3 py-2 last:border-b-0 hover:bg-foreground/[0.03]"
                >
                  <input
                    type="checkbox"
                    checked={tracks.includes(item.id)}
                    onChange={() =>
                      setTracks((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : current.concat([item.id]),
                      )
                    }
                    className="h-4 w-4 flex-none accent-ws-action"
                  />
                  <span
                    className="h-3.5 w-[3px] flex-none rounded-sm"
                    style={{ background: item.color }}
                  />
                  <span className="w-7 flex-none font-mono text-[12px] tabular-nums text-ws-4">
                    {String(item.no).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ws-1">
                    {item.name}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-none items-center gap-3 border-t border-foreground/[0.07] px-5 py-3.5">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ws-3">
            {!sources ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t.srtRestoreReading}
              </span>
            ) : nothingToDo ? (
              t.srtRestoreNothing
            ) : (
              <>
                {tf(t.srtRestoreSummary, {
                  changed: preview.changed,
                  restored: preview.restored,
                  renamed: preview.renamed,
                })}
                {preview.unmatched > 0
                  ? ` · ${tf(t.srtRestoreUnmatched, { count: preview.unmatched })}`
                  : ""}
                {preview.manual > 0
                  ? ` · ${tf(t.srtRestoreManual, { count: preview.manual })}`
                  : ""}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={nothingToDo}
            className="flex h-[34px] flex-none items-center gap-2 rounded bg-ws-action px-4 text-[13px] font-semibold text-white hover:bg-ws-action-hover disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            {t.srtRestoreRun}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Пункт восстановления: что это, что именно вернётся и сколько записей изменится.
 *
 * Число справа — не украшение: оно и объясняет, почему при поставленных галочках
 * кнопка может быть серой.
 */
function Check({
  on,
  label,
  note,
  count,
  onChange,
}: {
  on: boolean
  label: string
  note: string
  count?: number
  onChange: (value: boolean) => void
}) {
  const empty = count === 0
  return (
    <label className="flex cursor-pointer items-start gap-2.5 border-b border-foreground/[0.06] px-3 py-2 last:border-b-0 hover:bg-foreground/[0.03]">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-4 w-4 flex-none accent-ws-action"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-[13px]", empty ? "text-ws-4" : "text-ws-1")}>{label}</span>
        <span className="text-pretty text-[12px] leading-snug text-ws-4">{note}</span>
      </span>
      <span
        className={cn(
          "mt-[2px] shrink-0 rounded-full border px-2 text-[11px] tabular-nums",
          count == null
            ? "border-foreground/[0.08] text-ws-5"
            : empty
              ? "border-foreground/[0.08] text-ws-5"
              : "border-ws-action/40 bg-ws-action/[0.14] text-ws-1",
        )}
      >
        {count ?? "—"}
      </span>
    </label>
  )
}

/**
 * Версии документа — здесь же, в окне восстановления.
 *
 * Место не случайное: и то и другое отвечает на один вопрос — «вернуть как
 * было». Ниже по окну возвращают текст из сырья по выбранным пределам, здесь —
 * документ целиком. Разница в том, что версия помнит и ручные правки, а сырьё
 * знает только машинный результат.
 *
 * Пересборка предлагается с сохранением правок по умолчанию: обычный повод её
 * запустить — «в папку докинули перевод», и терять из-за нового языка всю
 * вычитку не должен никто.
 */
function VersionsSection({
  tool,
  entries,
  onChanged,
}: {
  tool: ToolInstance
  entries: FolderEntry[]
  onChanged: () => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const srt = useSrt()
  const [busy, setBusy] = useState<string | null>(null)
  const [step, setStep] = useState("")
  const [error, setError] = useState<string | null>(null)

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null

  const { list: versions, currentNo } = useMemo(
    () => taskVersions(entries, folderPath),
    [entries, folderPath],
  )

  /**
   * Новая версия. `keepEdits` разделяет два разных повода её создать: начать с
   * машинного результата или всего лишь забрать из папки новое, не потеряв
   * вычитку. Текущий документ в обоих случаях откладывается сервером.
   */
  const rebuild = async (keepEdits: boolean) => {
    if (!projectId || !folderPath) return
    setError(null)
    setBusy(keepEdits ? "pull" : "new")
    try {
      const { doc } = await collectTaskDoc({
        projectId,
        folderPath,
        entries,
        // Язык оригинала уже назван в документе: спрашивать его второй раз
        // незачем, а менять его пересборка не должна.
        originalLang: srt.doc.languages.original,
        onProgress: (progress) => setStep(progress.step),
        steps: { srt: t.srtBuildReading, media: t.srtBuildMedia, write: t.srtBuildWriting },
      })
      const result = await postVersion(tool.id, {
        action: "replace",
        doc: keepEdits ? mergeRebuild(srt.doc, doc) : doc,
      })
      if (result.ok) onChanged()
      else setError(result.message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.srtVersionFailed)
    } finally {
      setBusy(null)
      setStep("")
    }
  }

  const act = async (key: string, run: () => Promise<VersionResult>) => {
    setError(null)
    setBusy(key)
    const result = await run()
    setBusy(null)
    if (result.ok) onChanged()
    else setError(result.message)
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.32px] text-ws-4">
        {t.srtVersionsTitle}
      </h3>
      <p className="text-pretty text-[12px] leading-relaxed text-ws-4">{t.srtVersionsHint}</p>

      <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
        <Action
          label={t.srtVersionNew}
          note={t.srtVersionNewNote}
          busy={busy === "new"}
          disabled={Boolean(busy)}
          onClick={() => void rebuild(false)}
        />
        <Action
          label={t.srtVersionPull}
          note={t.srtVersionPullNote}
          busy={busy === "pull"}
          disabled={Boolean(busy)}
          onClick={() => void rebuild(true)}
        />
        {step ? <p className="px-3 pb-2 text-[11.5px] text-ws-4">{step}</p> : null}
      </div>

      <div className="overflow-hidden rounded-[6px] border border-foreground/[0.07]">
        {/*
          Первой строкой — та, в которой работают сейчас. Без неё список читается
          как «вот версии», и непонятно, где в нём человек находится.
        */}
        <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.06] bg-foreground/[0.03] px-3 py-2 last:border-b-0">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-[12.5px] text-ws-1">dialog.json</span>
            <span className="text-[11.5px] text-ws-4">
              {tf(t.srtVersionCurrent, { no: currentNo })}
            </span>
          </span>
        </div>
        {versions.length === 0 ? (
          <p className="px-3 py-2.5 text-[12.5px] text-ws-5">{t.srtVersionsEmpty}</p>
        ) : (
          versions.map(({ entry }) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 border-b border-foreground/[0.06] px-3 py-2 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[12.5px] text-ws-2">{entry.name}</span>
                {entry.updatedAt ? (
                  <span className="text-[11.5px] text-ws-5">
                    {new Date(entry.updatedAt).toLocaleString(uiLang)}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(entry.name, () =>
                      postVersion(tool.id, { action: "activate", file: entry.name }),
                    )
                  }
                  className="flex h-[26px] items-center gap-2 rounded border border-foreground/[0.09] px-2.5 text-[12px] text-ws-2 hover:bg-ws-hover disabled:opacity-60"
                >
                  {busy === entry.name ? (
                    <Loader2 className="h-[13px] w-[13px] animate-spin" />
                  ) : (
                    <RotateCcw className="h-[13px] w-[13px]" />
                  )}
                  {t.srtVersionActivate}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  title={t.srtVersionDelete}
                  onClick={() =>
                    void act(`del:${entry.name}`, () => deleteVersion(tool.id, entry.name))
                  }
                  className="flex h-[26px] w-[26px] items-center justify-center rounded border border-foreground/[0.09] text-ws-4 hover:bg-ws-hover hover:text-ws-playhead disabled:opacity-60"
                >
                  {busy === `del:${entry.name}` ? (
                    <Loader2 className="h-[13px] w-[13px] animate-spin" />
                  ) : (
                    <Trash2 className="h-[13px] w-[13px]" />
                  )}
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {error ? <span className="text-[12px] text-ws-playhead">{error}</span> : null}
    </section>
  )
}

/** Строка-действие в рамке: название, пояснение и своя занятость. */
function Action({
  label,
  note,
  busy,
  disabled,
  onClick,
}: {
  label: string
  note: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-foreground/[0.06] px-3 py-2.5 text-left last:border-b-0 hover:bg-ws-hover disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin text-ws-accent" />
      ) : (
        <RotateCcw className="h-[15px] w-[15px] shrink-0 text-ws-4" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] text-ws-1">{label}</span>
        <span className="text-[11.5px] text-ws-5">{note}</span>
      </span>
    </button>
  )
}
