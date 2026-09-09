import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, queryVia } from "@/lib/db"

export type StorageJobKind =
  | "copy"
  | "move"
  | "purge"
  | "recatalog"
  /** Выдача тестового периода: копии шаблонов + включение обработки. */
  | "trial-provision"
export type StorageJobState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled"

export type StorageJobRecord = {
  id: string
  userId: string
  projectId: string | null
  kind: StorageJobKind
  state: StorageJobState
  total: number
  done: number
  error: string | null
  payload: Record<string, unknown>
  eventId: string | null
  createdAt: string
  updatedAt: string
}

/** Работа в `running` дольше этого срока считается зависшей, а не идущей. */
const STALE_RUNNING_MS = 30 * 60 * 1000

const JOB_FIELDS = `
  id,
  user_id AS "userId",
  project_id AS "projectId",
  kind,
  state,
  total,
  done,
  error,
  payload,
  event_id AS "eventId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

function mapJob(row: {
  id: string
  userId: string
  projectId: string | null
  kind: StorageJobKind
  state: StorageJobState
  total: number
  done: number
  error: string | null
  payload: Record<string, unknown>
  eventId: string | null
  createdAt: Date
  updatedAt: Date
}): StorageJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    kind: row.kind,
    state: row.state,
    total: row.total,
    done: row.done,
    error: row.error,
    payload: row.payload ?? {},
    eventId: row.eventId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

export async function getJob(id: string): Promise<StorageJobRecord | null> {
  const result = await query<{
    id: string
    userId: string
    projectId: string
    kind: StorageJobKind
    state: StorageJobState
    total: number
    done: number
    error: string | null
    payload: Record<string, unknown>
    eventId: string | null
    createdAt: Date
    updatedAt: Date
  }>(`SELECT ${JOB_FIELDS} FROM storage_jobs WHERE id = $1`, [id])
  const row = result.rows[0]
  return row ? mapJob(row) : null
}

/** Строка `storage_jobs` как её отдаёт `JOB_FIELDS`. */
type JobRow = Parameters<typeof mapJob>[0]

export async function findJobByEventId(
  eventId: string,
  client?: PoolClient,
): Promise<StorageJobRecord | null> {
  const result = await queryVia(client)<JobRow>(
    `SELECT ${JOB_FIELDS} FROM storage_jobs WHERE event_id = $1`,
    [eventId],
  )
  const row = result.rows[0]
  return row ? mapJob(row) : null
}

export async function createJob(
  input: {
    userId: string
    projectId: string | null
    kind: StorageJobKind
    total?: number
    payload?: Record<string, unknown>
    eventId?: string | null
  },
  /**
   * Транзакция вызывающего: работа обязана лечь вместе с тем, ради чего её
   * ставят. Отдельной транзакцией она переживает откат соседней записи и
   * остаётся в очереди ссылаться на то, чего нет.
   */
  client?: PoolClient,
): Promise<StorageJobRecord> {
  if (input.eventId) {
    const existing = await findJobByEventId(input.eventId, client)
    if (existing) return existing
  }

  const id = randomUUID()
  const result = await queryVia(client)<JobRow>(
    `INSERT INTO storage_jobs (
        id, user_id, project_id, kind, state, total, done, payload, event_id
     )
     VALUES ($1, $2, $3, $4, 'queued', $5, 0, $6::jsonb, $7)
     RETURNING ${JOB_FIELDS}`,
    [
      id,
      input.userId,
      input.projectId,
      input.kind,
      input.total ?? 0,
      JSON.stringify(input.payload ?? {}),
      input.eventId ?? null,
    ],
  )
  return mapJob(result.rows[0]!)
}

export async function claimJob(id: string): Promise<StorageJobRecord | null> {
  const result = await query<{
    id: string
    userId: string
    projectId: string
    kind: StorageJobKind
    state: StorageJobState
    total: number
    done: number
    error: string | null
    payload: Record<string, unknown>
    eventId: string | null
    createdAt: Date
    updatedAt: Date
  }>(
    `UPDATE storage_jobs
        SET state = 'running', updated_at = NOW()
      WHERE id = $1 AND state = 'queued'
      RETURNING ${JOB_FIELDS}`,
    [id],
  )
  const row = result.rows[0]
  return row ? mapJob(row) : null
}

/**
 * Вернуть зависшую работу в очередь — поимённо и только по просьбе.
 *
 * Молчаливый автоповтор упёрся бы в ту же причину и крутил бы её до
 * бесконечности, поэтому здесь нет расписания: за эту функцию дёргают «Повторить»
 * в кабинете и «Дожать» в админке. Ошибку стираем — она относилась к прошлой
 * попытке, и оставить её значило бы показывать провал рядом с идущей работой.
 *
 * Берём не только упавшую. Работа, вставшая в `running` (процесс перезапустили
 * посреди копирования), иначе не сдвигается ничем, кроме общего обхода, а тот
 * ходит только из cron: до его прихода повтор упирался бы в `claimJob`, который
 * берёт лишь `queued`, и не делал ничего — со стороны это выглядит как молчание
 * кнопки. Порог «зависла» тот же, что у обхода, и это не совпадение: работа,
 * двигавшаяся минуту назад, идёт, и второй прогон по ней повторил бы уже
 * сделанное. `done` не обнуляем — прогон продолжится с места остановки.
 */
export async function requeueStuckJob(
  id: string,
): Promise<StorageJobRecord | null> {
  const result = await query<JobRow>(
    `UPDATE storage_jobs
        SET state = 'queued', error = NULL, updated_at = NOW()
      WHERE id = $1
        AND (
          state IN ('failed', 'cancelled')
          OR (
            state = 'running'
            AND updated_at < NOW() - ($2::text || ' milliseconds')::interval
          )
        )
      RETURNING ${JOB_FIELDS}`,
    [id, String(STALE_RUNNING_MS)],
  )
  const row = result.rows[0]
  return row ? mapJob(row) : null
}

/**
 * Работа идёт прямо сейчас — трогать её нельзя.
 *
 * Отдельный вопрос, а не отрицание `requeueStuckJob`: на него отвечают до
 * записи, когда решают, можно ли сбросить выдачу, за которой ещё копируются
 * проекты.
 */
export function isJobInFlight(job: StorageJobRecord): boolean {
  if (job.state === "queued") return true
  if (job.state !== "running") return false
  return Date.now() - new Date(job.updatedAt).getTime() < STALE_RUNNING_MS
}

/**
 * Отменить незаконченную работу.
 *
 * Только из `queued`/`running`: у законченной отмена ничего не значит, а
 * переписать её состояние значило бы соврать журналу. Причину пишем в `error` —
 * «отменена» без «кем и почему» через месяц не объясняет ничего.
 */
export async function cancelJob(id: string, reason: string): Promise<void> {
  await query(
    `UPDATE storage_jobs
        SET state = 'cancelled', error = $2, updated_at = NOW()
      WHERE id = $1 AND state IN ('queued', 'running')`,
    [id, reason],
  )
}

export async function setJobProgress(
  id: string,
  done: number,
  total?: number,
  payloadPatch?: Record<string, unknown>,
): Promise<void> {
  if (payloadPatch) {
    await query(
      `UPDATE storage_jobs
          SET done = $2,
              total = COALESCE($3, total),
              payload = payload || $4::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [id, done, total ?? null, JSON.stringify(payloadPatch)],
    )
    return
  }
  await query(
    `UPDATE storage_jobs
        SET done = $2,
            total = COALESCE($3, total),
            updated_at = NOW()
      WHERE id = $1`,
    [id, done, total ?? null],
  )
}

