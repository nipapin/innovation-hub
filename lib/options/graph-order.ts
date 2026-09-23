/**
 * Порядок нод по конвейеру — docs/OVERLAY_CONTROL_PLAN.md §8.3.
 *
 * Список настроек клиента читается сверху вниз как последовательность работы:
 * сначала то, что задаётся в ранних нодах, потом в поздних. Порядок массива
 * `nodes` этого не отражает — он случаен и зависит от того, в каком порядке
 * автор раскладывал ноды на холсте. В проекте «Наложение логотипа» это давало
 * наложение раньше выбора файла, хотя сначала выбирают объект, потом ставят его
 * на место.
 *
 * Сортировка топологическая: нода-источник раньше своего потребителя. Циклы в
 * графе обработки невозможны, но код к ним готов — застрявшие ноды дописываются
 * в конец в исходном порядке, а не теряются.
 */

type Graph = {
  nodes?: unknown
  edges?: unknown
}

function nodeId(node: unknown): string | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null
  const id = (node as Record<string, unknown>).id
  return typeof id === "string" && id ? id : null
}

/**
 * Порядковый номер ноды в конвейере: `id ноды → место`.
 *
 * `null` — разобрать не вышло (нет нод или рёбер), и вызывающий оставляет
 * порядок как есть. Молчаливый возврат пустой карты был бы хуже: он выглядел бы
 * как «все ноды равны» и перетасовал бы список без причины.
 */
export function nodeOrderMap(root: unknown): Map<string, number> | null {
  if (!root || typeof root !== "object" || Array.isArray(root)) return null
  const graph = root as Graph
  if (!Array.isArray(graph.nodes)) return null

  const ids: string[] = []
  for (const node of graph.nodes) {
    const id = nodeId(node)
    if (id) ids.push(id)
  }
  if (ids.length === 0) return null

  const known = new Set(ids)
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]))
  const next = new Map<string, string[]>(ids.map((id) => [id, []]))

  if (Array.isArray(graph.edges)) {
    for (const edge of graph.edges) {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) continue
      const { source, target } = edge as Record<string, unknown>
      if (typeof source !== "string" || typeof target !== "string") continue
      if (!known.has(source) || !known.has(target) || source === target) continue
      next.get(source)!.push(target)
      incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }

  // Очередь в ИСХОДНОМ порядке нод: при равных правах (две независимые ветки)
  // раскладка автора — единственный осмысленный ответ, и менять её незачем.
  const queue = ids.filter((id) => (incoming.get(id) ?? 0) === 0)
  const order = new Map<string, number>()
  let place = 0

  while (queue.length > 0) {
    const id = queue.shift()!
    if (order.has(id)) continue
    order.set(id, place++)
    for (const target of next.get(id) ?? []) {
      const left = (incoming.get(target) ?? 0) - 1
      incoming.set(target, left)
      if (left === 0) queue.push(target)
    }
  }

  // Цикл: оставшиеся дописываем в конец, порядок исходный.
  for (const id of ids) {
    if (!order.has(id)) order.set(id, place++)
  }
  return order
}

/**
 * К какой ноде относится свойство, найденное по пути вида
 * `nodes.3.data.properties.6.controlProps`.
 *
 * Считаем по индексу в массиве `nodes`, а не ищем `id` вверх по дереву: путь
 * строится обходом того же массива, и второй способ добраться до ноды означал
 * бы второй ответ на один вопрос.
 */
export function nodeIdForPath(root: unknown, path: string[]): string | null {
  if (path.length < 2 || path[0] !== "nodes") return null
  if (!root || typeof root !== "object") return null
  const nodes = (root as Graph).nodes
  if (!Array.isArray(nodes)) return null
  const index = Number.parseInt(path[1]!, 10)
  if (!Number.isInteger(index)) return null
  return nodeId(nodes[index])
}

/**
 * Плагин ноды, которой принадлежит свойство: `data.pluginId`.
 *
 * Нужен ровно затем, чтобы отличить свойства одной ноды от всех остальных —
 * например, не показывать в «Настройках» проекта то, что уже показано своим
 * интерфейсом (сборка элемента рисует требования ноды `checkFolder` сама).
 * Показывать одно и то же в двух местах хуже, чем не показывать нигде: правки
 * разъезжаются, а человек не знает, какое из двух полей главнее.
 *
 * Индекс берём из пути, как `nodeIdForPath`, и по той же причине: путь строится
 * обходом того же массива, и второй способ добраться до ноды означал бы второй
 * ответ на один вопрос.
 */
export function nodePluginForPath(root: unknown, path: string[]): string | null {
  if (path.length < 2 || path[0] !== "nodes") return null
  if (!root || typeof root !== "object") return null
  const nodes = (root as Graph).nodes
  if (!Array.isArray(nodes)) return null
  const index = Number.parseInt(path[1]!, 10)
  if (!Number.isInteger(index)) return null
  const node = nodes[index]
  if (!node || typeof node !== "object" || Array.isArray(node)) return null
  const data = (node as Record<string, unknown>).data
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const plugin = (data as Record<string, unknown>).pluginId
  return typeof plugin === "string" && plugin ? plugin : null
}
