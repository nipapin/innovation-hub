/**
 * Маски путей и имён производства — docs/PRODUCTION_PLAN.md §3.4.
 *
 * Стиль тот же, что в программе (`fs.manager.tauri`, `Utils/masks.ts`): токен на
 * `$`, единый список, из которого берутся и подсказки при вводе, и подстановка.
 *
 * Путь — массив сегментов, а не строка с разделителями: так его хранит и
 * редактор программы (`ChipAutocompleteProperty`), и так нельзя «сломать»
 * путь лишним слешем внутри названия ролика.
 *
 * Время (`$YYYY` … `$ss`, `$runTime`) — момент запуска ролика, одно на весь
 * ролик (решение 2026-09-30): пути всех этапов одного ролика не разъезжаются по
 * датам. `$stageTime` — момент, когда открылся этап. Часы — по поясу того, кто
 * запустил ролик: сервер живёт в UTC, а папка «09.30-14.05» должна совпадать с
 * часами на его экране.
 *
 * Чистый модуль: без React и без базы. Его читают и редактор пайплайна в
 * браузере, и сервер при запуске ролика и открытии этапа.
 */

/**
 * Где стоит маска — от этого зависит, что известно в момент подстановки:
 *
 * - `project` — имя папки-проекта этапа: общая на все ролики, поэтому только
 *   пайплайн;
 * - `path` — рабочая и финальная папки этапа: всё о ролике и этапе;
 * - `input` — входная папка: плюс `$prevStageName`, она считается на каждый
 *   этап-источник отдельно;
 * - `file` — имя файла (строки формы): плюс `$fileName` и `$user`;
 * - `run` — название ролика по умолчанию в окне запуска: ролика ещё нет, есть
 *   пайплайн, время и тот, кто запускает.
 */
export type MaskScope = "project" | "path" | "input" | "file" | "run"

export type MaskContext = {
  pipelineName: string
  runName?: string
  /** Момент запуска ролика. */
  runStartedAt?: Date
  /** Сдвиг пояса запустившего, как у `Date.getTimezoneOffset()`: минуты, UTC − местное. */
  tzOffsetMin?: number
  stageName?: string
  /** Номер этапа по порядку в пайплайне, с 1. */
  stageNum?: number
  stageStartedAt?: Date
  prevStageName?: string
  user?: string
  fileName?: string
}