export async function finishJob(
  id: string,
  outcome: {
    state: "done" | "failed" | "cancelled"
    error?: string | null
    payload?: Record<string, unknown>
    done?: number
  },
): Promise<void> {
  await query(
    `UPDATE storage_jobs
        SET state = $2,
            error = $3,
            done = COALESCE($4, done),
            payload = CASE
              WHEN $5::jsonb IS NULL THEN payload
              ELSE payload || $5::jsonb
            END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      id,
      outcome.state,
      outcome.error ?? null,
      outcome.done ?? null,
      outcome.payload ? JSON.stringify(outcome.payload) : null,
    ],
  )
}

export async function listQueuedJobs(limit = 20): Promise<StorageJobRecord[]> {
  const result = await query<{
    id: string
    userId: string
    projectId: string
    kind: StorageJobKind
    state: StorageJobState
    total: number
    done: number
    error: string | null
    payload: Record<string, unknown>
    eventId: string | null
    createdAt: Date
    updatedAt: Date
  }>(
    `SELECT ${JOB_FIELDS}
       FROM storage_jobs
      WHERE state = 'queued'
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit],
  )
  return result.rows.map(mapJob)
}

export async function requeueStaleRunningJobs(): Promise<number> {
  const result = await query(
    `UPDATE storage_jobs
        SET state = 'queued', updated_at = NOW()
      WHERE state = 'running'
        AND updated_at < NOW() - ($1::text || ' milliseconds')::interval`,
    [String(STALE_RUNNING_MS)],
  )
  return result.rowCount ?? 0
}

export function serializeJob(job: StorageJobRecord) {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    total: job.total,
    done: job.done,
    error: job.error,
    projectId: job.projectId,
    payload: job.payload,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}
