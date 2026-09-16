import { isExposedControl } from "./types"
import { nodeIdForPath } from "./graph-order"

/**
 * Что реально будет наложено: путь к файлу из ноды-источника —
 * docs/OVERLAY_CONTROL_PLAN.md §8.5.
 *
 * Разрешается ВНУТРИ проекта и только по его собственному графу. Проект
 * тестового набора у каждого свой: он копируется при активации и настраивается
 * самостоятельно, поэтому смотреть на шаблон или на соседний проект нельзя —
 * ответ обязан целиком выводиться из `options.json` этого проекта.
 *
 * Здесь только ПРОСТОЙ случай: источник — свойство с путём (`pathNavigator`),
 * путь относительный, одно ребро графа. Папка из `Get File From Folder` и
 * восстановление абсолютного пути по хвосту — отдельная работа (§8.5), и до неё
 * рамка остаётся пустой.
 */

type Edge = {
  source?: unknown
  target?: unknown
  sourceHandle?: unknown
  targetHandle?: unknown
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

/**
 * Свойства ноды по её идентификатору. Ноды лежат плоским массивом, свойства — в
 * `data.properties`; ходим тем же путём, каким их собирает разбор настроек.
 */
function propertiesOf(root: unknown, id: string): Record<string, unknown>[] {
  const nodes = asRecord(root)?.nodes
  if (!Array.isArray(nodes)) return []
  for (const node of nodes) {
    const record = asRecord(node)
    if (!record || record.id !== id) continue
    const props = asRecord(record.data)?.properties
    return Array.isArray(props)
      ? props.map(asRecord).filter((p): p is Record<string, unknown> => p !== null)
      : []
  }
  return []
}

/** Путь из свойства, если это свойство с путём и путь непустой. */
function filePathOf(property: Record<string, unknown>): string | null {
  const control = property.controlType
  if (!isExposedControl(control) || control !== "pathNavigator") return null
  const value = asRecord(property.controlProps)?.value
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * Путь к накладываемому файлу для свойства `overlaySettings`.
 *
 * `null` — источник не найден или он не файл; рамка тогда пустая, и это честно.
 *
 * Вход ищем по `targetHandle`: в `overlayAndOffset` передний план приходит в
 * `inputFG`, и брать «любое входящее ребро» нельзя — в ту же ноду входит фон
 * (`inputBG`), то есть сам ролик. Перепутать их значило бы показать в рамке
 * видео вместо накладываемой плашки.
 *
 * Если ребра с `inputFG` нет, берём единственное входящее ребро, ведущее из
 * свойства с путём: у другой ноды наложения вход может называться иначе, а
 * ошибиться при единственном кандидате негде.
 */
export function overlayReferencePath(
  root: unknown,
  propertyPath: string[],
): string | null {
  const nodeId = nodeIdForPath(root, propertyPath)
  if (!nodeId) return null
  const edges = asRecord(root)?.edges
  if (!Array.isArray(edges)) return null

  const incoming = edges
    .map(asRecord)
    .filter((edge): edge is Record<string, unknown> => edge !== null)
    .filter((edge) => edge.target === nodeId) as Edge[]

  const fromEdge = (edge: Edge): string | null => {
    if (typeof edge.source !== "string") return null
    const props = propertiesOf(root, edge.source)
    // sourceHandle — это id свойства-выхода: в `Select File` он `pathNavigator`.
    const named =
      typeof edge.sourceHandle === "string"
        ? props.find((p) => p.id === edge.sourceHandle)
        : undefined
    const candidate = named ?? props.find((p) => filePathOf(p) !== null)
    return candidate ? filePathOf(candidate) : null
  }

  const fg = incoming.find(
    (edge) =>
      typeof edge.targetHandle === "string" &&
      edge.targetHandle.toLowerCase().includes("fg"),
  )
  if (fg) return fromEdge(fg)

  const withFile = incoming.filter((edge) => fromEdge(edge) !== null)
  return withFile.length === 1 ? fromEdge(withFile[0]!) : null
}

/**
 * Путь, записанный в самом свойстве (`fgFilePath`) — второй шаг поиска.
 *
 * Автор графа настраивал наложение у себя на машине, поэтому путь там
 * абсолютный и ведёт в его `Downloads`. Сам файл в проекте есть — он приехал
 * вместе с копией, — просто лежит по другому адресу.
 */
export function overlaySettingsFilePath(rawValue: unknown): string | null {
  if (typeof rawValue !== "string" || !rawValue.trim()) return null
  try {
    const parsed = JSON.parse(rawValue)
    const value = asRecord(parsed)?.fgFilePath
    return typeof value === "string" && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function segments(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .map((part) => part.toLowerCase())
}

/**
 * Найти файл в проекте по чужому пути — сверкой ХВОСТА (§8.5).
 *
 * Идём от имени файла вверх: совпало имя — кандидат; совпала ещё и папка над
 * ним — кандидат сильнее. Побеждает самый длинный совпавший хвост.
 *
 * Ничья НЕ разрешается: два файла с одинаковым именем и одинаково совпавшими
 * папками означают, что вопрос «какой из них» по этим данным не имеет ответа.
 * Показать не тот файл хуже, чем не показать никакой — человек увидит пустую
 * рамку и поймёт, что надо выбрать файл руками.
 *
 * @param candidates пути файлов ОТНОСИТЕЛЬНО корня проекта
 * @param wanted путь из настроек, обычно абсолютный и с чужой машины
 */
export function resolveByTail(
  candidates: readonly string[],
  wanted: string,
): string | null {
  const target = segments(wanted)
  if (target.length === 0) return null
  const name = target[target.length - 1]!

  let best: { path: string; score: number } | null = null
  let tied = false

  for (const candidate of candidates) {
    const parts = segments(candidate)
    if (parts.length === 0 || parts[parts.length - 1] !== name) continue

    // Сколько сегментов с конца совпало — включая само имя.
    let score = 0
    while (
      score < parts.length &&
      score < target.length &&
      parts[parts.length - 1 - score] === target[target.length - 1 - score]
    ) {
      score += 1
    }

    if (!best || score > best.score) {
      best = { path: candidate, score }
      tied = false
    } else if (score === best.score) {
      tied = true
    }
  }

  return best && !tied ? best.path : null
}
