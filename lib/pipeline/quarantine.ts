import { query } from "@/lib/db"
import { StorageWriteError } from "@/lib/storage/errors"
import { writeEnsureFolderPath, writeRename } from "@/lib/storage/write-path"

/**
 * Папка ошибок проекта: куда уезжает исходник, обработка которого упала.
 *
 * Перенесено из ручной практики на десктопе, и не ради красоты. Пока файл лежит
 * в IN, он для конвейера мёртв: обход берёт только элементы, по которым задачи не
 * было вообще (lib/pipeline/sweep.ts), а задача была — упавшая. Событийная линия
 * его тоже не подберёт, второго события по нему не будет. Файл невидим, и понять
 * это можно только запросом к базе.
 *
 * Перенос чинит ровно это: файла в IN больше нет, значит его отсутствие в
 * очереди перестаёт быть загадкой, а в дереве проекта видно, что с ним случилось
 * и когда. Обратная дорога — перенос назад в IN: это `move`-событие с ключом
 * внутри IN, и событийная линия заводит новую задачу за секунды (упавшая старая
 * не мешает: уникальный индекс держится только на живых статусах).
 *
 * Папка ОДНА на проект, и её имя несёт метку последней ошибки. Не по папке на
 * дату: разбор проблемных файлов — работа, которую делают пачкой и не каждый
 * день, и десяток папок в корне мешает больше, чем помогает точная дата у
 * каждого файла. Случилась новая ошибка — папка переименовывается на метку
 * этой ошибки, а лежащие в ней файлы остаются на месте.
 *
 * Имя — общий канон с десктоп-клиентом (fs.manager.tauri, `move_to_errors`):
 * `errors (MM.DD-HH.mm)`. До унификации сайт создавал `Errors (YYYY-MM-DD)` —
 * такие папки опознаются как легаси и при первой же ошибке переименовываются
 * в канон, вторую рядом не заводим.
 */

/** Канон: `errors (09.17-16.40)`. */
const ERRORS_FOLDER_RE = /^errors \(\d{2}\.\d{2}-\d{2}\.\d{2}\)$/i

/** Легаси-формат сайта до унификации с десктопом: `Errors (2026-09-02)`. */
const ERRORS_FOLDER_LEGACY_RE = /^Errors \(\d{4}-\d{2}-\d{2}\)$/i

/**
 * Метка в имени — локальная для сервера, а не UTC.
 *
 * Имя папки читает человек, и «вчера» у него своё. Формат тот же, что пишет
 * десктоп: месяц.день-час.минута, — чтобы обе системы, переименовывая одну и
 * ту же папку, давали ей одно и то же имя.
 */
export function errorsFolderName(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  const date = `${p(at.getMonth() + 1)}.${p(at.getDate())}`
  const time = `${p(at.getHours())}.${p(at.getMinutes())}`
  return `errors (${date}-${time})`
}

export function isErrorsFolderName(name: string): boolean {
  return ERRORS_FOLDER_RE.test(name) || ERRORS_FOLDER_LEGACY_RE.test(name)
}

type SourceRow = {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
}

type TaskRow = {
  projectId: string
  storageOwnerId: string
  sourceFileId: string | null
  sourceKey: string
  isFolder: boolean
  quarantinedAt: Date | null
}

async function readTask(taskId: string): Promise<TaskRow | null> {
  const result = await query<TaskRow>(
    `SELECT t.project_id       AS "projectId",
            p.storage_owner_id AS "storageOwnerId",
            t.source_file_id   AS "sourceFileId",
            t.source_key       AS "sourceKey",
            COALESCE(
              (t.payload -> 'description' ->> 'isFolder')::boolean, FALSE
            ) AS "isFolder",
            t.quarantined_at   AS "quarantinedAt"
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1`,
    [taskId],
  )
  return result.rows[0] ?? null
}

/**
 * Строка каталога, по которой создана задача.
 *
 * Два пути, потому что `source_file_id` есть только у файла: у папки сборка
 * кладёт NULL (lib/pipeline/scan.ts), и единственная зацепка — имя, которое
 * лежит хвостом в `source_key` после `IN/`. Ищем по имени в любом месте проекта,
 * а не только в IN: после карантина строка уже переехала, и возврат должен
 * находить её там, куда мы её унесли.
 */