export type MaskDef = {
  token: string
  /** Ключ подписи в словаре кабинета — подсказка при вводе. */
  labelKey: string
  scopes: readonly MaskScope[]
  resolve: (ctx: MaskContext, arg: number | null) => string | null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Часы и дата в поясе запустившего. */
function local(date: Date | undefined, tz: number | undefined): Date | null {
  if (!date) return null
  return new Date(date.getTime() - (tz ?? 0) * 60_000)
}

const part = (pick: (d: Date) => string) => (c: MaskContext) => {
  const d = local(c.runStartedAt, c.tzOffsetMin)
  return d ? pick(d) : null
}

/** «09.30-14.05» — месяц.день-часы.минуты, формат программы. */
function stamp(date: Date | undefined, tz: number | undefined): string | null {
  const d = local(date, tz)
  if (!d) return null
  return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}-${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}`
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const RANDOM_DEFAULT = 10
const RANDOM_MAX = 32

/** Случайная строка в духе nanoid: буквы и цифры, без символов, опасных в пути. */
export function randomToken(length = RANDOM_DEFAULT): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ""
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

const ALL: readonly MaskScope[] = ["path", "input", "file"]
const TIMED: readonly MaskScope[] = [...ALL, "run"]

export const PRODUCTION_MASKS: readonly MaskDef[] = [
  { token: "$pipelineName", labelKey: "productionMaskPipeline", scopes: ["project", ...TIMED], resolve: (c) => c.pipelineName },
  { token: "$runName", labelKey: "productionMaskRun", scopes: ALL, resolve: (c) => c.runName ?? null },
  { token: "$runTime", labelKey: "productionMaskRunTime", scopes: TIMED, resolve: (c) => stamp(c.runStartedAt, c.tzOffsetMin) },
  { token: "$stageName", labelKey: "productionMaskStage", scopes: ALL, resolve: (c) => c.stageName ?? null },
  { token: "$stageNum", labelKey: "productionMaskStageNum", scopes: ALL, resolve: (c) => (c.stageNum ? pad(c.stageNum) : null) },
  { token: "$stageTime", labelKey: "productionMaskStageTime", scopes: ALL, resolve: (c) => stamp(c.stageStartedAt, c.tzOffsetMin) },
  { token: "$prevStageName", labelKey: "productionMaskPrevStage", scopes: ["input", "file"], resolve: (c) => c.prevStageName ?? null },
  { token: "$user", labelKey: "productionMaskUser", scopes: TIMED, resolve: (c) => c.user ?? null },
  { token: "$fileName", labelKey: "productionMaskFileName", scopes: ["file"], resolve: (c) => c.fileName ?? null },
  { token: "$random", labelKey: "productionMaskRandom", scopes: ["project", ...TIMED], resolve: (_c, n) => randomToken(n ?? RANDOM_DEFAULT) },
  { token: "$YYYY", labelKey: "productionMaskYear", scopes: TIMED, resolve: part((d) => String(d.getUTCFullYear())) },
  { token: "$MM", labelKey: "productionMaskMonth", scopes: TIMED, resolve: part((d) => pad(d.getUTCMonth() + 1)) },
  { token: "$DD", labelKey: "productionMaskDay", scopes: TIMED, resolve: part((d) => pad(d.getUTCDate())) },
  { token: "$HH", labelKey: "productionMaskHour", scopes: TIMED, resolve: part((d) => pad(d.getUTCHours())) },
  { token: "$mm", labelKey: "productionMaskMinute", scopes: TIMED, resolve: part((d) => pad(d.getUTCMinutes())) },
  { token: "$ss", labelKey: "productionMaskSecond", scopes: TIMED, resolve: part((d) => pad(d.getUTCSeconds())) },
]

/** Название ролика по шаблону ноды «Старт» — окно запуска подставляет его сразу. */
export function resolveRunName(template: string, ctx: MaskContext): string {
  const result = resolveSegment(template, ctx, "run")
  return result.ok ? result.value : ""
}

const BY_TOKEN = new Map(PRODUCTION_MASKS.map((mask) => [mask.token, mask]))

/**
 * Токен читается жадно, до первого не-буквы и не-цифры: `$runName_2` — это
 * `$runName` и текст, а `$runName2` — неизвестная маска. Так опечатка видна
 * сразу, а не превращается в «Промо 122». Скобки с числом — только у `$random`.
 */
const TOKEN_RE = /\$([A-Za-z][A-Za-z0-9]*)(?:\((\d{1,2})\))?/g

function parse(segment: string): { raw: string; token: string; arg: number | null }[] {
  return [...segment.matchAll(TOKEN_RE)].map((m) => ({
    raw: m[0],
    token: `$${m[1]}`,
    arg: m[2] === undefined ? null : Number(m[2]),
  }))
}

/** Токены сегмента, которых нет в списке или которым здесь не место. */
export function unknownMasks(segment: string, scope: MaskScope = "path"): string[] {
  return parse(segment)
    .filter(({ token, arg }) => {
      const mask = BY_TOKEN.get(token)
      if (!mask || !mask.scopes.includes(scope)) return true
      if (arg !== null && (token !== "$random" || arg < 1 || arg > RANDOM_MAX)) return true
      return false
    })
    .map(({ raw }) => raw)
}

/** Подсказки для ввода: маски этого места, начинающиеся с набранного. */
export function suggestMasks(typed: string, scope: MaskScope = "path"): MaskDef[] {
  if (!typed.startsWith("$")) return []
  const lower = typed.toLowerCase()
  return PRODUCTION_MASKS.filter(
    (mask) => mask.scopes.includes(scope) && mask.token.toLowerCase().startsWith(lower),
  )
}

export function hasMask(segments: readonly string[], token: string): boolean {
  return segments.some((segment) => parse(segment).some((m) => m.token === token))
}

/**
 * Значение, подставленное в сегмент, не должно менять структуру пути: слеш в
 * названии ролика «Промо 12/13» иначе завёл бы лишнюю папку, а `..` вывело бы
 * наружу. Поэтому разделители заменяются, края чистятся.
 */
export function safeValue(value: string): string {
  return value
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
}

export type ResolveError =
  | { code: "unknown-mask"; segment: string; masks: string[] }
  | { code: "empty-value"; segment: string; mask: string }
  | { code: "empty-segment"; index: number }
  | { code: "dot-segment"; segment: string }

export type ResolveResult =
  | { ok: true; path: string; segments: string[] }
  | { ok: false; error: ResolveError }

function resolveSegment(
  raw: string,
  ctx: MaskContext,
  scope: MaskScope,
): { ok: true; value: string } | { ok: false; error: ResolveError } {
  const unknown = unknownMasks(raw, scope)
  if (unknown.length > 0) return { ok: false, error: { code: "unknown-mask", segment: raw, masks: unknown } }
  let failed: string | null = null
  const value = raw.replace(TOKEN_RE, (match, name: string, arg: string | undefined) => {
    const mask = BY_TOKEN.get(`$${name}`)!
    const resolved = mask.resolve(ctx, arg === undefined ? null : Number(arg))
    const safe = resolved == null ? "" : safeValue(resolved)
    if (!safe) failed ??= mask.token
    return safe
  })
  if (failed) return { ok: false, error: { code: "empty-value", segment: raw, mask: failed } }
  return { ok: true, value: value.trim() }
}

/**
 * Подставить маски в путь. Неизвестная маска — ошибка, а не папка с именем
 * `$что-то`: в программе это известная ловушка (`formatNameByPattern`), здесь
 * путь уходит в хранилище, и молча созданная папка хуже отказа.
 */
export function resolvePath(
  segments: readonly string[],
  ctx: MaskContext,
  scope: MaskScope = "path",
): ResolveResult {
  const out: string[] = []
  for (let index = 0; index < segments.length; index += 1) {
    const raw = segments[index]
    const result = resolveSegment(raw, ctx, scope)
    if (!result.ok) return result
    const value = result.value
    if (!value) return { ok: false, error: { code: "empty-segment", index } }
    if (value === "." || value === "..") {
      return { ok: false, error: { code: "dot-segment", segment: raw } }
    }
    out.push(value)
  }
  return { ok: true, path: out.join("/"), segments: out }
}

/**
 * Имя файла по шаблону строки формы. Расширение — всегда исходное: файлы мы не
 * меняем, только называем. Пустой шаблон — имя как есть.
 */
export function resolveFileName(template: string, ctx: MaskContext, original: string): string | null {
  const dot = original.lastIndexOf(".")
  const ext = dot > 0 ? original.slice(dot) : ""
  const base = dot > 0 ? original.slice(0, dot) : original
  if (!template.trim()) return original
  const result = resolveSegment(template, { ...ctx, fileName: base }, "file")
  if (!result.ok || !result.value) return null
  return `${result.value}${ext}`
}

/**
 * Проверка шаблона без контекста — при сохранении ноды и перед активацией:
 * известны ли маски и нет ли пустых сегментов. Значения подставятся позже.
 */
export function checkTemplate(segments: readonly string[], scope: MaskScope = "path"): ResolveError | null {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment.trim()) return { code: "empty-segment", index }
    if (segment.trim() === "." || segment.trim() === "..") {
      return { code: "dot-segment", segment }
    }
    const unknown = unknownMasks(segment, scope)
    if (unknown.length > 0) return { code: "unknown-mask", segment, masks: unknown }
  }
  return null
}

/** Отличает ли путь ролики друг от друга: без этого файлы разных роликов смешаются. */
export function isPerRun(segments: readonly string[]): boolean {
  return ["$runName", "$runTime", "$random"].some((token) => hasMask(segments, token))
}
