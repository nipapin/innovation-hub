import { query, withTransaction } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { copySingleFile } from "@/lib/storage/copy"
import { readAccountSecret, setAccountCooldown } from "@/lib/social/accounts"
import { VkApiError, vkErrorHint } from "@/lib/social/vk"
import {
  writeEnsureFolderPath,
  writeFileDelete,
  writeRename,
} from "@/lib/storage/write-path"
import { publishVideoToVk, vkCooldownSec } from "./vk-publish"

/**
 * Дренаж очереди публикаций: взять задачу, залить, записать в реестр.
 *
 * Одна задача за тик по умолчанию. Заливка ролика — это минуты и весь исходящий
 * канал; параллелить её значило бы делить полосу между двумя публикациями и
 * получить обе медленнее, а при лимитах площадки — ещё и поймать flood control.
 *
 * ГЛАВНОЕ ПРАВИЛО ФАЙЛА: перевод задачи в `done` и запись в реестр — В ОДНОЙ
 * ТРАНЗАКЦИИ. Окно между «площадка приняла» и «мы записали» даёт дубль
 * публикации, который уже не отменить (docs/SOCIAL_POSTING_PLAN.md §3.2).
 */

/** Сколько живёт аренда задачи. Больше самой долгой заливки, но не бесконечно. */
const LEASE_MINUTES = 30

type ClaimedJobRow = {
  id: string
  projectId: string
  fileId: string | null
  sourceKey: string
  platform: string
  accountId: string
  target: { kind?: string; id?: string; name?: string }
  meta: { title?: string; description?: string; afterPostNote?: string }
  afterPost: "keep" | "delete" | "move"
  afterPostFolder: string
  /** Проект-получатель. Отличается от своего — перенос в соседний проект. */
  afterPostProjectId: string | null
  attempts: number
  maxAttempts: number
}

/**
 * Взять задачу под аренду.
 *
 * `FOR UPDATE SKIP LOCKED` — против наложения тиков крона: длинная заливка
 * переживает интервал, и без блокировки следующий тик взял бы ту же задачу и
 * залил файл второй раз. Просроченная аренда возвращает задачу в работу: иначе
 * упавший на середине процесс оставил бы её висеть в `running` навсегда.
 *
 * Захват НЕ соединяется с каталогом. Соблазн взять размер и имя файла тем же
 * запросом велик, но join по пропавшему файлу не вернул бы ни строки — и
 * задача с удалённым исходником не захватывалась бы НИКОГДА, молча затыкая
 * очередь собой. Поэтому файл читается вторым запросом, и его отсутствие —
 * обычный исход со своим статусом.
 */
async function claimJob(): Promise<ClaimedJobRow | null> {
  const result = await query<ClaimedJobRow>(
    `UPDATE post_jobs
        SET status = 'running',
            attempts = attempts + 1,
            lease_expires_at = NOW() + ($1 || ' minutes')::interval,
            updated_at = NOW()
      WHERE id = (
              SELECT id FROM post_jobs
               WHERE status = 'queued'
                  OR (status = 'running' AND lease_expires_at < NOW())
               ORDER BY created_at ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
     RETURNING id,
               project_id   AS "projectId",
               file_id      AS "fileId",
               source_key   AS "sourceKey",
               platform,
               account_id   AS "accountId",
               target,
               meta,
               after_post        AS "afterPost",
               after_post_folder AS "afterPostFolder",
               attempts,
               max_attempts AS "maxAttempts"`,
    [String(LEASE_MINUTES)],
  )
  return result.rows[0] ?? null
}

/** Проект и файл задачи. `null` — файла в каталоге больше нет. */
async function loadJobSource(job: ClaimedJobRow): Promise<{
  storageOwnerId: string
  ownerId: string
  sizeBytes: number
  fileName: string
} | null> {
  if (!job.fileId) return null
  const result = await query<{
    storageOwnerId: string
    ownerId: string
    sizeBytes: number
    fileName: string
  }>(
    `SELECT COALESCE(p.storage_owner_id, p.user_id) AS "storageOwnerId",
            p.user_id            AS "ownerId",
            f.size_bytes::float8 AS "sizeBytes",
            f.name               AS "fileName"
       FROM projects p
       JOIN project_files f ON f.id = $2
      WHERE p.id = $1
        AND f.project_id = p.id
        AND f.deleted_at IS NULL`,
    [job.projectId, job.fileId],
  )
  return result.rows[0] ?? null
}

/**
 * Задача, у которой файла в каталоге больше нет.
 *
 * Не ошибка: файл могли удалить, пока задача ждала очереди. `skipped`, а не
 * `failed`, — повторять тут нечего, и висеть в отчёте об ошибках этому незачем.
 */