async function findSourceRow(task: TaskRow): Promise<SourceRow | null> {
  if (task.sourceFileId) {
    const byId = await query<SourceRow>(
      `SELECT id, name, folder_path AS "folderPath", is_folder AS "isFolder"
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [task.sourceFileId, task.projectId],
    )
    if (byId.rows[0]) return byId.rows[0]
  }

  // Только для папки. У файла `source_file_id` есть всегда, а если он обнулился,
  // значит строку каталога удалили (ON DELETE SET NULL) — переносить нечего.
  // Искать файл по хвосту ключа было бы к тому же бесполезно: там физическое имя
  // `{uuid}-имя.mp4`, а в каталоге лежит логическое.
  if (!task.isFolder) return null

  const marker = "/IN/"
  const at = task.sourceKey.lastIndexOf(marker)
  if (at < 0) return null
  const name = task.sourceKey.slice(at + marker.length)
  if (!name || name.includes("/")) return null

  const byName = await query<SourceRow>(
    `SELECT id, name, folder_path AS "folderPath", is_folder AS "isFolder"
       FROM project_files
      WHERE project_id = $1
        AND name = $2
        AND is_folder = TRUE
        AND deleted_at IS NULL
      ORDER BY (folder_path = 'IN') DESC, updated_at DESC
      LIMIT 1`,
    [task.projectId, name],
  )
  return byName.rows[0] ?? null
}

/** Папка ошибок проекта, если она уже есть. */
async function findErrorsFolder(
  projectId: string,
): Promise<{ id: string; name: string } | null> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id, name
       FROM project_files
      WHERE project_id = $1
        AND folder_path = ''
        AND is_folder = TRUE
        AND deleted_at IS NULL
        -- Без учёта регистра, префикс "errors" + скобка: покрывает и канон
        -- errors (MM.DD-HH.mm), и легаси Errors (YYYY-MM-DD), и папку,
        -- которую переименовал человек. Вторую рядом не заводим — мы её
        -- просто переименуем обратно к канону.
        AND name ~* '^errors \\('
      ORDER BY name DESC
      LIMIT 1`,
    [projectId],
  )
  return result.rows[0] ?? null
}

/**
 * Свободное имя в папке назначения.
 *
 * Нужно, потому что перенос падает на занятом имени (`assertNameFree`), а
 * столкновение здесь штатное: человек перезалил `video.mp4` вместо упавшего, и
 * тот тоже упал. Ронять из-за этого перенос нельзя — файл остался бы в IN
 * невидимым, то есть ровно в том состоянии, ради ухода от которого всё и
 * делается.
 */
async function freeName(
  projectId: string,
  folderPath: string,
  name: string,
  excludeId: string,
): Promise<string> {
  const taken = await query<{ name: string }>(
    `SELECT name
       FROM project_files
      WHERE project_id = $1
        AND lower(folder_path) = lower($2)
        AND id <> $3
        AND deleted_at IS NULL`,
    [projectId, folderPath, excludeId],
  )
  const busy = new Set(taken.rows.map((r) => r.name.toLowerCase()))
  if (!busy.has(name.toLowerCase())) return name

  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!busy.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

/** Актор переносов конвейера: человека за ними нет. */
const PIPELINE_ACTOR = { userId: null, isUploader: false } as const

export type QuarantineResult =
  | { ok: true; folderPath: string; name: string }
  | { ok: false; reason: "no-task" | "no-source" | "not-in-in" | "already" }

/**
 * Унести исходник упавшей задачи из IN в папку ошибок.
 *
 * Идемпотентна и молчалива: файла нет, его уже унесли, человек сам переложил его
 * куда-то ещё — все эти случаи возвращают отказ с причиной, а не исключение.
 * Зовётся из хвоста падения задачи, и уронить это падение она права не имеет.
 */
export async function quarantineTaskSource(
  taskId: string,
): Promise<QuarantineResult> {
  const task = await readTask(taskId)
  if (!task) return { ok: false, reason: "no-task" }

  const source = await findSourceRow(task)
  if (!source) return { ok: false, reason: "no-source" }

  // Уже в папке ошибок — значит перенос состоялся, отметку просто закрепляем.
  if (isErrorsFolderName(source.folderPath.split("/")[0] ?? "")) {
    await stampQuarantine(taskId)
    return { ok: false, reason: "already" }
  }

  // Не в IN — файл трогал человек. Его решение старше нашего.
  if (source.folderPath !== "IN") return { ok: false, reason: "not-in-in" }

  const wanted = errorsFolderName()
  const existing = await findErrorsFolder(task.projectId)

  if (existing && existing.name !== wanted) {
    // Дата в имени всегда последняя: папка одна, и она про «когда сломалось в
    // последний раз», а не про историю. Лежащие внутри файлы едут с ней.
    await writeRename({
      storageOwnerId: task.storageOwnerId,
      projectId: task.projectId,
      fileId: existing.id,
      name: wanted,
      actor: PIPELINE_ACTOR,
    })
  } else if (!existing) {
    await writeEnsureFolderPath({
      storageOwnerId: task.storageOwnerId,
      projectId: task.projectId,
      folderPath: wanted,
      actor: PIPELINE_ACTOR,
    })
  }

  const name = await freeName(task.projectId, wanted, source.name, source.id)
  await writeRename({
    storageOwnerId: task.storageOwnerId,
    projectId: task.projectId,
    fileId: source.id,
    name,
    folderPath: wanted,
    actor: PIPELINE_ACTOR,
  })

  await stampQuarantine(taskId)
  return { ok: true, folderPath: wanted, name }
}

async function stampQuarantine(taskId: string): Promise<void> {
  await query(
    `UPDATE tasks SET quarantined_at = NOW() WHERE id = $1 AND quarantined_at IS NULL`,
    [taskId],
  )
}

export type RestoreResult =
  | { ok: true; name: string }
  | { ok: false; reason: "no-task" | "no-source" | "not-quarantined" }

/**
 * Вернуть исходник из папки ошибок обратно в IN.
 *
 * Задачу не трогаем: она остаётся упавшей, это история. Новую заведёт событийная
 * линия — перенос в IN журналируется как `move` с ключом внутри IN, а такое
 * событие сканер как раз и ждёт. Обход бы не помог: для него ключ «известен».
 */
export async function restoreTaskSource(taskId: string): Promise<RestoreResult> {
  const task = await readTask(taskId)
  if (!task) return { ok: false, reason: "no-task" }

  const source = await findSourceRow(task)
  if (!source) return { ok: false, reason: "no-source" }
  if (source.folderPath === "IN") {
    await query(`UPDATE tasks SET quarantined_at = NULL WHERE id = $1`, [taskId])
    return { ok: false, reason: "not-quarantined" }
  }

  const name = await freeName(task.projectId, "IN", source.name, source.id)
  await writeRename({
    storageOwnerId: task.storageOwnerId,
    projectId: task.projectId,
    fileId: source.id,
    name,
    folderPath: "IN",
    actor: PIPELINE_ACTOR,
  })

  await query(`UPDATE tasks SET quarantined_at = NULL WHERE id = $1`, [taskId])
  return { ok: true, name }
}

/**
 * Перенос в карантин с проглоченной ошибкой — форма для вызова из очереди.
 *
 * Падение задачи уже случилось и записано; если сверх того не удалось передвинуть
 * файл, это неприятно, но не повод отказать машине в отчёте и заставить её
 * ретраить то, что уже принято.
 */
export async function quarantineQuietly(taskId: string): Promise<void> {
  try {
    const result = await quarantineTaskSource(taskId)
    if (result.ok) {
      console.log(
        `[pipeline] quarantined ${taskId} → ${result.folderPath}/${result.name}`,
      )
    }
  } catch (error) {
    const message =
      error instanceof StorageWriteError || error instanceof Error
        ? error.message
        : String(error)
    console.error(`[pipeline] quarantine failed for ${taskId}: ${message}`)
  }
}
