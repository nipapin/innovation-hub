import type { Client } from "pg"
import { createDedicatedClient, query } from "@/lib/db"

/**
 * Живое обновление чатов производства — docs/PRODUCTION_PLAN.md §7.3, §10.2.
 *
 * Одно соединение `LISTEN production_chat` на процесс (не из пула — см.
 * `createDedicatedClient`). Запись в чат зовёт `pg_notify` с id этапа; здесь
 * сигнал раздаётся открытым вкладкам тех, кто в этом чате, и автору пайплайна.
 * Во вкладку уходит только «в чате этапа X что-то изменилось» — сами данные
 * она забирает обычным запросом с проверкой прав.
 *
 * Процесс один и долгоживущий (pm2), поэтому состояние в памяти годится; при
 * нескольких инстансах каждый держит своё соединение, и `NOTIFY` дойдёт до всех.
 */

export type LiveEvent = { stepId: string; type: string }
type Listener = (event: LiveEvent) => void

type State = {
  client: Client | null
  starting: Promise<void> | null
  listeners: Map<string, Set<Listener>>
  retryMs: number
}

// Через globalThis — чтобы горячая перезагрузка в dev не плодила соединения.
const g = globalThis as unknown as { __productionLive?: State }
const state: State = (g.__productionLive ??= {
  client: null,
  starting: null,
  listeners: new Map(),
  retryMs: 1000,
})

async function start(): Promise<void> {
  if (state.client || state.starting) return state.starting ?? undefined
  state.starting = (async () => {
    const client = createDedicatedClient()
    client.on("notification", (msg) => void deliver(msg.payload))
    client.on("error", (error) => {
      console.error("[production] LISTEN оборвался", error)
      restart()
    })
    client.on("end", () => restart())
    await client.connect()
    await client.query("LISTEN production_chat")
    state.client = client
    state.retryMs = 1000
  })()
  try {
    await state.starting
  } catch (error) {
    console.error("[production] LISTEN не поднялся", error)
    restart()
  } finally {
    state.starting = null
  }
}

function restart() {
  const old = state.client
  state.client = null
  old?.removeAllListeners()
  void old?.end().catch(() => {})
  if (state.listeners.size === 0) return
  const delay = state.retryMs
  state.retryMs = Math.min(state.retryMs * 2, 30_000)
  setTimeout(() => void start(), delay)
}

async function deliver(payload: string | undefined) {
  if (!payload || state.listeners.size === 0) return
  let event: LiveEvent
  try {
    event = JSON.parse(payload) as LiveEvent
  } catch {
    return
  }
  const { rows } = await query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM production_chat_members
      WHERE run_step_id = $1 AND left_at IS NULL
     UNION
     SELECT p.owner_user_id FROM production_run_steps rs
       JOIN production_runs r ON r.id = rs.run_id
       JOIN production_pipelines p ON p.id = r.pipeline_id
      WHERE rs.id = $1`,
    [event.stepId],
  ).catch(() => ({ rows: [] as { userId: string }[] }))
  for (const { userId } of rows) {
    for (const listener of state.listeners.get(userId) ?? []) listener(event)
  }
}

/** Подписать вкладку человека. Возвращает отписку. */
export function subscribe(userId: string, listener: Listener): () => void {
  const set = state.listeners.get(userId) ?? new Set<Listener>()
  set.add(listener)
  state.listeners.set(userId, set)
  void start()
  return () => {
    set.delete(listener)
    if (set.size === 0) state.listeners.delete(userId)
  }
}
