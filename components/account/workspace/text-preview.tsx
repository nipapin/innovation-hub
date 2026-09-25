"use client"

import { useEffect, useState } from "react"

import { tf } from "@/components/account/i18n"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { parseSrt, type SrtCue } from "@/lib/tools/dialog/srt-parse"
import { formatSrtTc } from "@/lib/tools/dialog/timecode"
import { cn } from "@/lib/utils"
import { fmtSize } from "./format"
import { TEXT_PREVIEW_LIMIT, type PreviewKind } from "./preview-kind"
import type { DriveFile } from "./types"
import { useWorkspace } from "./workspace-context"

/**
 * Превью текстовых файлов: обычный текст, JSON, субтитры, Markdown.
 *
 * Содержимое берётся `fetch` по тому же роуту файла, но **без** `inline=1`:
 * с ним роут отвечает редиректом на хранилище, а это чужой источник, и CORS
 * закрыл бы чтение тела. Без него тело идёт через Next, то есть тот же origin
 * (та же причина описана в самом роуте — там так читают `dialog.json`).
 *
 * Отсюда же и предел размера: тело качается целиком, без Range, поэтому лог на
 * сотни мегабайт прокачался бы через сервер и осел в памяти вкладки. За
 * пределом файл не читается вовсе — предлагаем скачать.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "tooBig" }
  | { kind: "failed" }
  | { kind: "ready"; text: string }

function useFileText(url: string, sizeBytes: number | null): Loaded {
  const [state, setState] = useState<Loaded>({ kind: "loading" })

  useEffect(() => {
    if (sizeBytes != null && sizeBytes > TEXT_PREVIEW_LIMIT) {
      setState({ kind: "tooBig" })
      return
    }

    // Файл переключают стрелками быстрее, чем приходит ответ: без отмены
    // содержимое предыдущего легло бы поверх текущего.
    const abort = new AbortController()
    setState({ kind: "loading" })

    void (async () => {
      try {
        const res = await fetch(url, { signal: abort.signal })
        if (!res.ok) throw new Error(String(res.status))

        // Размер из каталога бывает пустым — у файла, залитого мимо браузера.
        // Тогда предел проверяется по ответу, до чтения тела.
        const length = Number(res.headers.get("content-length") ?? "")
        if (Number.isFinite(length) && length > TEXT_PREVIEW_LIMIT) {
          setState({ kind: "tooBig" })
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
  }, [url, sizeBytes])

  return state
}

/** Общая рамка: подпись сверху, прокручиваемое содержимое под ней. */
function TextFrame({
  note,
  className,
  children,
}: {
  note?: string
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
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

/** Сообщение вместо содержимого — «пусто», «слишком большой», «не прочитался». */
function TextNote({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-ws-4">
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

export function TextPreview({
  file,
  url,
  kind,
  className,
}: {
  file: DriveFile
  url: string
  kind: PreviewKind
  className?: string
}) {
  const { t } = useWorkspace()
  const state = useFileText(url, file.sizeBytes)

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
        <TextNote
          text={tf(t.previewTextTooBig, { size: fmtSize(file.sizeBytes) })}
        />
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
  if (text.trim() === "") {
    return (
      <TextFrame className={className}>
        <TextNote text={t.previewTextEmpty} />
      </TextFrame>
    )
  }

  if (kind === "markdown") {
    return (
      <TextFrame className={className}>
        {/* Тот же просмотрщик, что и у описания проекта: санитайз обязателен —
            файл пришёл из хранилища и доверенным содержимым не является. */}
        <MarkdownView className="px-4 py-3">{text}</MarkdownView>
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
    return (
      <TextFrame
        className={className}
        note={tf(t.previewLines, { count: text.split("\n").length })}
      >
        <PlainText text={text} />
      </TextFrame>
    )
  }

  if (kind === "json") {
    // Битый JSON — не повод показать пустоту: это ровно тот случай, когда в файл
    // и лезут смотреть. Показываем как есть и говорим, что он не разобрался.
    let pretty: string
    let broken = false
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      pretty = text
      broken = true
    }
    return (
      <TextFrame
        className={className}
        note={
          broken
            ? t.previewJsonBroken
            : tf(t.previewLines, { count: pretty.split("\n").length })
        }
      >
        <PlainText text={pretty} />
      </TextFrame>
    )
  }

  return (
    <TextFrame
      className={className}
      note={tf(t.previewLines, { count: text.split("\n").length })}
    >
      <PlainText text={text} />
    </TextFrame>
  )
}
