import { query } from "@/lib/db"
import { StorageWriteError } from "@/lib/storage/errors"
import { writeRename } from "@/lib/storage/write-path"

/**
 * Карантин исходника упавшей задачи: дефис в начало имени, на месте в IN.
 *
 * Нужен потому, что пока файл лежит в IN непомеченным, он для конвейера мёртв:
 * обход берёт только элементы, по которым задачи не было вообще
 * (lib/pipeline/sweep.ts), а задача была — упавшая. Событийная линия его тоже не
 * подберёт, второго события по нему не будет. Файл невидим, и понять это можно
 * только запросом к базе.
 *
 * ДО 2026-09-23 это чинилось переносом в папку ошибок проекта
 * (`errors (MM.DD-HH.mm)`). От переноса отказались в пользу переименования —
 * решение общее с десктопом (fs.manager.tauri, `markSkippedWithDash` в
 * processItem.ts), и причины у него три:
 *
 * - дефис уже был языком «не брать в работу» для папок, и заводить рядом второй
 *   язык для файлов значило держать два механизма под одну задачу;
 * - перенос двигал запись каталога впустую: `s3Key` от папки не зависит, байты
 *   и так не едут, а у человека исходник пропадал из IN;
 * - обратная дорога становилась несимметричной — папку «возвращали» снятием
 *   дефиса, а файл переносом.
 *
 * Теперь дорога одна: снять `-` с имени. Это `move`-событие с ключом внутри IN,
 * и событийная линия заводит новую задачу за секунды (упавшая старая не мешает:
 * уникальный индекс держится только на живых статусах).
 *
 * Обе линии сборки обязаны считать дефис отказом и для файлов — см. `isHeldBack`
 * в lib/pipeline/scan.ts. Без этого пометка не значит ничего: задача заводится
 * снова тем же событием, которым мы её и пометили.
 */

/** Имя, помеченное как «в обработку не брать». */
function isDashed(name: string): boolean {
  return name.startsWith("-")
}

/** Снять пометку: ведущие дефисы и пробелы после них. */
function undash(name: string): string {
  return name.replace(/^-+\s*/, "")
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
 * Пометить исходник упавшей задачи дефисом, не вынимая его из IN.
 *
 * Идемпотентна и молчалива: файла нет, его уже пометили, человек сам переложил
 * его куда-то ещё — все эти случаи возвращают отказ с причиной, а не исключение.
 * Зовётся из хвоста падения задачи, и уронить это падение она права не имеет.
 */
export async function quarantineTaskSource(
  taskId: string,
): Promise<QuarantineResult> {
  const task = await readTask(taskId)
  if (!task) return { ok: false, reason: "no-task" }

  const source = await findSourceRow(task)
  if (!source) return { ok: false, reason: "no-source" }

  // Уже помечен — нами в прошлый раз или десктопом, который делает то же самое
  // своим `markSkippedWithDash`. Отметку просто закрепляем.
  if (isDashed(source.name)) {
    await stampQuarantine(taskId)
    return { ok: false, reason: "already" }
  }

  // Не в IN — файл трогал человек. Его решение старше нашего.
  if (source.folderPath !== "IN") return { ok: false, reason: "not-in-in" }

  // Столкновение имён штатно: человек перезалил `video.mp4` вместо упавшего, и
  // тот тоже упал — `-video.mp4` уже занято.
  const name = await freeName(
    task.projectId,
    "IN",
    `-${source.name}`,
    source.id,
  )
  await writeRename({
    storageOwnerId: task.storageOwnerId,
    projectId: task.projectId,
    fileId: source.id,
    name,
    actor: PIPELINE_ACTOR,
  })

  await stampQuarantine(taskId)
  return { ok: true, folderPath: "IN", name }
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
 * Снять пометку с исходника — вернуть его в работу.
 *
 * Задачу не трогаем: она остаётся упавшей, это история. Новую заведёт событийная
 * линия — переименование журналируется как `move` с ключом внутри IN, а такое
 * событие сканер как раз и ждёт. Обход бы не помог: для него ключ «известен».
 */
export async function restoreTaskSource(taskId: string): Promise<RestoreResult> {
  const task = await readTask(taskId)
  if (!task) return { ok: false, reason: "no-task" }

  const source = await findSourceRow(task)
  if (!source) return { ok: false, reason: "no-source" }
  if (!isDashed(source.name)) {
    await query(`UPDATE tasks SET quarantined_at = NULL WHERE id = $1`, [taskId])
    return { ok: false, reason: "not-quarantined" }
  }

  // Снятый дефис возвращает исходное имя — а оно может быть занято тем, что
  // человек залил взамен упавшего. Тогда берём соседнее свободное.
  const name = await freeName(
    task.projectId,
    "IN",
    undash(source.name),
    source.id,
  )
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
