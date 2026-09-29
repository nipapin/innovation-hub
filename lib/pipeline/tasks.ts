import { query } from "@/lib/db"

/**
 * Очередь задач для окна «Очередь» на странице конвейера.
 *
 * Показывает три вещи, которые админ хочет видеть, не открывая базу: что нашлось,
 * какая машина взяла задачу и в каком та сейчас состоянии.
 */

export type TaskStatus = "queued" | "claimed" | "running" | "done" | "failed"

/**
 * Состояние шага. Порт `StepInfo['status']` из лог-окна десктопа: `queued` —
 * шаг есть в цепочке, но машина о нём ещё не отчитывалась.
 */
export type TaskStepStatus = "queued" | "running" | "done" | "error"

export type TaskStep = {
  stepId: string
  /** Человекочитаемая подпись: pluginId, если он есть, иначе id шага. */
  label: string
  nodeType: string | null
  status: TaskStepStatus
  message: string | null
  updatedAt: string | null
}

export type PipelineTask = {
  id: string
  status: TaskStatus
  projectId: string
  projectName: string
  ownerEmail: string
  /** Имя элемента, по которому создана задача: файла или папки. */
  sourceName: string
  /** Папка целиком обрабатывается в один результат — это видно в списке. */
  isFolder: boolean
  /** Сколько шагов в собранной цепочке обработки. */
  stepCount: number
  /**
   * Шаги в порядке processingQueue со наложенным прогрессом.
   *
   * Есть у всех, кроме `queued`: и у живых, и у упавших, и у завершённых.
   * Цепочка берётся из `payload.processingQueue`, состояния накладываются из
   * `task_progress`, и ни то ни другое завершение задачи больше не стирает.
   */
  steps: TaskStep[]
  /** Машина, на которой задача была последний раз; null — её никто не брал. */
  machineName: string | null
  claimedAt: string | null
  leaseExpiresAt: string | null
  attempts: number
  error: string | null
  /** Когда исходник унесли из IN в папку ошибок; null — он всё ещё в IN. */
  quarantinedAt: string | null
  createdAt: string
}

type TaskRow = Omit<
  PipelineTask,
  "claimedAt" | "leaseExpiresAt" | "createdAt" | "quarantinedAt" | "steps"
> & {
  claimedAt: Date | null
  leaseExpiresAt: Date | null
  quarantinedAt: Date | null
  createdAt: Date
  /** Порядок шагов из payload.processingQueue. */
  stepIds: string[] | null
  /** pluginId и nodeType по каждому шагу — из тех же ключей payload. */
  stepMeta: Record<string, { pluginId?: string; nodeType?: string }> | null
}

/** Живые задачи: те, по которым работа ещё идёт или вот-вот начнётся. */
export const LIVE_TASK_STATUSES: TaskStatus[] = ["queued", "claimed", "running"]
/** Завершённые: дальше с ними ничего не произойдёт, это уже история. */
export const FINISHED_TASK_STATUSES: TaskStatus[] = ["done", "failed"]

/**
 * Список задач с фильтром по состояниям.
 *
 * Фильтр обязателен по смыслу окна: живое и завершённое показываются отдельными
 * зонами, и смешивать их в одной выборке незачем — за неделю работы завершённых
 * накапливается столько, что живая задача тонет в них даже при правильной
 * сортировке.
 */
