import { query } from "@/lib/db"
import { accessIdsFor } from "@/lib/repositories/users"

/**
 * Что об обработке видит сам человек в кабинете.
 *
 * Отдельный файл, а не флаг в `lib/pipeline/tasks.ts`, и ровно по той же
 * причине, по которой «Мои ключи» отделены от админских: там и здесь разные
 * права, а один обработчик с ветвлением однажды отдал бы наружу лишнее. Лишнее
 * тут — не чужие проекты, а внутренняя кухня: `pluginId` и `nodeType` шагов,
 * текст `tasks.error` с трейсом плагина, имя машины, число попыток, оценка в
 * центах. Человеку нужен ответ на один вопрос: «мой файл взяли, он идёт, он
 * готов?» — и на него отвечают четыре состояния и доля пройденных шагов.
 *
 * `claimed` наружу не показываем: разница между «машина взяла» и «машина
 * работает» есть только внутри очереди, а человеку и то и другое — «в работе».
 */

export type AccountTaskStatus = "queued" | "running" | "done" | "failed"

export type AccountTask = {
  id: string
  projectId: string
  projectName: string
  /** Логическое имя элемента: то, что человек видит в дереве. */
  name: string
  isFolder: boolean
  status: AccountTaskStatus
  /** Доля пройденного: шагов отчиталось `done` из скольких в цепочке. */
  stepsDone: number
  stepsTotal: number
  /** Когда машина взяла задачу — от него в интерфейсе тикает таймер. */
  startedAt: string | null
  /** Когда всё закончилось: успехом или ошибкой. */
  finishedAt: string | null
  createdAt: string
  /**
   * Куда ведёт переход «открыть файл»: папка в дереве проекта и, если он там
   * один, имя файла для выделения.
   *
   * Отвечает на вопрос «где смотреть результат», а не «откуда взяли исходник», и
   * поэтому у завершённой задачи это РЕЗУЛЬТАТ, а не источник. После успешной
   * обработки граф уносит исходник по своим правилам — обычно в корень `OUT`, —
   * а готовое кладёт в подпапку; ссылка на источник открывала бы корень `OUT` и
   * оставляла человека в шаге от того, что он искал. Пути результатов присылает
   * `taskDone` (`payload.outFiles`, вида `OUT/08 August/clip.mp4`).
   *
   * У живой и упавшей задачи результата ещё нет — ведём к исходнику: у упавшей
   * это папка ошибок, куда его унесло падение.
   *
   * `null` — в каталоге не нашлось ничего: переход ведёт просто в проект.
   */
  folderPath: string | null
  fileName: string | null
}

/**
 * Сколько завершённых показываем.
 *
 * Всплывающее окно — сводка происходящего, а не журнал: хвост длиннее пары
 * десятков строк в нём нечитаем, а история и так лежит в проекте. Отдельного
 * хранилища под вытеснение не нужно — это просто LIMIT.
 */
const FINISHED_LIMIT = 12
/** Живых у одного человека столько не бывает; потолок против выброса. */
const LIVE_LIMIT = 20

type Row = {
  id: string
  projectId: string
  projectName: string
  name: string
  isFolder: boolean
  status: "queued" | "claimed" | "running" | "done" | "failed"
  stepsDone: string
  stepsTotal: number
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  folderPath: string | null
  fileName: string | null
  /** Логические пути результатов у завершённой задачи; иначе null. */
  outFiles: unknown
}

/**
 * Выборка по проектам, к которым человек имеет отношение: свои и те, куда его
 * позвали. Платит за обработку всегда владелец, но видеть ход работы вправе и
 * участник — он же и заливал файл.
 */
