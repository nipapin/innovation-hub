import { query } from "@/lib/db"
import { listWatchedProjects } from "@/lib/pipeline/repository"
import {
  isHeldBack,
  materializeCandidates,
  type InEntry,
  type SkipReason,
} from "@/lib/pipeline/scan"
import { projectPrefix } from "@/lib/storage/keys"

/**
 * «Обработать заново» — одна задача по одному элементу папки IN, руками.
 *
 * Нужен из-за правила, на котором держатся обе линии сборки: элемент, по
 * которому задача уже была, не берётся больше никогда — ни событием (второго
 * события по лежащему файлу не будет), ни обходом (он смотрит на любой статус,
 * включая `done`). Правило верное: без него обход переоткрывал бы обработанное
 * каждые четверть часа. Но оно не оставляло способа сказать «прогони этот файл
 * ещё раз», кроме перезаливки — а её нечем сделать, если файл нужен ровно тот
 * же самый.
 *
 * Раньше выход был один и админский: найти строку задачи в очереди и удалить
 * её, чтобы обход счёл элемент новым. Зона «Завершено» показывает последние
 * пятьдесят задач, и всё, что старше, оттуда просто уезжает — то есть у файла
 * недельной давности этого выхода уже не было.
 *
 * Собирается тем же кодом, что и обход: `materializeCandidates` — общая вторая
 * половина сборки. Разъедься они, и «заново» означало бы не то же самое, что
 * «в первый раз».
 */

export type ReprocessResult =
  | { ok: true }
  | {
      ok: false
      /**
       * `not-watched` — проект на паузе, в архиве или у владельца снят гейт;
       * `not-in-in` — элемент не лежит верхним уровнем в IN, а конвейер работает
       * только с ними; `no-source` — строки в каталоге больше нет;
       * `live-task` — задача по элементу уже идёт, вторая не нужна.
       * Остальное — обычные причины пропуска сборки.
       */
      reason: "not-watched" | "not-in-in" | "no-source" | "live-task" | SkipReason
    }

type SourceRow = {
  name: string
  folderPath: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: string
  contentHash: string | null
}

export async function reprocessItem(input: {
  projectId: string
  fileId: string
}): Promise<ReprocessResult> {
  const project = (await listWatchedProjects()).find(
    (item) => item.projectId === input.projectId,
  )
  if (!project) return { ok: false, reason: "not-watched" }

  const found = await query<SourceRow>(
    `SELECT name,
            folder_path AS "folderPath",
            is_folder   AS "isFolder",
            s3_key      AS "s3Key",
            COALESCE(size_bytes, 0)::text AS "sizeBytes",
            content_hash AS "contentHash"
       FROM project_files
      WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [input.fileId, input.projectId],
  )
  const row = found.rows[0]
  if (!row) return { ok: false, reason: "no-source" }
  if (row.folderPath !== "IN") return { ok: false, reason: "not-in-in" }

  // Идентичность элемента считаем ровно так же, как обе линии сборки: у файла
  // это физический ключ, у папки — собранный, потому что у строки-папки s3_key
  // нет по схеме. Разойдись это здесь — задача уехала бы с чужим source_key.
  const entry: InEntry | null = row.isFolder
    ? {
        name: row.name,
        key: `${projectPrefix(project.storageOwnerId, project.projectId)}IN/${row.name}`,
        isFolder: true,
      }
    : row.s3Key
      ? { name: row.name, key: row.s3Key, isFolder: false }
      : null
  if (!entry) return { ok: false, reason: "no-source" }

  // И папка, и файл (см. isHeldBack): дефис в имени — явный отказ брать в работу.
  if (isHeldBack(entry.name)) {
    return { ok: false, reason: "folder-not-ready" }
  }

  // Живая задача — не повод заводить вторую: она и так сейчас обрабатывается.
  // Уникальный индекс отказал бы и сам, но молча, а человеку нужно объяснение.
  const live = await query<{ id: string }>(
    `SELECT id FROM tasks
      WHERE project_id = $1
        AND source_key = $2
        AND status IN ('queued', 'claimed', 'running')
      LIMIT 1`,
    [input.projectId, entry.key],
  )
  if (live.rows[0]) return { ok: false, reason: "live-task" }

  const result = await materializeCandidates({
    candidates: [
      {
        projectId: project.projectId,
        entry,
        fileId: row.isFolder ? null : input.fileId,
        sizeBytes: Number(row.sizeBytes),
        contentHash: row.contentHash,
        // Актора нет: это не событие заливки. Цепочка contact доедет до
        // заливщика из каталога — ровно как при обходе.
        putActorUserId: null,
        readyActorUserId: null,
      },
    ],
    watchedById: new Map([[project.projectId, project]]),
    collectedAt: new Date().toISOString(),
  })

  if (result.created > 0) return { ok: true }
  return { ok: false, reason: result.skipped[0]?.reason ?? "no-match" }
}
