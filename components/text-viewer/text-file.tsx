"use client"

import { useEffect, useState } from "react"

import { tf, useI18n } from "@/components/account/i18n"
import { fmtSize } from "@/components/account/workspace/format"
import { TEXT_PREVIEW_LIMIT } from "@/components/account/workspace/preview-kind"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { textKind, type TextKind } from "@/lib/text-formats/kind"
import { parseSrt, type SrtCue } from "@/lib/tools/dialog/srt-parse"
import { formatSrtTc } from "@/lib/tools/dialog/timecode"
import { cn } from "@/lib/utils"
import { JsonTree } from "./json-tree"
import { MarkupView } from "./markup-view"
import { MarkupFileEditor, PlainEditor } from "./plain-editor"
import { TableFileEditor, TableView } from "./table-view"

/**
 * Текстовый файл — один вход для проектов, производства и чата
 * (docs/TEXT_FORMATS_PLAN.md §3): загрузить по адресу, показать по виду и,
 * если дали `onSave`, править.
 *
 * Адрес обязан отдавать ТЕЛО файла с того же источника, а не редирект на
 * хранилище: чужой источник CORS не дал бы прочитать. В проектах это роут файла
 * без `inline=1`, в производстве и чате — `/api/media/…?raw=1`.
 *
 * Тело качается целиком, без Range, поэтому есть предел размера: за ним файл не
 * читается вовсе — предлагаем скачать.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "tooBig"; size: number | null }
  | { kind: "failed" }
  | { kind: "ready"; text: string }

function useFileText(
  url: string,
  sizeBytes: number | null | undefined,
  enabled: boolean,
): Loaded {
  const [state, setState] = useState<Loaded>({ kind: "loading" })

  useEffect(() => {
    if (!enabled) return
    if (sizeBytes != null && sizeBytes > TEXT_PREVIEW_LIMIT) {
      setState({ kind: "tooBig", size: sizeBytes })
      return
    }

    // Файл переключают стрелками быстрее, чем приходит ответ: без отмены
    // содержимое предыдущего легло бы поверх текущего.
    const abort = new AbortController()
    setState({ kind: "loading" })

    void (async () => {
      try {
        // no-store: после сохранения поверх адрес тот же, байты новые.
        const res = await fetch(url, { signal: abort.signal, cache: "no-store" })
        if (!res.ok) throw new Error(String(res.status))

        // Размер из каталога бывает пустым — у файла, залитого мимо браузера.
        // Тогда предел проверяется по ответу, до чтения тела.
        const length = Number(res.headers.get("content-length") ?? "")
        if (Number.isFinite(length) && length > TEXT_PREVIEW_LIMIT) {
          setState({ kind: "tooBig", size: length })
          return
        }

        const text = await res.text()
        if (!abort.signal.aborted) setState({ kind: "ready", text })
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return
        setState({ kind: "failed" })
      }
    })()

    return () => abort.abort()
  }, [url, sizeBytes, enabled])

  return state
}

/** Общая рамка: подпись сверху, прокручиваемое содержимое под ней. */
function TextFrame({
  note,
  bare,
  className,
  children,
}: {
  note?: string
  /** Содержимое прокручивает себя само (своими колонками). */
  bare?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full min-h-0 flex-col overflow-hidden bg-ws-well",
        className,
      )}
    >
      {note ? (
        <p className="flex-none border-b border-foreground/[0.07] px-3 py-1.5 text-[11.5px] text-ws-4">
          {note}
        </p>
      ) : null}
      <div className={cn("min-h-0 flex-1", bare ? "overflow-hidden" : "scrollbar-elegant overflow-auto")}>{children}</div>
    </div>
  )
}

/** Сообщение вместо содержимого — «пусто», «слишком большой», «не прочитался». */
function TextNote({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center text-[12px] text-ws-4">
      {text}
    </div>
  )
}

/**
 * Моноширинный текст с номерами строк.
 *
 * Номера — отдельной колонкой, а не частью строки: иначе они попадали бы в
 * буфер обмена вместе с текстом, и скопированный кусок лога или CSV пришлось
 * бы чистить руками.
 */
function PlainText({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="flex min-w-0 font-mono text-[12px] leading-[1.55]">
      <div
        aria-hidden
        className="flex-none select-none border-r border-foreground/[0.07] px-2 py-2 text-right tabular-nums text-ws-5"
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="min-w-0 flex-1 whitespace-pre px-3 py-2 text-ws-2">
        {text}
      </pre>
    </div>
  )
}

/**
 * Субтитры таблицей: номер, интервал, реплика.
 *
 * Разбирает уже готовый `parseSrt` — он заявлен на оба формата сразу, терпит
 * заголовок WEBVTT, подписи блоков и точку вместо запятой. Не разобралось
 * ничего — показываем файл как обычный текст: пустая таблица вместо непонятного
 * файла ничего не объясняет, а буквами человек хотя бы увидит, что внутри.
 */
