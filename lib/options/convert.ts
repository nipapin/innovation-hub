/**
 * Конвертация файла: разбор значения `convertSettings` —
 * docs/CONVERT_CONTROL_PLAN.md.
 *
 * Чистый модуль, как overlay.ts, video-adjust.ts и title.ts.
 *
 * Значение — СТРОКА с JSON. Сайт правит четыре вещи: формат, качество, размер
 * кадра и звук. Цепочки фильтров, кодеки, пиксельный формат, частота и каналы
 * принадлежат автору графа и возвращаются нетронутыми.
 */

/**
 * Что предлагаем на выходе. Расширение — единственный источник правды о формате.
 *
 * Тип выхода плагин определяет НЕ по такому списку, а по словарю типов файлов
 * установки (`getFileTypeByExt` + `typeOfFile`): `mp4` — видео, `png` —
 * картинка, `mp3` — звук. Наши три набора не классификация, а ПРЕДЛОЖЕНИЕ:
 * самые ходовые расширения каждого рода. Поэтому они обязаны лежать в том же
 * словаре — иначе клиент выберет формат, который машина отнесёт не к тому роду.
 */
export const CONVERT_VIDEO_FORMATS = ["mp4", "mov", "webm", "mkv"] as const
export const CONVERT_IMAGE_FORMATS = ["jpg", "png", "webp"] as const
/** Звук отдельным выходом: «вытащи дорожку из ролика» — обычная просьба. */
export const CONVERT_AUDIO_FORMATS = ["mp3", "wav", "m4a"] as const
export const CONVERT_FORMATS = [
  ...CONVERT_VIDEO_FORMATS,
  ...CONVERT_IMAGE_FORMATS,
  ...CONVERT_AUDIO_FORMATS,
] as const
export type ConvertFormat = (typeof CONVERT_FORMATS)[number]

export type ConvertKind = "video" | "image" | "audio"

/** Род выхода по расширению — по нему модалка решает, что показывать. */
export function convertKind(format: string): ConvertKind {
  if ((CONVERT_IMAGE_FORMATS as readonly string[]).includes(format)) return "image"
  if ((CONVERT_AUDIO_FORMATS as readonly string[]).includes(format)) return "audio"
  return "video"
}

export function isImageFormat(format: string): boolean {
  return convertKind(format) === "image"
}

export type ConvertQuality = "draft" | "normal" | "high" | "max" | "custom"

/**
 * Качество — одна ручка на четыре поля.
 *
 * По отдельности `crf`, `preset`, `quality` и битрейт клиенту ничего не говорят,
 * а вместе означают понятное «полегче или получше». Заготовка при этом не режим:
 * в значении остаются только числа, имени там нет.
 *
 * `custom` — не заготовка, а признак «числа не совпали ни с одной»: автор графа
 * мог выставить своё, и подписывать это «высоким» значило бы соврать.
 */
export const CONVERT_QUALITY: Record<
  Exclude<ConvertQuality, "custom">,
  { crf: number; preset: string; imageQuality: number; audioBitrate: string }
> = {
  draft: { crf: 30, preset: "veryfast", imageQuality: 70, audioBitrate: "96k" },
  normal: { crf: 23, preset: "fast", imageQuality: 85, audioBitrate: "192k" },
  high: { crf: 20, preset: "medium", imageQuality: 92, audioBitrate: "256k" },
  max: { crf: 17, preset: "slow", imageQuality: 98, audioBitrate: "320k" },
}

export type ConvertSize = "source" | "1080" | "720" | "480"

/**
 * Размер кадра — через НОЛЬ по второй стороне.
 *
 * В `FrameSettings` ноль означает «вывести из пропорций по другой стороне».
 * Задай мы обе, вертикальное видео растянулось бы в горизонтальное; так оно
 * остаётся вертикальным, просто становится ниже.
 */
export const CONVERT_SIZES: Record<
  ConvertSize,
  { mode: "original" | "fixed"; width: number; height: number }
> = {
  source: { mode: "original", width: 0, height: 0 },
  "1080": { mode: "fixed", width: 0, height: 1080 },
  "720": { mode: "fixed", width: 0, height: 720 },
  "480": { mode: "fixed", width: 0, height: 480 },
}

