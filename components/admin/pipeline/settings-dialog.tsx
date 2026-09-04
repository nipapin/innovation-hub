"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useAdminI18n, type AdminDict } from "@/components/admin/admin-dict"
import { useI18n, type Lang } from "@/components/account/i18n"
import { HelpDot } from "@/components/help/help-dot"
import { SKIP_LABEL } from "./skip-labels"
import { cn } from "@/lib/utils"
import type { SkippedProject } from "@/lib/pipeline/scan"
import type { PipelineState } from "@/lib/pipeline/state"
import type { HelpTopicId } from "@/lib/help/topics"
import {
  DOMAIN_LABELS,
  SETTINGS_DOMAINS,
  type SettingsDocument,
  type SettingsDomain,
  type SettingsEntry,
} from "@/lib/settings-types"

/**
 * Общие словари: типы файлов с расширениями, цвета типов нод и типов данных,
 * пользовательские маски путей. Контракт — docs/SETTINGS_SYNC.md.
 *
 * Модальное окно рядом с очередью, а не отдельный раздел меню: словари правят по
 * ходу работы с конвейером.
 *
 * Настройки общие на всю установку, а не на проект: «video = mp4, mov» и цвет
 * ноды ffmpeg — конвенция оператора, одна на всех.
 *
 * Последняя закладка выбивается из этого ряда: страховочный обход папок IN — не
 * словарь и на десктоп не синхронизируется, он живёт в состоянии конвейера. Стоит
 * здесь потому, что это настройка того же конвейера, и искать её оператор будет
 * там же, где остальные, а не в третьем месте.
 */

/** Закладки: домены словарей плюс обход, у которого своё хранилище. */
type Tab = SettingsDomain | "sweep"

/**
 * Закладка → статья справки. Карта здесь, а не в реестре тем: она про этот
 * диалог, а реестр про справку в целом. Проверка «у темы есть якорь в коде»
 * (`npm run help:check`) видит id и отсюда — ей достаточно строки в исходнике.
 */
const HELP_BY_TAB: Record<Tab, HelpTopicId> = {
  fileType: "pipeline.settings.file-type",
  nodeType: "pipeline.settings.node-type",
  dataType: "pipeline.settings.data-type",
  pathPattern: "pipeline.settings.path-pattern",
  sweep: "pipeline.settings.sweep",
}

/**
 * `<input type="color">` понимает только `#rrggbb`, а в словаре может лежать
 * `#rrggbbaa`. Разбираем на пару, чтобы прозрачность не пропала молча при первом
 * же клике по палитре.
 */
function splitColor(color: string | null): { rgb: string; alpha: string } {
  if (!color) return { rgb: "#888888", alpha: "" }
  const value = color.trim().toLowerCase()
  return value.length === 9
    ? { rgb: value.slice(0, 7), alpha: value.slice(7) }
    : { rgb: value, alpha: "" }
}

/** Похоже ли на абсолютный путь: `/Volumes/…`, `D:\…`, `C:/…`. */
function looksAbsolute(segment: string): boolean {
  return /^([a-z]:[\\/]|[\\/])/i.test(segment.trim())
}

type DraftDomains = Record<SettingsDomain, SettingsEntry[]>