function Subtitles({ cues }: { cues: SrtCue[] }) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <tbody>
        {cues.map((cue, i) => (
          <tr
            key={`${cue.index}-${i}`}
            className="border-b border-foreground/[0.05] align-top"
          >
            <td className="w-10 px-2 py-1.5 text-right tabular-nums text-ws-5">
              {cue.index}
            </td>
            <td className="w-[188px] whitespace-nowrap px-2 py-1.5 font-mono text-[11.5px] tabular-nums text-ws-4">
              {formatSrtTc(cue.startMs)} → {formatSrtTc(cue.endMs)}
            </td>
            <td className="whitespace-pre-wrap px-2 py-1.5 text-ws-2">
              {cue.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Показ уже загруженного текста по виду. */
function TextBody({
  kind,
  name,
  text,
  sizesKey,
  className,
}: {
  kind: TextKind
  name: string
  text: string
  sizesKey: string
  className?: string
}) {
  const { t } = useI18n()
  const lines = tf(t.previewLines, { count: text.split("\n").length })

  if (kind === "markdown") {
    return (
      <TextFrame className={className}>
        {/* Тот же просмотрщик, что и у описания проекта: санитайз обязателен —
            файл пришёл из хранилища и доверенным содержимым не является. */}
        <MarkdownView className="px-4 py-3">{text}</MarkdownView>
      </TextFrame>
    )
  }

  if (kind === "markup") {
    return (
      <TextFrame className={className} bare>
        <MarkupView source={text} className="px-4 py-3" />
      </TextFrame>
    )
  }

  if (kind === "subtitles") {
    const cues = parseSrt(text)
    if (cues.length > 0) {
      return (
        <TextFrame
          className={className}
          note={tf(t.previewCues, { count: cues.length })}
        >
          <Subtitles cues={cues} />
        </TextFrame>
      )
    }
  }

  if (kind === "json") {
    // Битый JSON — не повод показать пустоту: это ровно тот случай, когда в файл
    // и лезут смотреть. Показываем как есть и говорим, что он не разобрался.
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return (
        <TextFrame className={className} note={t.previewJsonBroken}>
          <PlainText text={text} />
        </TextFrame>
      )
    }
    return (
      <TextFrame className={className}>
        <JsonTree value={value} className="px-2 py-2" />
      </TextFrame>
    )
  }

  if (kind === "table") {
    // csv/tsv — только таблицей, обычным текстом их не показываем нигде.
    return <TableView name={name} source={text} sizesKey={sizesKey} className={className} />
  }

  return (
    <TextFrame className={className} note={lines}>
      <PlainText text={text} />
    </TextFrame>
  )
}

function jsonError(text: string, message: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch {
    return message
  }
}

export function TextFile({
  url,
  name,
  mimeType,
  sizeBytes,
  className,
  editing = false,
  onSave,
  onCancelEdit,
  onReady,
  sizesKey,
}: {
  /** Адрес, отдающий тело файла с того же источника. Смена адреса — перечитать. */
  url: string
  name: string
  mimeType?: string
  sizeBytes?: number | null
  className?: string
  /** Показать редактор вместо просмотра. Нужен `onSave`. */
  editing?: boolean
  /** `false` — не сохранилось: редактор остаётся, черновики не пишутся. */
  onSave?: (text: string) => Promise<boolean | void>
  onCancelEdit?: () => void
  /** Текст загружен и его можно править (не слишком большой, прочитался). */
  onReady?: (ready: boolean) => void
  /**
   * Устойчивый ключ файла для размеров столбцов и строк таблицы в браузере.
   * По умолчанию — адрес без запроса (без версии и `raw=1`).
   */
  sizesKey?: string
}) {
  const { t } = useI18n()
  const kind = textKind(name, mimeType ?? "") ?? "plain"
  const state = useFileText(url, sizeBytes, kind !== "unsupported")
  const ready = state.kind === "ready"
  const tableKey = sizesKey ?? url.split("?")[0]

  useEffect(() => {
    onReady?.(ready)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  if (kind === "unsupported") {
    return (
      <TextFrame className={className}>
        <TextNote text={t.textUnsupported} />
      </TextFrame>
    )
  }
  if (state.kind === "loading") {
    return (
      <TextFrame className={className}>
        <TextNote text={t.previewLoading} />
      </TextFrame>
    )
  }
  if (state.kind === "tooBig") {
    return (
      <TextFrame className={className}>
        <TextNote text={tf(t.previewTextTooBig, { size: fmtSize(state.size) })} />
      </TextFrame>
    )
  }
  if (state.kind === "failed") {
    return (
      <TextFrame className={className}>
        <TextNote text={t.previewTextFailed} />
      </TextFrame>
    )
  }

  const text = state.text

  if (editing && onSave) {
    const cancel = onCancelEdit ?? (() => {})
    // Оформление — у txt и ячеек csv/tsv. Остальное правится простым полем: разметка
    // в json или srt была бы порчей файла, а не оформлением.
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        {kind === "markup" ? (
          <MarkupFileEditor initial={text} onSave={onSave} onCancel={cancel} />
        ) : kind === "table" ? (
          <TableFileEditor
            name={name}
            initial={text}
            sizesKey={tableKey}
            onSave={onSave}
            onCancel={cancel}
          />
        ) : (
          <PlainEditor
            initial={text}
            onSave={onSave}
            onCancel={cancel}
            validate={
              kind === "json"
                ? (next) => jsonError(next, t.textJsonCantSave)
                : undefined
            }
          />
        )}
      </div>
    )
  }

  if (text.trim() === "") {
    return (
      <TextFrame className={className}>
        <TextNote text={t.previewTextEmpty} />
      </TextFrame>
    )
  }

  return (
    <TextBody kind={kind} name={name} text={text} sizesKey={tableKey} className={className} />
  )
}