async function skipOrphanJobs(): Promise<number> {
  const result = await query(
    `UPDATE post_jobs
        SET status = 'skipped',
            error = 'source file is gone from the catalog',
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE status = 'queued'
        AND (file_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM project_files f
                             WHERE f.id = post_jobs.file_id
                               AND f.deleted_at IS NULL))`,
  )
  return result.rowCount ?? 0
}

async function finishOk(input: {
  job: ClaimedJobRow
  externalId: string
  externalUrl: string
  note?: string | null
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE post_jobs
          SET status = 'done',
              error = $4,
              external_id = $2,
              external_url = $3,
              published_at = NOW(),
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [input.job.id, input.externalId, input.externalUrl, input.note ?? null],
    )
    // Реестр — в той же транзакции. Разъедься они, и повтор задачи опубликовал
    // бы файл второй раз: очередь считает по реестру, а не по своим статусам.
    await client.query(
      `INSERT INTO post_ledger
         (project_id, source_key, platform, account_id, post_job_id,
          external_id, external_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, source_key, platform, account_id) DO NOTHING`,
      [
        input.job.projectId,
        input.job.sourceKey,
        input.job.platform,
        input.job.accountId,
        input.job.id,
        input.externalId,
        input.externalUrl,
      ],
    )
  })
}

async function finishFailed(input: {
  job: ClaimedJobRow
  message: string
}): Promise<void> {
  const exhausted = input.job.attempts >= input.job.maxAttempts
  await query(
    `UPDATE post_jobs
        SET status = $2,
            error = $3,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [input.job.id, exhausted ? "failed" : "queued", input.message.slice(0, 1000)],
  )
}

/**
 * Что делать с исходником после публикации.
 *
 * Три простых действия, и намеренно только три: сайт исполняет ноду публикации,
 * а не весь граф (см. `routes.ts`). Нода `copyFile` после постера — работа
 * машины; здесь же — операции каталога, которые машина увидит обычной дельтой.
 *
 * Перенос делаем через `writeRename`, а не прямой записью в таблицу: он ведёт
 * журнал изменений, и без него перенос остался бы для машины невидимым.
 */
async function applyAfterPost(
  job: ClaimedJobRow,
  source: { storageOwnerId: string; ownerId: string },
): Promise<void> {
  if (job.afterPost === "keep" || !job.fileId) return

  if (job.afterPost === "delete") {
    await writeFileDelete({
      storageOwnerId: source.storageOwnerId,
      projectId: job.projectId,
      fileId: job.fileId,
      deletedBy: source.ownerId,
    })
    return
  }

  const folder = job.afterPostFolder.trim()
  const destProjectId = job.afterPostProjectId ?? job.projectId

  /**
   * Свой проект — обычное переименование: ключ в R2 при этом не меняется, и
   * реестр опубликованного продолжает узнавать файл после переезда.
   */
  if (destProjectId === job.projectId) {
    // Пустая папка сюда дойти не должна (обход превращает такое в «оставить»),
    // но перенос в корень проекта по недосмотру — не то, что имел в виду автор.
    if (!folder) return

    // Папку создаём, если её ещё нет: человек указал её в графе, а не завёл
    // руками, и «перенести некуда» здесь было бы отказом на ровном месте.
    await writeEnsureFolderPath({
      storageOwnerId: source.storageOwnerId,
      projectId: job.projectId,
      folderPath: folder,
    })
    await writeRename({
      storageOwnerId: source.storageOwnerId,
      projectId: job.projectId,
      fileId: job.fileId,
      folderPath: folder,
    })
    return
  }

  /**
   * Соседний проект — это уже не переименование: у каждого проекта свой
   * префикс ключей в R2 (`projects/{storageOwner}/{projectId}/…`), и строку
   * каталога туда просто так не переставить. Поэтому копия объекта плюс
   * удаление исходника — тем же путём, каким копирует между проектами кабинет.
   *
   * Порядок обязателен: сначала копия, потом удаление. Обратный дал бы файл,
   * удалённый до того, как копия удалась.
   */
  const dest = await query<{ storageOwnerId: string }>(
    `SELECT COALESCE(storage_owner_id, user_id) AS "storageOwnerId"
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [destProjectId],
  )
  const destStorageOwnerId = dest.rows[0]?.storageOwnerId
  // Проект успели удалить, пока задача ждала очереди. Файл остаётся на месте:
  // это лучше, чем деть его неизвестно куда.
  if (!destStorageOwnerId) return

  const row = await query<ProjectFileRecord & {
    etag: string | null
    contentHash: string | null
    originMtime: number | null
  }>(
    `SELECT id,
            project_id   AS "projectId",
            folder_path  AS "folderPath",
            name,
            is_folder    AS "isFolder",
            s3_key       AS "s3Key",
            size_bytes::float8 AS "sizeBytes",
            content_type AS "contentType",
            etag,
            content_hash AS "contentHash",
            origin_mtime AS "originMtime"
       FROM project_files
      WHERE id = $1 AND deleted_at IS NULL`,
    [job.fileId],
  )
  const file = row.rows[0]
  if (!file) return

  await copySingleFile({
    sourceProjectId: job.projectId,
    destProjectId,
    destStorageOwnerId,
    destFolderPath: folder,
    source: file,
    actor: { userId: source.ownerId, isUploader: false },
  })
  await writeFileDelete({
    storageOwnerId: source.storageOwnerId,
    projectId: job.projectId,
    fileId: job.fileId,
    deletedBy: source.ownerId,
  })
}

