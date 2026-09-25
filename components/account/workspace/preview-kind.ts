import type { DriveFile } from "./types"

/**
 * Чем показывать файл в превью.
 *
 * Отдельный модуль, а не пара `if` внутри компонента, потому что вид файла
 * нужен в трёх местах сразу: сама панель превью, иконка в списке и её цвет.
 *
 * Считается по расширению, а MIME — только подсказка, и порядок тут именно
 * такой не для красоты. `.srt` и `.vtt` в `lib/project-upload-policy.ts` не
 * перечислены, поэтому при загрузке им достаётся `application/octet-stream`:
 * по типу субтитры не опознать в принципе. То же и с файлами, залитыми мимо
 * браузера, — у них тип бывает пустым.
 */
export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "subtitles"
  | "json"
  | "text"
  /** Показать нечем: архив, docx, exe, незнакомое расширение. */
  | "none"

/**
 * Сколько байт текстового файла готовы забрать ради превью.
 *
 * Предел не формальный: текст идёт не редиректом на хранилище, а телом через
 * Next (см. роут файла проекта), то есть лог на пару сотен мегабайт прокачался
 * бы через сервер целиком и осел в памяти вкладки. Полтора мегабайта — это
 * заведомо больше любого разумного `.srt`, `.json` или описания.
 */
export const TEXT_PREVIEW_LIMIT = 1_500_000

/** Расширение в нижнем регистре, без точки. Нет точки — пустая строка. */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * Что браузер действительно играет сам, без единой библиотеки.
 *
 * `mov` в списке видео с оговоркой: контейнер QuickTime Safari открывает всегда,
 * Chrome — только когда внутри H.264. Пробуем показать, а решает плеер: пустой
 * кадр с элементами управления честнее, чем иконка «показать нечем» у файла,
 * который у половины пользователей открылся бы.
 *
 * `mkv`, `avi`, `wma`, `heic` не открывает никто — им место в `none`, и
 * перекодировать их в браузере без библиотек всё равно нечем.
 */
const BY_EXT: Record<string, PreviewKind> = {
  // Картинки. `svg` показывается только через <img> — см. TextPreview/PreviewMedia.
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  svg: "image",

  mp4: "video",
  m4v: "video",
  webm: "video",
  ogv: "video",
  mov: "video",

  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  flac: "audio",

  pdf: "pdf",

  md: "markdown",
  markdown: "markdown",

  srt: "subtitles",
  vtt: "subtitles",

  json: "json",

  txt: "text",
  log: "text",
  csv: "text",
  tsv: "text",
  xml: "text",
  yml: "text",
  yaml: "text",
  ini: "text",
  conf: "text",
  sql: "text",
  js: "text",
  mjs: "text",
  ts: "text",
  tsx: "text",
  css: "text",
  html: "text",
}

/**
 * Тип из каталога — запасной путь, когда расширение ничего не сказало.
 *
 * `text/*` целиком считаем текстом: сюда попадают файлы без расширения, залитые
 * с правильным типом. А `application/octet-stream` намеренно не разбираем — это
 * не «двоичный файл», это «тип потеряли», и угадывать по нему нечего.
 */
function kindByMime(mime: string): PreviewKind {
  const type = mime.split(";")[0].trim().toLowerCase()
  if (type === "application/json") return "json"
  if (type === "application/pdf") return "pdf"
  if (type === "text/markdown") return "markdown"
  if (type.startsWith("text/")) return "text"
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  return "none"
}

export function previewKind(file: {
  name: string
  mimeType: string
  isFolder?: boolean
}): PreviewKind {
  if (file.isFolder) return "none"
  const byExt = BY_EXT[fileExt(file.name)]
  if (byExt) return byExt
  return kindByMime(file.mimeType ?? "")
}

/** Виды, которые читаются текстом: качаются `fetch`, а не отдаются плееру. */
export function isTextual(kind: PreviewKind): boolean {
  return (
    kind === "text" ||
    kind === "json" ||
    kind === "markdown" ||
    kind === "subtitles"
  )
}

/** Тот же расчёт для записи дерева, где полей меньше, чем в `DriveFile`. */
export function previewKindOf(file: DriveFile): PreviewKind {
  return previewKind(file)
}
