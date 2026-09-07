import { query } from "@/lib/db"
import type { SocialPlatform } from "@/lib/social/types"

/**
 * Запросы автопостинга: кого обходим, что уже опубликовано, что в очереди.
 *
 * Отдельно от `lib/pipeline/repository.ts`, хотя условия отбора проектов те же:
 * это разные процессы с разными таблицами и разной судьбой. Общий модуль
 * пришлось бы параметризовать «для обработки или для постинга», и первая же
 * правка одного сломала бы второе.
 */

export type PostingProject = {
  projectId: string
  ownerId: string
  storageOwnerId: string
  name: string
}

/**
 * Проекты, которые сайт обходит на постинг.
 *
 * Условия те же, что у обработки (`listWatchedProjects`), и это осознанно:
 * «автоматика по этому человеку включена» и «проект не на паузе» — решения о
 * проекте целиком, а не про конкретный вид работы. Заводить второй набор
 * тумблеров значило бы, что выключенный проект всё равно что-то делает.
 */
export async function listPostingProjects(): Promise<PostingProject[]> {
  const result = await query<PostingProject>(
    `SELECT p.id AS "projectId",
            p.user_id AS "ownerId",
            COALESCE(p.storage_owner_id, p.user_id) AS "storageOwnerId",
            p.name
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE u.is_active
        AND COALESCE(u.automation_enabled, FALSE)
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_paused, FALSE) = FALSE
        AND COALESCE(p.is_archived, FALSE) = FALSE
        AND COALESCE(p.is_template, FALSE) = FALSE
      ORDER BY p.created_at ASC`,
  )
  return result.rows
}

export type PostCandidate = {
  fileId: string
  name: string
  s3Key: string
  sizeBytes: number
  /** Время файла для порядка `by Time`. */
  sortTime: number
}

/**
 * Файлы папки-источника.
 *
 * `origin_mtime` главнее `created_at`: у файла, приехавшего с машины, время
 * создания строки в каталоге — это момент синхронизации, а не момент, когда
 * человек его сделал. Порядок «by Time» в программе считается по mtime, и
 * расходиться с ней нельзя — иначе очередь публикаций на сайте и в программе
 * выдаёт разные файлы.
 */
export async function listFolderCandidates(input: {
  projectId: string
  folderPath: string
}): Promise<PostCandidate[]> {
  const result = await query<{
    fileId: string
    name: string
    s3Key: string
    sizeBytes: number
    sortTime: string
  }>(
    `SELECT id AS "fileId",
            name,
            s3_key AS "s3Key",
            size_bytes::float8 AS "sizeBytes",
            EXTRACT(EPOCH FROM COALESCE(
              to_timestamp(origin_mtime), created_at
            )) AS "sortTime"
       FROM project_files
      WHERE project_id = $1
        AND folder_path = $2
        AND is_folder = FALSE
        AND deleted_at IS NULL
        AND s3_key IS NOT NULL`,
    [input.projectId, input.folderPath],
  )
  return result.rows.map((row) => ({
    fileId: row.fileId,
    name: row.name,
    s3Key: row.s3Key,
    sizeBytes: row.sizeBytes,
    sortTime: Number(row.sortTime),
  }))
}

/**
 * Ключи, уже уехавшие этим аккаунтом на эту площадку.
 *
 * Реестр — единственный источник правды по «опубликовано». Смотреть на статусы
 * задач нельзя: задача может быть удалена или переигранная, а публикация в
 * VK от этого не исчезнет.
 */
export async function listPostedKeys(input: {
  projectId: string
  platform: SocialPlatform
  accountId: string
}): Promise<Set<string>> {
  const result = await query<{ sourceKey: string }>(
    `SELECT source_key AS "sourceKey"
       FROM post_ledger
      WHERE project_id = $1 AND platform = $2 AND account_id = $3`,
    [input.projectId, input.platform, input.accountId],
  )
  return new Set(result.rows.map((row) => row.sourceKey))
}

/** Ключи, по которым уже есть ЖИВАЯ задача: второй раз ставить не надо. */
export async function listQueuedKeys(input: {
  projectId: string
  platform: SocialPlatform
  accountId: string
}): Promise<Set<string>> {
  const result = await query<{ sourceKey: string }>(
    `SELECT source_key AS "sourceKey"
       FROM post_jobs
      WHERE project_id = $1 AND platform = $2 AND account_id = $3
        AND status IN ('queued', 'running')`,
    [input.projectId, input.platform, input.accountId],
  )
  return new Set(result.rows.map((row) => row.sourceKey))
}

