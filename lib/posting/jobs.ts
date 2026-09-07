import { query } from "@/lib/db"
import type { SocialPlatform } from "@/lib/social/types"

/**
 * Очередь публикаций для админки: счётчики и список.
 *
 * Отдельно от `repository.ts`, где живут запросы самого движка: там «что взять
 * в работу», здесь «что показать человеку». Смешивать их значило бы, что
 * правка колонки в интерфейсе трогает файл, от которого зависит публикация.
 */

export type PostJobStatus = "queued" | "running" | "done" | "failed" | "skipped"

export type PostJobRow = {
  id: string
  projectId: string
  projectName: string
  ownerEmail: string
  fileName: string
  platform: SocialPlatform
  accountLabel: string | null
  target: { kind?: string; name?: string }
  status: PostJobStatus
  attempts: number
  maxAttempts: number
  error: string | null
  externalUrl: string | null
  publishedAt: string | null
  createdAt: string
}

const JOB_FIELDS = `
  j.id,
  j.project_id AS "projectId",
  p.name       AS "projectName",
  u.email      AS "ownerEmail",
  -- Имя берём из каталога, а при удалённом файле — хвост ключа: строка очереди
  -- без имени файла нечитаема, а «файла больше нет» и так видно по статусу.
  COALESCE(f.name, regexp_replace(j.source_key, '^.*/', '')) AS "fileName",
  j.platform,
  a.label      AS "accountLabel",
  j.target,
  j.status,
  j.attempts,
  j.max_attempts AS "maxAttempts",
  j.error,
  j.external_url AS "externalUrl",
  j.published_at AS "publishedAt",
  j.created_at   AS "createdAt"
`

const JOB_JOINS = `
  JOIN projects p ON p.id = j.project_id
  JOIN users u ON u.id = p.user_id
  LEFT JOIN project_files f ON f.id = j.file_id
  LEFT JOIN social_accounts a ON a.id = j.account_id
`

export async function countPostJobsByStatus(): Promise<
  Record<PostJobStatus, number>
> {
  const result = await query<{ status: PostJobStatus; count: string }>(
    `SELECT status, COUNT(*) AS count FROM post_jobs GROUP BY status`,
  )
  const counts: Record<PostJobStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  }
  for (const row of result.rows) counts[row.status] = Number(row.count)
  return counts
}

/**
 * Список задач.
 *
 * Живые сверху, дальше по времени создания: в очереди смотрят «что сейчас» и
 * «что не получилось», а завершённое интересно последним.
 */
export async function listPostJobs(input?: {
  status?: PostJobStatus
  limit?: number
}): Promise<PostJobRow[]> {
  const limit = Math.min(500, Math.max(1, input?.limit ?? 100))
  const result = await query<
    Omit<PostJobRow, "publishedAt" | "createdAt"> & {
      publishedAt: Date | null
      createdAt: Date
    }
  >(
    `SELECT ${JOB_FIELDS}
       FROM post_jobs j
       ${JOB_JOINS}
      WHERE ($1::text IS NULL OR j.status = $1)
      ORDER BY (j.status IN ('running', 'queued')) DESC,
               j.created_at DESC
      LIMIT $2`,
    [input?.status ?? null, limit],
  )
  return result.rows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
}

/**
 * Вернуть упавшую задачу в очередь.
 *
 * Счётчик попыток обнуляем: человек посмотрел на причину и решил, что она
 * устранена, — держать при этом старые попытки значило бы уронить задачу на
 * первой же новой ошибке.
 *
 * Уже опубликованное не переигрываем: `done` защищён реестром, и повтор
 * означал бы второй пост.
 */
export async function retryPostJob(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE post_jobs
        SET status = 'queued',
            attempts = 0,
            error = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('failed', 'skipped')`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/** Снять задачу из очереди. Опубликованную не трогаем — отменять уже нечего. */
export async function cancelPostJob(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE post_jobs
        SET status = 'skipped',
            error = 'cancelled by administrator',
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'running')`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}
