"use client"

import { useMemo, useState } from "react"
import { Hammer, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  buildDocFromFolder,
  trackDirs,
  type BuildNote,
  type TaskEntry,
} from "@/lib/tools/dialog/build-doc"
import type { DialogDoc } from "@/lib/tools/dialog/dialog-doc"
import { pickVideoName } from "@/lib/tools/dialog/media-files"
import { languageName } from "./language-picker"
import { signGet, type FolderEntry } from "./use-task-folder"
import type { ToolInstance } from "../tools-context"

/** Языки, которые предлагаем как язык оригинала; остальное — кодом руками. */
const COMMON = ["en", "ru", "es", "fr", "de", "pt", "it", "pl", "tr", "zh", "ja", "ko"]

const AUDIO_EXTENSION = /\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i

/** Путь записи относительно папки задачи: `OUT/Задача/01` → `01`. */
function relativeDir(folderPath: string, entry: FolderEntry): string {
  if (entry.folderPath === folderPath) return ""
  return entry.folderPath.startsWith(`${folderPath}/`)
    ? entry.folderPath.slice(folderPath.length + 1)
    : entry.folderPath
}

function toTaskEntries(folderPath: string, entries: FolderEntry[]): TaskEntry[] {
  return entries.map((entry) => ({
    dir: relativeDir(folderPath, entry),
    name: entry.name,
    isFolder: entry.isFolder,
    contentType: entry.contentType,
  }))
}

/**
 * Длительность материала — из самого файла, а не из титров.
 *
 * Браузер читает только заголовок (`preload: metadata`), поэтому качать файл
 * целиком ради одного числа не приходится. Не получилось — не беда: сборка
 * возьмёт конец последней реплики, и таймлиния всё равно будет верной по
 * содержанию, просто закончится вместе с речью.
 */
function mediaDurationMs(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind)
    el.preload = "metadata"
    const finish = (ms: number) => {
      el.removeAttribute("src")
      resolve(ms)
    }
    el.onloadedmetadata = () =>
      finish(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0)
    el.onerror = () => finish(0)
    el.src = url
  })
}

export type BuildProgress = { done: number; total: number; step: string }

/**
 * Собрать папку задачи в документ и записать его.
 *
 * Порядок: титры → длительность медиа → сборка → запись. Тяжёлого здесь нет —
 * `.srt` мелкие, а от медиа читается только заголовок, поэтому сборка занимает
 * секунды и не требует ни ffmpeg, ни ноды в графе.
 *
 * Пики не считаются: они дорисуются в фоне, когда задача уже открыта. Ждать
 * волну, чтобы показать титры, значило бы держать человека перед пустым экраном
 * ради того, что нужно позже.
 */
export async function collectTaskDoc(input: {
  projectId: string
  folderPath: string
  entries: FolderEntry[]
  originalLang: string
  onProgress: (progress: BuildProgress) => void
  steps: { srt: string; media: string; write: string }
}): Promise<{ doc: DialogDoc; notes: BuildNote[] }> {
  const { entries, folderPath, projectId } = input
  const srtEntries = entries.filter(
    (entry) => !entry.isFolder && entry.s3Key && /\.srt$/i.test(entry.name),
  )
  const total = srtEntries.length + 2
  let done = 0

  const srt = new Map<string, string>()
  for (const entry of srtEntries) {
    input.onProgress({ done, total, step: tf(input.steps.srt, { file: entry.name }) })
    const url = await signGet(projectId, entry.s3Key!)
    if (url) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const dir = relativeDir(folderPath, entry)
          srt.set(dir ? `${dir}/${entry.name}` : entry.name, await res.text())
        }
      } catch {
        // Недочитанный файл — это дорожка без реплик, а не провал сборки.
      }
    }
    done += 1
  }

  input.onProgress({ done, total, step: input.steps.media })
  const root = entries.filter((e) => !e.isFolder && e.s3Key && e.folderPath === folderPath)
  const videoName = pickVideoName(root)
  const mediaEntry = videoName
    ? root.find((e) => e.name === videoName)
    : root.find((e) => AUDIO_EXTENSION.test(e.name))
  let durationMs = 0
  if (mediaEntry?.s3Key) {
    const url = await signGet(projectId, mediaEntry.s3Key)
    if (url) durationMs = await mediaDurationMs(url, videoName ? "video" : "audio")
  }
  done += 1

  input.onProgress({ done, total, step: input.steps.write })
  const { doc, notes } = buildDocFromFolder({
    entries: toTaskEntries(folderPath, entries),
    srt,
    durationMs,
    originalLang: input.originalLang,
    docId: `dd_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    now: new Date().toISOString(),
  })

  return { doc, notes }
}

/**
 * Собрать папку и записать документ первый раз.
 *
 * Отдельно от `collectTaskDoc`, потому что сборка нужна и там, где документ уже
 * есть: новая версия собирает ту же папку, но пишет её другим путём (§версии).
 */
export async function buildTaskFolder(
  input: Parameters<typeof collectTaskDoc>[0] & { toolId: string },
): Promise<{ ok: true; notes: BuildNote[] } | { ok: false; reason: "exists" | "failed" }> {
  const { doc, notes } = await collectTaskDoc(input)
  const res = await fetch(`/api/account/tools/${encodeURIComponent(input.toolId)}/document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  })
  if (!res.ok) return { ok: false, reason: res.status === 409 ? "exists" : "failed" }
  return { ok: true, notes }
}