/**
 * Когда этим аккаунтом последний раз публиковали в этом проекте.
 *
 * Разрез «проект + площадка + аккаунт» повторяет программу: там лог лежит в
 * папке проекта (`options/_post/*.jsonl`), то есть темп считается внутри
 * проекта. Один аккаунт в двух проектах ведёт две независимые ленты — так это
 * работает у людей сейчас, и менять поведение переносом нельзя.
 */
export async function lastPublishedAt(input: {
  projectId: string
  platform: SocialPlatform
  accountId: string
}): Promise<number> {
  const result = await query<{ ts: string | null }>(
    `SELECT EXTRACT(EPOCH FROM MAX(posted_at)) AS ts
       FROM post_ledger
      WHERE project_id = $1 AND platform = $2 AND account_id = $3`,
    [input.projectId, input.platform, input.accountId],
  )
  const ts = result.rows[0]?.ts
  return ts ? Number(ts) : 0
}

/** Есть ли живая задача по этому аккаунту в этом проекте. */
export async function hasJobInFlight(input: {
  projectId: string
  platform: SocialPlatform
  accountId: string
}): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM post_jobs
      WHERE project_id = $1 AND platform = $2 AND account_id = $3
        AND status IN ('queued', 'running')`,
    [input.projectId, input.platform, input.accountId],
  )
  return Number(result.rows[0]?.count ?? 0) > 0
}

// ── Состояние обхода ─────────────────────────────────────────────────────────

export type PostScanState = {
  isRunning: boolean
  startedAt: string | null
  scanIntervalMin: number
  scannedAt: string | null
  lastCreated: number
  lastError: string | null
}

export async function readPostScanState(): Promise<PostScanState> {
  const result = await query<{
    isRunning: boolean
    startedAt: Date | null
    scanIntervalMin: number
    scannedAt: Date | null
    lastCreated: number
    lastError: string | null
  }>(
    `SELECT is_running        AS "isRunning",
            started_at        AS "startedAt",
            scan_interval_min AS "scanIntervalMin",
            scanned_at        AS "scannedAt",
            last_created      AS "lastCreated",
            last_error        AS "lastError"
       FROM post_scan_state WHERE id = 'singleton'`,
  )
  const row = result.rows[0]
  return {
    isRunning: row?.isRunning ?? false,
    startedAt: row?.startedAt?.toISOString() ?? null,
    scanIntervalMin: row?.scanIntervalMin ?? 0,
    scannedAt: row?.scannedAt?.toISOString() ?? null,
    lastCreated: row?.lastCreated ?? 0,
    lastError: row?.lastError ?? null,
  }
}

export async function setPostRunning(input: {
  isRunning: boolean
  actorId: string | null
}): Promise<void> {
  await query(
    `UPDATE post_scan_state
        SET is_running = $1,
            started_at = CASE WHEN $1 THEN NOW() ELSE started_at END,
            started_by = CASE WHEN $1 THEN $2 ELSE started_by END,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.isRunning, input.actorId],
  )
}

export async function setPostScanInterval(minutes: number): Promise<void> {
  await query(
    `UPDATE post_scan_state
        SET scan_interval_min = $1, updated_at = NOW()
      WHERE id = 'singleton'`,
    [minutes],
  )
}

export async function recordScanRun(input: {
  created: number
  error: string | null
}): Promise<void> {
  await query(
    `UPDATE post_scan_state
        SET scanned_at = NOW(),
            last_created = $1,
            last_error = $2,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.created, input.error],
  )
}

/**
 * Проект того же человека по имени — для переноса «на уровень выше».
 *
 * Только СВОЙ: чужой проект с таким же именем не должен становиться целью
 * переноса, иначе граф одного человека дотянулся бы до файлов другого.
 * Удалённые исключены; архивные оставлены намеренно — «сложить готовое в архив»
 * законное намерение.
 *
 * Имя сравниваем без учёта регистра и краевых пробелов: человек печатает его
 * в графе руками, и «Клиент А» против «клиент А» не должно быть двумя разными
 * проектами.
 */
export async function findSiblingProjectByName(input: {
  ownerId: string
  name: string
}): Promise<{ projectId: string; storageOwnerId: string } | null> {
  const result = await query<{ projectId: string; storageOwnerId: string }>(
    `SELECT id AS "projectId",
            COALESCE(storage_owner_id, user_id) AS "storageOwnerId"
       FROM projects
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND lower(btrim(name)) = lower(btrim($2))
      ORDER BY created_at ASC
      LIMIT 1`,
    [input.ownerId, input.name],
  )
  return result.rows[0] ?? null
}