function toDraft(document: SettingsDocument): DraftDomains {
  return SETTINGS_DOMAINS.reduce((acc, domain) => {
    acc[domain] = (document.domains[domain] ?? []).map((entry) => ({
      ...entry,
      path: [...entry.path],
    }))
    return acc
  }, {} as DraftDomains)
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useAdminI18n()
  const { lang } = useI18n()
  const [revision, setRevision] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftDomains | null>(null)
  const [saved, setSaved] = useState<string>("")
  const [tab, setTab] = useState<Tab>("fileType")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/settings")
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(
          data?.message ?? tf(t.settingsUnavailable, { status: res.status }),
        )
        return
      }
      const next = toDraft(data as SettingsDocument)
      setRevision((data as SettingsDocument).revision)
      setDraft(next)
      setSaved(JSON.stringify(next))
      setError(null)
    } catch {
      setError(t.pipelineServerUnavailable)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => draft != null && JSON.stringify(draft) !== saved,
    [draft, saved],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Несохранённые правки не выбрасываем по случайному Esc.
      if (dirty && !window.confirm(t.settingsCloseConfirm)) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, dirty, t])

  const patch = (domain: SettingsDomain, next: SettingsEntry[]) =>
    setDraft((current) => (current ? { ...current, [domain]: next } : current))

  const save = async () => {
    if (!draft || revision == null) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: revision, domains: draft }),
      })
      const data = await res.json().catch(() => null)

      if (res.status === 409) {
        // Настройки успели поменять с другой стороны — из программы или из
        // соседней вкладки. Сливать в браузере нечем: базы (снимка на момент
        // последней синхронизации) у него нет, поэтому показываем серверное
        // состояние и даём переприменить правки осознанно.
        const fresh = toDraft(data as SettingsDocument)
        setRevision((data as SettingsDocument).revision)
        setDraft(fresh)
        setSaved(JSON.stringify(fresh))
        toast.error(t.settingsConflict)
        return
      }

      if (!res.ok) {
        toast.error(data?.message ?? t.settingsSaveError)
        return
      }

      const next = toDraft(data as SettingsDocument)
      setRevision((data as SettingsDocument).revision)
      setDraft(next)
      setSaved(JSON.stringify(next))
      toast.success(t.settingsSaved)
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setSaving(false)
    }
  }

  const sweepTab = tab === "sweep"
  const entries = sweepTab ? [] : (draft?.[tab] ?? [])
  const hintKey = sweepTab
    ? "settingsDomainSweepHint"
    : DOMAIN_LABELS[tab].hint
  const labels = sweepTab ? null : DOMAIN_LABELS[tab]

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (dirty && !window.confirm(t.settingsCloseConfirm)) return
        onClose()
      }}
    >
      <div
        role="dialog"
        aria-label={t.settingsTitle}
        className="flex max-h-[85vh] w-full max-w-[840px] flex-col overflow-hidden rounded-xl border border-white/10 bg-ws-panel shadow-ws-menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <h2 className="text-[16px] font-semibold text-ws-1">{t.settingsTitle}</h2>
          <HelpDot id="pipeline.settings" />
          {revision != null ? (
            <span className="text-[12.5px] text-ws-4">
              {tf(t.settingsRevision, { revision })}
            </span>
          ) : null}
          {dirty ? (
            <span className="text-[12.5px] text-ws-out">{t.settingsUnsaved}</span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm(t.settingsCloseConfirm)) return
              onClose()
            }}
            aria-label={t.close}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-[9px] text-ws-3 hover:bg-white/5 hover:text-ws-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-white/[0.07] px-4 pt-3">
          {SETTINGS_DOMAINS.map((domain) => (
            <button
              key={domain}
              type="button"
              onClick={() => setTab(domain)}
              className={cn(
                "rounded-t-[9px] px-3.5 py-2 text-[13px]",
                domain === tab
                  ? "bg-white/[0.06] text-ws-1"
                  : "text-ws-4 hover:text-ws-2",
              )}
            >
              {t[DOMAIN_LABELS[domain].title as keyof AdminDict]}
            </button>
          ))}
          {/* Отбита слева: это не словарь, а настройка самого конвейера. */}
          <button
            type="button"
            onClick={() => setTab("sweep")}
            className={cn(
              "ml-2 rounded-t-[9px] px-3.5 py-2 text-[13px]",
              sweepTab
                ? "bg-white/[0.06] text-ws-1"
                : "text-ws-4 hover:text-ws-2",
            )}
          >
            {t.settingsDomainSweep}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* Подсказка отвечает «что это», якорь рядом — «почему так»: в две
              строки второе не влезает, а без него настройку правят наугад. */}
          <p className="mb-3.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-ws-4">
            <span>{t[hintKey as keyof AdminDict]}</span>
            <HelpDot id={HELP_BY_TAB[tab]} className="mt-0.5" align="end" />
          </p>

          {sweepTab ? (
            <SweepPanel t={t} lang={lang} />
          ) : loading ? (
            <div className="flex justify-center py-12 text-ws-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="flex items-center justify-center gap-2 py-12 text-[13.5px] text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry, index) => (
                <EntryRow
                  key={`${tab}-${entry.name}-${index}`}
                  entry={entry}
                  index={index}
                  total={entries.length}
                  t={t}
                  pathLabel={
                    labels?.pathLabel
                      ? t[labels.pathLabel as keyof AdminDict]
                      : null
                  }
                  onChange={(next) =>
                    patch(
                      tab,
                      entries.map((e, i) => (i === index ? next : e)),
                    )
                  }
                  onMove={(delta) => {
                    const target = index + delta
                    if (target < 0 || target >= entries.length) return
                    const next = [...entries]
                    const [moved] = next.splice(index, 1)
                    next.splice(target, 0, moved)
                    patch(tab, next)
                  }}
                  onRemove={() =>
                    patch(
                      tab,
                      entries.filter((_, i) => i !== index),
                    )
                  }
                />
              ))}

              <button
                type="button"
                onClick={() =>
                  patch(tab, [
                    ...entries,
                    { name: "", path: [], color: "#888888", isDefault: false },
                  ])
                }
                className="flex items-center justify-center gap-2 rounded-[10px] border border-dashed border-white/[0.14] py-2.5 text-[13px] text-ws-4 hover:border-white/25 hover:text-ws-2"
              >
                <Plus className="h-4 w-4" />
                {t.settingsAdd}
              </button>
            </div>
          )}
        </div>

        {/* На закладке обхода футера нет: там своё хранилище и своя кнопка
            сохранения, а примечание про локальные пути к словарям не относится. */}
        {sweepTab ? null : (
          <div className="flex shrink-0 items-center gap-3 border-t border-white/[0.07] px-5 py-3">
            {/* Не синхронизируемое лучше назвать здесь: иначе непонятно, почему
                одни настройки едут на сервер, а пути к ffmpeg — нет. */}
            <p className="text-[11.5px] leading-relaxed text-ws-5">
              {t.settingsLocalNote}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty || loading}
              className="ml-auto flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-ws-action px-4 text-[13.5px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t.saveChanges}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Закладка «Обход IN»: тумблер, интервал, итог прошлого обхода и кнопка разового
 * прогона.
 *
 * Состояние своё, а не поднятое в диалог: обход лежит в automation_scan_state, у
 * него нет ни ревизии, ни оптимистической блокировки словарей, и мешать эти два
 * механизма в одном черновике — заводить путаницу, чей именно «есть
 * несохранённое» горит в заголовке.
 */
function SweepPanel({ t, lang }: { t: AdminDict; lang: Lang }) {
  const [state, setState] = useState<PipelineState | null>(null)
  const [intervalDraft, setIntervalDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  /** Почему обход не завёл задачу. Живёт до следующего прогона: сервер причины
   *  не хранит, и после перезагрузки страницы их взять уже неоткуда. */
  const [skipped, setSkipped] = useState<SkippedProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/pipeline/state")
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(
          data?.message ??
            tf(t.settingsSweepStateUnavailable, { status: res.status }),
        )
        return
      }
      setState(data.state as PipelineState)
      setIntervalDraft(String((data.state as PipelineState).sweepIntervalMin))
      setError(null)
    } catch {
      setError(t.pipelineServerUnavailable)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  /** Отправляет частичное изменение: тумблер — сразу, интервал — по кнопке. */
  const patch = async (body: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/pipeline/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? t.settingsSweepSaveError)
        return
      }
      const next = data.state as PipelineState
      setState(next)
      setIntervalDraft(String(next.sweepIntervalMin))
      toast.success(t.settingsSweepSaved)
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setSaving(false)
    }
  }

  const runNow = async () => {
    setSweeping(true)
    setSkipped(null)
    try {
      const res = await fetch("/api/admin/pipeline/sweep", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (res.status === 409) {
        toast.error(t.settingsSweepStopped)
        return
      }
      if (!res.ok) {
        toast.error(data?.message ?? t.settingsSweepError)
        return
      }
      toast.success(
        tf(t.settingsSweepDone, {
          created: data.created,
          scanned: data.scanned,
          known: data.known,
        }) + (data.truncated ? t.settingsSweepTruncated : ""),
      )
      // Причины пропуска приезжают в ответе и до сих пор выбрасывались. Из-за
      // этого «файл лежит, а задачи нет» диагностировалось только запросом к
      // базе: обход говорил «добрано 0» и молчал о том, почему.
      setSkipped(Array.isArray(data.skipped) ? data.skipped : [])
      await load()
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setSweeping(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-ws-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (error || !state) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-[13.5px] text-destructive">
        <AlertTriangle className="h-4 w-4" />
        {error ?? t.pipelineServerUnavailable}
      </p>
    )
  }

  // Пустое поле — это не ноль: пока человек стёр значение и не набрал новое,
  // сохранять нечего, иначе одно нажатие Backspace тихо снимало бы расписание.
  const parsed = intervalDraft === "" ? Number.NaN : Number(intervalDraft)
  const intervalValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 1440
  const intervalDirty = intervalValid && parsed !== state.sweepIntervalMin
  const scheduleOff = state.sweepIntervalMin === 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-3 py-3">
        <span className="text-[13.5px] text-ws-1">
          {t.settingsSweepInterval}
        </span>
        <input
          value={intervalDraft}
          onChange={(e) => setIntervalDraft(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && intervalDirty) {
              e.preventDefault()
              void patch({ sweepIntervalMin: parsed })
            }
          }}
          inputMode="numeric"
          aria-label={t.settingsSweepInterval}
          className={cn(
            "h-8 w-[70px] rounded-[8px] border bg-black/20 px-2.5 text-right text-[13px] text-ws-1",
            "focus:outline-none",
            intervalValid
              ? "border-white/[0.1] focus:border-white/25"
              : "border-destructive/60",
          )}
        />
        <span className="text-[13px] text-ws-4">
          {t.settingsSweepIntervalUnit}
        </span>

        {/* Состояние расписания читается из самого числа, отдельной подписи-статуса
            для него не нужно — нужна только подсказка, что ноль это «не ходить». */}
        <span
          className={cn(
            "text-[12.5px]",
            scheduleOff ? "text-ws-out" : "text-ws-5",
          )}
        >
          {scheduleOff ? t.settingsSweepOff : t.settingsSweepOn}
        </span>

        <button
          type="button"
          onClick={() => void patch({ sweepIntervalMin: parsed })}
          disabled={saving || !intervalDirty}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-[8px] bg-ws-action px-3 text-[13px] font-medium text-white hover:bg-ws-action-hover disabled:opacity-40"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t.saveChanges}
        </button>
      </div>

      <p className="px-1 text-[11.5px] text-ws-5">
        {t.settingsSweepIntervalHint}
      </p>

      <div className="mt-1 flex items-center gap-3 rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-3 py-3">
        <span className="text-[12.5px] text-ws-4">
          {state.sweptAt
            ? tf(t.settingsSweepLast, {
                time: new Date(state.sweptAt).toLocaleString(
                  lang === "ru" ? "ru-RU" : "en-GB",
                  { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" },
                ),
                created: state.lastSwept,
              })
            : t.settingsSweepNever}
        </span>
        {state.lastSweepError ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {state.lastSweepError}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={sweeping}
          className="ml-auto flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-white/[0.14] px-3 text-[13px] text-ws-2 hover:bg-white/5 disabled:opacity-50"
        >
          {sweeping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t.settingsSweepRunNow}
        </button>
      </div>

      {skipped && skipped.length > 0 ? (
        <div className="mt-1 rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[12.5px] text-ws-3">{t.settingsSweepSkipped}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {skipped.map((item) => (
              <li
                key={`${item.projectId}:${item.reason}`}
                className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]"
              >
                <span className="text-ws-2">{item.projectName}</span>
                <span className="text-ws-out">{t[SKIP_LABEL[item.reason]]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-ws-5">
            {t.settingsSweepSkipHint}
          </p>
        </div>
      ) : null}

      <p className="mt-1 px-1 text-[11.5px] leading-relaxed text-ws-5">
        {t.settingsSweepOnce}
      </p>
    </div>
  )
}

function EntryRow({
  entry,
  index,
  total,
  pathLabel,
  t,
  onChange,
  onMove,
  onRemove,
}: {
  entry: SettingsEntry
  index: number
  total: number
  pathLabel: string | null
  t: AdminDict
  onChange: (next: SettingsEntry) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const [pathInput, setPathInput] = useState("")
  const { rgb, alpha } = splitColor(entry.color)

  const addPathItem = () => {
    const value = pathInput.trim()
    if (!value) return
    if (entry.path.includes(value)) {
      setPathInput("")
      return
    }
    onChange({ ...entry, path: [...entry.path, value] })
    setPathInput("")
  }

  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <input
          type="color"
          value={rgb}
          onChange={(e) => onChange({ ...entry, color: `${e.target.value}${alpha}` })}
          title={t.settingsColor}
          className="h-7 w-7 shrink-0 cursor-pointer rounded-[7px] border border-white/10 bg-transparent p-0"
        />

        <input
          value={entry.name}
          onChange={(e) => onChange({ ...entry, name: e.target.value })}
          // Дефолтные типы переименовывать нельзя: графы ссылаются на тип по
          // имени (searchType: "video"), переименование их сломает.
          disabled={entry.isDefault}
          placeholder={t.settingsNamePlaceholder}
          className={cn(
            "h-8 w-[180px] shrink-0 rounded-[8px] border border-white/[0.1] bg-black/20 px-2.5 text-[13px] text-ws-1",
            "placeholder:text-ws-5 focus:border-white/25 focus:outline-none",
            entry.isDefault && "cursor-not-allowed opacity-70",
          )}
        />

        {entry.isDefault ? (
          <span className="shrink-0 rounded-full border border-white/[0.12] px-2 py-[2px] text-[11px] text-ws-5">
            {t.settingsDefaultBadge}
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title={t.moveUp}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-white/5 hover:text-ws-1 disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title={t.moveDown}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-white/5 hover:text-ws-1 disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={entry.isDefault}
            title={entry.isDefault ? t.settingsRemoveDefault : t.delete}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ws-4 hover:bg-destructive/15 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ws-4"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {pathLabel ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[38px]">
          {entry.path.map((item) => (
            <span
              key={item}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-[2px] text-[12px]",
                looksAbsolute(item)
                  ? "border-ws-out/40 bg-ws-out/10 text-ws-out"
                  : "border-white/[0.12] text-ws-2",
              )}
              // Абсолютный путь синхронизируется как есть, но на другой машине
              // его может не существовать — помечаем, а не запрещаем.
              title={
                looksAbsolute(item)
                  ? t.settingsAbsoluteHint
                  : undefined
              }
            >
              {item}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...entry,
                    path: entry.path.filter((p) => p !== item),
                  })
                }
                aria-label={tf(t.settingsRemoveItem, { item })}
                className="text-ws-5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addPathItem()
              }
            }}
            onBlur={addPathItem}
            placeholder={`+ ${pathLabel.toLowerCase()}`}
            className="h-6 w-[130px] rounded-full border border-dashed border-white/[0.14] bg-transparent px-2.5 text-[12px] text-ws-1 placeholder:text-ws-5 focus:border-white/25 focus:outline-none"
          />
        </div>
      ) : null}
    </div>
  )
}