const SELECT = `
  SELECT t.id,
         t.project_id AS "projectId",
         p.name       AS "projectName",
         COALESCE(
           t.payload -> 'description' ->> 'curItem',
           regexp_replace(t.source_key, '^.*/', '')
         ) AS "name",
         COALESCE(
           (t.payload -> 'description' ->> 'isFolder')::boolean, FALSE
         ) AS "isFolder",
         t.status,
         COALESCE((
           SELECT COUNT(*) FROM task_progress tp
            WHERE tp.task_id = t.id AND tp.status = 'done'
         ), 0)::text AS "stepsDone",
         COALESCE(jsonb_array_length(t.payload -> 'processingQueue'), 0) AS "stepsTotal",
         t.claimed_at AS "startedAt",
         CASE WHEN t.status IN ('done', 'failed') THEN t.updated_at END AS "finishedAt",
         t.created_at AS "createdAt",
         src.folder_path AS "folderPath",
         src.name        AS "fileName",
         CASE WHEN t.status = 'done' THEN t.payload -> 'outFiles' END AS "outFiles"
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    -- Где исходник сейчас. Файл находится по source_file_id, папка — по имени:
    -- у неё этого поля нет, сборка кладёт NULL (lib/pipeline/scan.ts), и
    -- единственная зацепка — хвост source_key после IN/.
    LEFT JOIN LATERAL (
      SELECT pf.folder_path, pf.name
        FROM project_files pf
       WHERE pf.project_id = t.project_id
         AND pf.deleted_at IS NULL
         AND (
           pf.id = t.source_file_id
           OR (
             t.source_file_id IS NULL
             AND pf.is_folder
             AND pf.name = regexp_replace(t.source_key, '^.*/IN/', '')
           )
         )
       ORDER BY (pf.id = t.source_file_id) DESC
       LIMIT 1
    ) src ON TRUE
   WHERE (
           p.user_id = $1
           -- Участие своё или входа (MULTI_COMPANY_PROFILES_PLAN.md §8.3):
           -- $2 — accessIdsFor(userId).
           OR EXISTS (
             SELECT 1 FROM project_members m
              WHERE m.project_id = p.id AND m.user_id = ANY($2::text[])
           )
         )
`

/**
 * Путь результата → пара «папка, имя».
 *
 * Ведём к папке всегда, а имя выделяем только когда результат один: при
 * нескольких выбирать первый попавшийся значило бы подсветить произвольный файл
 * из пачки, и это хуже, чем открытая папка со всеми.
 */
function resultLocation(
  outFiles: unknown,
): { folderPath: string; fileName: string | null } | null {
  if (!Array.isArray(outFiles)) return null
  const paths = outFiles.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const first = paths[0]
  if (!first) return null

  const clean = first.replace(/^\/+/, "")
  const cut = clean.lastIndexOf("/")
  if (cut < 0) return { folderPath: "", fileName: paths.length === 1 ? clean : null }
  return {
    folderPath: clean.slice(0, cut),
    fileName: paths.length === 1 ? clean.slice(cut + 1) : null,
  }
}

function toTask(row: Row): AccountTask {
  const result = resultLocation(row.outFiles)
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    name: row.name,
    isFolder: row.isFolder,
    status: row.status === "claimed" ? "running" : row.status,
    stepsDone: Number(row.stepsDone),
    stepsTotal: row.stepsTotal,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    folderPath: result ? result.folderPath : row.folderPath,
    fileName: result ? result.fileName : row.fileName,
  }
}

export async function listAccountTasks(userId: string): Promise<AccountTask[]> {
  const ids = await accessIdsFor(userId)
  const [live, finished] = await Promise.all([
    query<Row>(
      `${SELECT} AND t.status IN ('queued', 'claimed', 'running')
        ORDER BY t.created_at ASC
        LIMIT ${LIVE_LIMIT}`,
      [userId, ids],
    ),
    query<Row>(
      `${SELECT} AND t.status IN ('done', 'failed')
        ORDER BY t.updated_at DESC
        LIMIT ${FINISHED_LIMIT}`,
      [userId, ids],
    ),
  ])

  return [...live.rows.map(toTask), ...finished.rows.map(toTask)]
}