export type DrainResult = {
  picked: number
  published: number
  failed: number
  skipped: number
  /** Ссылка на последнюю публикацию — её показывает пульт. */
  lastUrl: string | null
  lastError: string | null
}

export async function drainPostQueue(limit = 1): Promise<DrainResult> {
  const result: DrainResult = {
    picked: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    lastUrl: null,
    lastError: null,
  }

  result.skipped = await skipOrphanJobs()

  for (let i = 0; i < limit; i += 1) {
    const job = await claimJob()
    if (!job) break
    result.picked += 1

    // Файл мог исчезнуть, пока задача ждала очереди. Это не ошибка публикации,
    // и повторять тут нечего — снимаем задачу со своим статусом.
    const source = await loadJobSource(job)
    if (!source) {
      await query(
        `UPDATE post_jobs
            SET status = 'skipped',
                error = 'source file is gone from the catalog',
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [job.id],
      )
      result.skipped += 1
      continue
    }

    try {
      if (job.platform !== "vk") {
        // Задача на площадку без адаптера в очередь попасть не должна (обход
        // такие не ставит), но если попала — не молчим.
        throw new Error(`No publisher for platform "${job.platform}".`)
      }

      const secret = await readAccountSecret(job.accountId)
      if (!secret?.accessToken) {
        throw new Error("The account has no live token.")
      }

      const published = await publishVideoToVk({
        accessToken: secret.accessToken,
        sourceKey: job.sourceKey,
        sizeBytes: source.sizeBytes,
        fileName: source.fileName,
        title: job.meta.title ?? source.fileName,
        description: job.meta.description ?? "",
        groupId: job.target.kind === "group" ? job.target.id : undefined,
      })

      await finishOk({
        job,
        externalId: `${published.ownerId}_${published.videoId}`,
        externalUrl: published.permalink,
        // Замечание по переносу (например, «проект не найден») кладём рядом с
        // успехом. Публикация состоялась, и статус это говорит; замечание
        // объясняет, почему файл остался на месте.
        note: job.meta.afterPostNote ?? null,
      })
      // Площадка снова принимает — пауза, если была, больше не нужна.
      await setAccountCooldown({
        accountId: job.accountId,
        until: null,
        reason: null,
      })
      result.published += 1
      result.lastUrl = published.permalink

      /**
       * Судьба исходника — последним шагом и ВНЕ транзакции публикации.
       *
       * Публикация уже случилась и необратима; упади уборка — задача всё равно
       * `done`, и файл просто останется лежать. Обратный порядок дал бы худшее:
       * файл унесён, а публикации нет.
       */
      await applyAfterPost(job, source).catch((error) => {
        console.error("[posting] after-post action failed", job.id, error)
      })
    } catch (error) {
      const message =
        error instanceof VkApiError
          ? `${error.message}${vkErrorHint(error.code) ? ` — ${vkErrorHint(error.code)}` : ""}`
          : error instanceof Error
            ? error.message
            : String(error)

      await finishFailed({ job, message })
      result.failed += 1
      result.lastError = message

      /**
       * Лимит, капча или флуд — это ограничение АККАУНТА, а не файла. Пауза
       * ставится аккаунту целиком, иначе очередь продолжит долбить лимит
       * следующим файлом и доведёт дело до бана токена.
       */
      if (error instanceof VkApiError) {
        const cooldown = vkCooldownSec(error.code)
        if (cooldown > 0) {
          await setAccountCooldown({
            accountId: job.accountId,
            until: new Date(Date.now() + cooldown * 1000),
            reason: message,
          })
        }
      }
    }
  }

  return result
}