/** Замечание сборки словами. */
export function buildNoteText(
  t: {
    srtBuildNoteNoOriginal: string
    srtBuildNoteUnknownLang: string
    srtBuildNoteShort: string
    srtBuildNoteEmpty: string
  },
  note: BuildNote,
): string {
  switch (note.kind) {
    case "noOriginal":
      return tf(t.srtBuildNoteNoOriginal, { dir: note.dir })
    case "unknownLang":
      return tf(t.srtBuildNoteUnknownLang, { file: note.file })
    case "shortTranslation":
      return tf(t.srtBuildNoteShort, { file: note.file, count: note.missing })
    default:
      return t.srtBuildNoteEmpty
  }
}

/**
 * Экран сборки: что нашли в папке и кнопка «собрать».
 *
 * Сборка не запускается сама. Она пишет файл в чужую папку, и человек должен
 * видеть, что именно из неё получится, — особенно язык оригинала: из имён
 * файлов его не узнать, а поменять потом дороже, чем выбрать сейчас.
 */
export function BuildTaskScreen({
  tool,
  entries,
  onDone,
}: {
  tool: ToolInstance
  entries: FolderEntry[]
  onDone: () => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const [originalLang, setOriginalLang] = useState("en")
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null

  const dirs = useMemo(
    () => (folderPath ? trackDirs(toTaskEntries(folderPath, entries)) : []),
    [entries, folderPath],
  )

  const start = async () => {
    if (!projectId || !folderPath) return
    setError(null)
    setProgress({ done: 0, total: 1, step: "" })
    const result = await buildTaskFolder({
      toolId: tool.id,
      projectId,
      folderPath,
      entries,
      originalLang,
      onProgress: setProgress,
      steps: { srt: t.srtBuildReading, media: t.srtBuildMedia, write: t.srtBuildWriting },
    })
    setProgress(null)
    // Собрал кто-то другой, пока мы читали папку: это не ошибка, документ уже
    // есть — просто открываем задачу.
    if (result.ok || result.reason === "exists") {
      // Замечания — не отказ: документ собран, но человек должен знать, что в
      // папке не сошлось, иначе он будет искать пропавшую дорожку сам.
      if (result.ok) for (const note of result.notes) toast.warning(buildNoteText(t, note))
      onDone()
      return
    }
    setError(t.srtBuildFailed)
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-[440px] flex-col gap-4 rounded-[6px] border border-foreground/[0.07] bg-ws-raised p-5">
        <div className="flex items-start gap-2.5">
          <Hammer className="mt-[2px] h-[18px] w-[18px] shrink-0 text-ws-accent" />
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold text-ws-1">{t.srtBuildTitle}</span>
            <span className="text-[13px] leading-relaxed text-ws-4">
              {dirs.length > 0
                ? tf(t.srtBuildFound, { count: dirs.length })
                : t.srtBuildNothing}
            </span>
          </div>
        </div>

        {dirs.length > 0 ? (
          <>
            <label className="flex items-center justify-between gap-3 text-[13px] text-ws-3">
              {t.srtBuildLang}
              <select
                value={originalLang}
                disabled={Boolean(progress)}
                onChange={(e) => setOriginalLang(e.target.value)}
                className="h-[30px] min-w-[160px] rounded border border-foreground/[0.09] bg-ws-well px-2 text-[13px] text-ws-1"
              >
                {COMMON.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, uiLang)}
                  </option>
                ))}
              </select>
            </label>

            {progress ? (
              <div className="flex flex-col gap-2">
                <div className="h-[3px] overflow-hidden rounded bg-foreground/[0.08]">
                  <div
                    className="h-full bg-ws-accent transition-[width]"
                    style={{
                      width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="flex items-center gap-2 text-[12px] text-ws-4">
                  <Loader2 className="h-[13px] w-[13px] animate-spin" />
                  {progress.step}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                className="h-[32px] rounded bg-ws-action px-3 text-[13px] font-semibold text-white hover:bg-ws-action-hover"
              >
                {t.srtBuildStart}
              </button>
            )}
          </>
        ) : null}

        {error ? <span className="text-[12.5px] text-ws-playhead">{error}</span> : null}
      </div>
    </div>
  )
}