export async function listPipelineTasks(
  options: { statuses?: TaskStatus[]; limit?: number } = {},
): Promise<PipelineTask[]> {
  const statuses = options.statuses ?? [
    ...LIVE_TASK_STATUSES,
    ...FINISHED_TASK_STATUSES,
  ]
  const limit = options.limit ?? 200
  const result = await query<TaskRow>(
    `SELECT t.id,
            t.status,
            t.project_id AS "projectId",
            p.name       AS "projectName",
            u.email      AS "ownerEmail",
            -- Имя файла лежит в собранном объекте; ключ как запас на случай,
            -- когда description ещё не заполнен.
            COALESCE(
              t.payload -> 'description' ->> 'curItem',
              regexp_replace(t.source_key, '^.*/', '')
            ) AS "sourceName",
            COALESCE(jsonb_array_length(t.payload -> 'processingQueue'), 0) AS "stepCount",
            COALESCE(
              (t.payload -> 'description' ->> 'isFolder')::boolean, FALSE
            ) AS "isFolder",
            -- Порядок шагов и их метаданные достаём тем же запросом: цепочка уже
            -- лежит в payload, второй раз ходить за ней незачем.
            CASE
              WHEN jsonb_typeof(t.payload -> 'processingQueue') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(t.payload -> 'processingQueue'))
            END AS "stepIds",
            (
              SELECT jsonb_object_agg(
                       s.step_id,
                       jsonb_build_object(
                         'pluginId', t.payload -> s.step_id ->> 'pluginId',
                         'nodeType', t.payload -> s.step_id ->> 'nodeType'
                       )
                     )
                FROM jsonb_array_elements_text(
                       CASE WHEN jsonb_typeof(t.payload -> 'processingQueue') = 'array'
                            THEN t.payload -> 'processingQueue'
                            ELSE '[]'::jsonb END
                     ) AS s(step_id)
            ) AS "stepMeta",
            c.name       AS "machineName",
            t.claimed_at AS "claimedAt",
            t.lease_expires_at AS "leaseExpiresAt",
            t.attempts,
            t.error,
            t.quarantined_at AS "quarantinedAt",
            t.created_at AS "createdAt"
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = p.user_id
       -- По last_machine_id, а не по claimed_by: аренда снимается на любом
       -- терминальном переходе, и джойн по ней оставлял упавшую задачу без
       -- машины. last_machine_id ставится при захвате и не чистится.
       LEFT JOIN remote_computers c ON c.id = t.last_machine_id
      WHERE t.status = ANY($1)
      ORDER BY
        -- Живые задачи выше завершённых: в работе интересует то, что происходит.
        CASE t.status
          WHEN 'running' THEN 0
          WHEN 'claimed' THEN 1
          WHEN 'queued'  THEN 2
          WHEN 'failed'  THEN 3
          ELSE 4
        END,
        t.created_at DESC
      LIMIT $2`,
    [statuses, limit],
  )

  /**
   * Прогресс — одним запросом на всю выборку, а не по задаче: строк там столько
   * же, сколько шагов, и join на каждую задачу отдельно ничего не выиграет.
   *
   * Берём всё, по чему кто-то отчитывался, — и завершённые тоже. Раньше
   * `taskDone` строки прогресса удалял, и у готовой задачи цепочки не было
   * вовсе; теперь они остаются, а вычищает их по возрасту тик конвейера.
   * `queued` спрашивать незачем — по ней ещё никто не отчитывался.
   */
  const reportedIds = result.rows
    .filter((r) => r.status !== "queued")
    .map((r) => r.id)

  const progress = new Map<
    string,
    Map<string, { status: TaskStepStatus; message: string | null; updatedAt: Date }>
  >()

  if (reportedIds.length > 0) {
    const rows = await query<{
      taskId: string
      stepId: string
      status: TaskStepStatus
      message: string | null
      updatedAt: Date
    }>(
      `SELECT task_id AS "taskId", step_id AS "stepId", status, message,
              updated_at AS "updatedAt"
         FROM task_progress
        WHERE task_id = ANY($1)`,
      [reportedIds],
    )
    for (const row of rows.rows) {
      const byStep = progress.get(row.taskId) ?? new Map()
      byStep.set(row.stepId, {
        status: row.status,
        message: row.message,
        updatedAt: row.updatedAt,
      })
      progress.set(row.taskId, byStep)
    }
  }

  return result.rows.map((row) => {
    const reported = progress.get(row.id)
    const finished = row.status === "done" || row.status === "failed"
    const steps: TaskStep[] = (row.stepIds ?? []).map((stepId) => {
      const meta = row.stepMeta?.[stepId]
      const seen = reported?.get(stepId)
      // `running` у завершённой задачи — шаг, который начался и не отчитался о
      // конце: задача оборвалась на соседнем, параллельном ему. Идти ему уже
      // некуда, и пульсирующий «в работе» квадратик врал бы. Показываем как
      // недошедший — тем же цветом, что и шаги, до которых дело не дошло.
      const status =
        finished && seen?.status === "running" ? "queued" : seen?.status
      return {
        stepId,
        label: meta?.pluginId || stepId,
        nodeType: meta?.nodeType ?? null,
        // Шаг, о котором машина ещё не отчитывалась, — queued. Так цепочка видна
        // целиком с самого начала, а не наполняется по мере отчётов.
        status: status ?? "queued",
        message: seen?.message ?? null,
        updatedAt: seen?.updatedAt.toISOString() ?? null,
      }
    })

    return {
      id: row.id,
      status: row.status,
      projectId: row.projectId,
      projectName: row.projectName,
      ownerEmail: row.ownerEmail,
      sourceName: row.sourceName,
      isFolder: row.isFolder,
      stepCount: row.stepCount,
      steps,
      machineName: row.machineName,
      attempts: row.attempts,
      error: row.error,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  })
}

/** Сколько завершённых задач показываем. Зона «Завершено» — справка, а не
 *  рабочий список: всю историю за месяцы туда тянуть незачем. */
const FINISHED_ZONE_LIMIT = 50

export type TaskZones = {
  /** `queued` + `claimed` + `running` — то, ради чего окно открывают. */
  live: PipelineTask[]
  /** `done` + `failed`, последние FINISHED_ZONE_LIMIT по дате создания. */
  finished: PipelineTask[]
}

/**
 * Обе зоны окна очереди одним вызовом.
 *
 * Два запроса, а не один с разбором на клиенте: у зон разные лимиты, и живая
 * задача не должна вытесняться из выборки сотней завершённых.
 */
export async function listPipelineTaskZones(): Promise<TaskZones> {
  const [live, finished] = await Promise.all([
    listPipelineTasks({ statuses: LIVE_TASK_STATUSES }),
    listPipelineTasks({
      statuses: FINISHED_TASK_STATUSES,
      limit: FINISHED_ZONE_LIMIT,
    }),
  ])
  return { live, finished }
}

/**
 * Снимает задачу руками из окна очереди.
 *
 * Помечает `failed`, а НЕ удаляет строку — и это не мелочь. Страховочный обход
 * (lib/pipeline/sweep.ts) берёт элементы IN, по которым задачи нет вообще: удали
 * строку, и он через свой интервал завёл бы задачу заново по тому же файлу.
 * Помеченная `failed` задача из очереди уходит, обходом не переоткрывается, а
 * история остаётся видимой.
 *
 * Аренду снимаем: если задачу держала машина, её `taskDone` теперь получит 409 —
 * это честнее, чем принять отчёт по снятой работе.
 */
export async function cancelPipelineTask(input: {
  taskId: string
  reason: string
}): Promise<boolean> {
  const result = await query(
    `UPDATE tasks
        SET status = 'failed',
            error = $2,
            claimed_by = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('queued', 'claimed', 'running')`,
    [input.taskId, input.reason],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Удаляет строку задачи насовсем.
 *
 * Нужна, когда задача не «снята», а не должна была существовать: мусор от
 * экспериментов, дубль, задача по проекту, который уже не ведут. Отдельно от
 * снятия именно потому, что у удаления есть последствие: элемент, который всё ещё
 * лежит в IN, снова становится «незнакомым» для обхода, и задача по нему появится
 * снова. Для живого файла это правильное поведение — «забудь и найди заново», — но
 * выбирать его должен человек, а не кнопка с подписью «снять».
 */
export async function deletePipelineTask(taskId: string): Promise<boolean> {
  const result = await query(`DELETE FROM tasks WHERE id = $1`, [taskId])
  return (result.rowCount ?? 0) > 0
}

export type TaskCounts = Record<TaskStatus, number> & { total: number }

export async function countPipelineTasksByStatus(): Promise<TaskCounts> {
  const result = await query<{ status: TaskStatus; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status`,
  )
  const counts: TaskCounts = {
    queued: 0,
    claimed: 0,
    running: 0,
    done: 0,
    failed: 0,
    total: 0,
  }
  for (const row of result.rows) {
    counts[row.status] = row.n
    counts.total += row.n
  }
  return counts
}