export type ConvertValue = {
  format: ConvertFormat
  quality: ConvertQuality
  size: ConvertSize
  audio: boolean
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function defaultConvertValue(): ConvertValue {
  return { format: "mp4", quality: "normal", size: "source", audio: true }
}

/** Кодек — только для показа в карточке: сайт его не меняет. */
export function convertCodec(raw: unknown): string | null {
  const root = parseRoot(raw)
  const codec = asRecord(root?.video)?.codec
  return typeof codec === "string" && codec ? codec : null
}

function parseRoot(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string" && raw.trim()) {
    try {
      return asRecord(JSON.parse(raw))
    } catch {
      return null
    }
  }
  return asRecord(raw)
}

/**
 * Какая заготовка совпала с числами в файле.
 *
 * Сверяем `crf` и `preset` — они определяют вид сильнее прочего. Не сошлось —
 * `custom`: показать «высокое» там, где значения другие, значило бы соврать о
 * том, что получится.
 */
function matchQuality(video: Record<string, unknown> | null): ConvertQuality {
  if (!video) return "normal"
  for (const [name, preset] of Object.entries(CONVERT_QUALITY)) {
    if (
      Math.abs(num(video.crf, NaN) - preset.crf) < 0.001 &&
      video.preset === preset.preset
    ) {
      return name as ConvertQuality
    }
  }
  return "custom"
}

function matchSize(frame: Record<string, unknown> | null): ConvertSize {
  if (!frame) return "source"
  if (frame.mode !== "fixed") return "source"
  const height = num(frame.height, 0)
  for (const [name, preset] of Object.entries(CONVERT_SIZES)) {
    if (preset.mode === "fixed" && preset.height === height) {
      return name as ConvertSize
    }
  }
  return "source"
}

export function parseConvertValue(raw: unknown): ConvertValue {
  const fallback = defaultConvertValue()
  const root = parseRoot(raw)
  if (!root) return fallback

  const video = asRecord(root.video)
  const audio = asRecord(root.audio)
  const extension =
    typeof root.outputExtension === "string"
      ? root.outputExtension.toLowerCase()
      : ""

  return {
    format:
      (CONVERT_FORMATS as readonly string[]).includes(extension)
        ? (extension as ConvertFormat)
        : fallback.format,
    quality: matchQuality(video),
    size: matchSize(asRecord(video?.frame)),
    audio: audio ? audio.enabled !== false : fallback.audio,
  }
}

/**
 * Слияние правки клиента в ТЕКУЩЕЕ значение из файла.
 *
 * Цепочки фильтров, кодеки, пиксельный формат, альфа, частота и каналы берутся
 * из файла и возвращаются на место: слияние на сервере, не доверие браузеру.
 *
 * `custom` не пишется никогда — это не заготовка, а отсутствие совпадения. Если
 * клиент его не трогал, числа остаются авторскими.
 */
export function mergeConvertValue(
  currentRaw: unknown,
  incoming: ConvertValue,
): string {
  const root = parseRoot(currentRaw) ?? {}
  const video = asRecord(root.video) ?? {}
  const audioBlock = asRecord(root.audio) ?? {}
  const image = asRecord(root.image) ?? {}
  const frame = asRecord(video.frame) ?? {}

  root.outputExtension = incoming.format

  const size = CONVERT_SIZES[incoming.size]
  const quality =
    incoming.quality === "custom" ? null : CONVERT_QUALITY[incoming.quality]

  root.video = {
    ...video,
    frame: { ...frame, mode: size.mode, width: size.width, height: size.height },
    ...(quality ? { crf: quality.crf, preset: quality.preset } : {}),
  }
  root.image = {
    ...image,
    ...(quality ? { quality: quality.imageQuality } : {}),
  }
  root.audio = {
    ...audioBlock,
    // У звукового выхода дорожка — это и есть результат: выключить её значило
    // бы попросить пустой файл. Поэтому там `enabled` всегда true, а выбора
    // «без звука» модалка не показывает вовсе.
    enabled: convertKind(incoming.format) === "audio" ? true : incoming.audio,
    ...(quality ? { bitrate: quality.audioBitrate } : {}),
  }
  return JSON.stringify(root)
}