/** Ответ роута версий: что отложили и встало ли что-то на место активного. */
export type VersionResult =
  | { ok: true; archived: string; activated: boolean }
  | { ok: false; message: string }

/**
 * Действие над версиями документа.
 *
 * Один вход на все три случая (отложить, заменить, вернуть), потому что и
 * меню, и окно восстановления зовут одно и то же — а сообщение об отказе должно
 * доходить до человека дословно: «не получилось» ничего не чинит.
 */
export async function postVersion(
  toolId: string,
  body:
    | { action: "snapshot" }
    | { action: "replace"; doc: DialogDoc }
    | { action: "activate"; file: string },
): Promise<VersionResult> {
  try {
    const res = await fetch(`/api/account/tools/${encodeURIComponent(toolId)}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => null)) as {
      archived?: string
      activated?: boolean
      message?: string
    } | null
    if (!res.ok) return { ok: false, message: data?.message ?? `HTTP ${res.status}` }
    return { ok: true, archived: data?.archived ?? "", activated: Boolean(data?.activated) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "network" }
  }
}

/** Удалить отложенную версию. Активный документ этим не трогается. */
export async function deleteVersion(toolId: string, file: string): Promise<VersionResult> {
  try {
    const res = await fetch(`/api/account/tools/${encodeURIComponent(toolId)}/versions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    })
    const data = (await res.json().catch(() => null)) as { message?: string } | null
    if (!res.ok) return { ok: false, message: data?.message ?? `HTTP ${res.status}` }
    return { ok: true, archived: file, activated: false }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "network" }
  }
}

/** Отложенная версия документа: файл и его номер. */
export type TaskVersion = { entry: FolderEntry; no: number }

/**
 * Версии задачи и номер той, в которой работают прямо сейчас.
 *
 * Активный документ номера не носит — он всегда `dialog.json`. Но человеку
 * нужно видеть, где он находится, поэтому номер выводится из цепочки: две
 * отложенные версии рядом значат, что рабочая — третья. Отложится она под этим
 * же номером, так что подпись не соврёт и после нажатия.
 */
export function taskVersions(
  entries: FolderEntry[],
  folderPath: string | null,
): { list: TaskVersion[]; currentNo: number } {
  const list = entries
    .filter((entry) => !entry.isFolder && entry.folderPath === folderPath)
    .map((entry) => {
      const match = /^dialog\.v(\d+)\.json$/.exec(entry.name)
      return match ? { entry, no: Number(match[1]) } : null
    })
    .filter((item): item is TaskVersion => item != null)
    .sort((a, b) => b.no - a.no)
  return { list, currentNo: (list[0]?.no ?? 0) + 1 }
}
