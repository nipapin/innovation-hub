import { query, withTransaction } from "@/lib/db"
import { quarantineQuietly } from "@/lib/pipeline/quarantine"
import { isElevated } from "@/lib/admin-roles"
import { OWN_MACHINES_ONLY_KEY } from "@/lib/company-features"

/**
 * Выдача задач машинам.
 *
 * Модель — pull: сайт не знает про машины и никому ничего не рассылает, он кладёт
 * задачи в очередь. Свободная машина сама приходит за следующей. «Свободен» —
 * состояние неявное: свободен тот, кто пришёл.
 *
 * Судья при захвате — не оркестратор и не код машины, а сам запрос:
 * `FOR UPDATE SKIP LOCKED` отдаёт строку ровно одной из десяти машин, дёрнувших
 * claim одновременно. Узкого горлышка и SPOF в момент раздачи нет.
 *
 * Машина умерла — аренда протухает, задача возвращается в очередь (reapExpiredLeases
 * на тике runner.ts). Задача не теряется.
 *
 * Обоснование модели и почему отвергнут push — fs.manager.tauri/ideasAndTest/
 * DISTRIBUTED_QUEUE_PLAN.md, список требований — PIPELINE_BACKEND_REQUESTS.md §3.
 */

/**
 * Сколько задача считается «моей» без продления.
 *
 * Пятнадцать минут — компромисс: шаг After Effects идёт минутами, и слишком
 * короткая аренда вернула бы живую задачу в очередь. Продлевается каждым
 * taskProgress, поэтому долгий шаг обязан отчитываться.
 */
const LEASE_MINUTES = 15

export type ClaimedTask = {
  id: string
  projectId: string
  projectName: string
  ownerEmail: string
  payload: unknown
  attempts: number
  maxAttempts: number
  leaseExpiresAt: string
}

/**
 * Кто зовёт очередь. Три ступени видимости, а не две
 * (docs/COMPANY_PIPELINE_PLAN.md §3).
 */
export type QueueCaller = {
  computerId: string
  userId: string
  role: string
  /**
   * Компания машины. NULL — наша. Заполнено — она стоит у клиента и берёт
   * только задачи его людей.
   */
  companyId?: string | null
}

function isAdmin(caller: QueueCaller): boolean {
  return isElevated(caller.role)
}

/**
 * Что именно видно этой машине в очереди.
 *
 * Три ступени:
 *
 *   машина компании — задачи людей ЭТОЙ компании, и больше ничего;
 *   наша машина     — общий раздел и компании, у которых своих машин нет;
 *   `mch_` человека — проекты своего владельца, как было всегда.
 *
 * Средняя ступень — не «всё подряд», и это главное изменение. Компания, отдавшая
 * нам свои машины, чаще всего сделала это из-за конфиденциальности: её работа не
 * должна попадать на чужое железо. Поэтому наша машина обходит стороной задачи
 * тех компаний, у кого машины есть.
 *
 * «Есть машины» считается по наличию СТРОКИ, а не по тому, на связи ли она
 * сейчас. Иначе перезагрузка машины у клиента на пять минут перекидывала бы его
 * работу к нам и обратно — ровно то, чего он просил не делать.
 *
 * Флаг `ownMachinesOnly` (§4) сужает середину ещё раз и отвечает на единственный
 * оставшийся вопрос: что делать, если своих машин у компании нет СОВСЕМ.
 * Выключен — берём на себя; включён — очередь стоит. Стоящая очередь видна и
 * объяснима, молча уехавшая к нам чужая работа — нет.
 */
function visibilityClause(caller: QueueCaller): {
  sql: string
  params: (string | boolean)[]
} {
  if (caller.companyId) {
    return {
      sql: `u.company_id = $3`,
      params: [caller.companyId],
    }
  }
  if (isAdmin(caller)) {
    return {
      sql: `(
             u.company_id IS NULL
             OR (
               NOT EXISTS (
                 SELECT 1 FROM remote_computers rc
                  WHERE rc.company_id = u.company_id
                    AND rc.revoked_at IS NULL
               )
               -- Сравнение с 'true'::jsonb, а не приведение ->>'...'::boolean:
               -- в свободном мешке features под этим ключом однажды окажется
               -- строка, которую приведение не осилит, и упадёт не флаг, а весь
               -- запрос очереди — то есть встанет обработка у всех сразу.
               -- Сравнение же тотально: не true значит выключен.
               AND NOT COALESCE(
                 (SELECT c.features->'${OWN_MACHINES_ONLY_KEY}' = 'true'::jsonb
                    FROM companies c WHERE c.id = u.company_id),
                 FALSE
               )
             )
           )`,
      params: [],
    }
  }
  return { sql: `p.user_id = $3`, params: [caller.userId] }
}

type ClaimRow = {
  id: string
  projectId: string
  projectName: string
  ownerEmail: string
  payload: unknown
  attempts: number
  maxAttempts: number
  leaseExpiresAt: Date
}

/**
 * Атомарно забирает следующую задачу.
 *
 * `null` — очередь пуста; это штатный ответ, а не ошибка: машина дёргает claim на
 * каждом пульсе демона синхронизации (3 с) и пустой ответ получает почти всегда.
 *
 * Видимость задач — три ступени, см. `visibilityClause`. Это граница доверия, а
 * не деталь реализации: машина компании не должна увидеть чужую задачу даже на
 * мгновение, потому что вслед за задачей она пойдёт за файлами проекта.
 */
export async function claimNextTask(
  caller: QueueCaller,
): Promise<ClaimedTask | null> {
  const visibility = visibilityClause(caller)
  const result = await query<ClaimRow>(
    `UPDATE tasks t
        SET status           = 'claimed',
            claimed_by       = $1,
            -- Дубль claimed_by, который никто не занулит: аренду терминальные
            -- переходы снимают, а «на какой машине это было» должно пережить
            -- падение — иначе у упавшей задачи колонка «Машина» пустая.
            last_machine_id  = $1,
            claimed_at       = NOW(),
            lease_expires_at = NOW() + ($2 || ' minutes')::interval,
            attempts         = t.attempts + 1,
            error            = NULL,
            updated_at       = NOW()
      WHERE t.id = (
        SELECT c.id
          FROM tasks c
          JOIN projects p ON p.id = c.project_id
          JOIN users u ON u.id = p.user_id
         WHERE c.status = 'queued'
           AND ${visibility.sql}
         ORDER BY c.created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING t.id,
                t.project_id AS "projectId",
                t.payload,
                t.attempts,
                t.max_attempts AS "maxAttempts",
                t.lease_expires_at AS "leaseExpiresAt",
                (SELECT name FROM projects WHERE id = t.project_id) AS "projectName",
                (SELECT u.email FROM projects p2 JOIN users u ON u.id = p2.user_id
                  WHERE p2.id = t.project_id) AS "ownerEmail"`,
    [caller.computerId, String(LEASE_MINUTES), ...visibility.params],
  )

  const row = result.rows[0]
  if (!row) return null

  // Метка «чем занята машина» — для админки. Отдельным запросом после захвата:
  // задача уже честно закреплена арендой, и эта строка на корректность очереди
  // не влияет — только на то, что видно в колонке «Машина».
  await query(
    `UPDATE remote_computers
        SET status = 'busy',
            current_project_id = $2,
            current_task_id = $3
      WHERE id = $1`,
    [caller.computerId, row.projectId, row.id],
  )

  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    ownerEmail: row.ownerEmail,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
  }
}

export type QueueMutationResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "not-owner" }

/**
 * Проверяет, что задача существует и держит её именно эта машина.
 *
 * Разделять «нет задачи» и «задача не твоя» важно: первое — нормальная гонка с
 * протухшей арендой (задачу уже перезабрали), второе — ошибка в машине.
 */
async function assertHolder(
  taskId: string,
  computerId: string,
): Promise<QueueMutationResult> {
  const result = await query<{ claimedBy: string | null }>(
    `SELECT claimed_by AS "claimedBy" FROM tasks WHERE id = $1`,
    [taskId],
  )
  const row = result.rows[0]
  if (!row) return { ok: false, reason: "not-found" }
  if (row.claimedBy !== computerId) return { ok: false, reason: "not-owner" }
  return { ok: true }
}

/**
 * Двигает шаг и продлевает аренду.
 *
 * Первый отчёт переводит задачу из `claimed` в `running`: до него машина только
 * забрала задачу, а работать могла ещё не начать.
 */
export async function reportTaskProgress(input: {
  caller: QueueCaller
  taskId: string
  stepId: string
  status: "running" | "done" | "error"
  message?: string | null
}): Promise<QueueMutationResult> {
  const holder = await assertHolder(input.taskId, input.caller.computerId)
  if (!holder.ok) return holder

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO task_progress (task_id, step_id, status, message)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, step_id) DO UPDATE
         SET status = EXCLUDED.status,
             message = EXCLUDED.message,
             updated_at = NOW()`,
      [input.taskId, input.stepId, input.status, input.message ?? null],
    )
    await client.query(
      `UPDATE tasks
          SET status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END,
              lease_expires_at = NOW() + ($2 || ' minutes')::interval,
              updated_at = NOW()
        WHERE id = $1`,
      [input.taskId, String(LEASE_MINUTES)],
    )
  })

  return { ok: true }
}

/**
 * Завершение задачи.
 *
 * Идемпотентно по task_id: повторный заход (машина упала между заливкой и
 * отчётом, задачу перезабрали и она прошла второй раз) не роняет и не дублирует —
 * уже завершённая задача просто отвечает ok. В распределённой системе «ровно один
 * раз» не бывает, поэтому повтор делаем безвредным, а не боремся с ним.
 */
export async function completeTask(input: {
  caller: QueueCaller
  taskId: string
  outFiles?: string[]
  totalCost?: number
}): Promise<QueueMutationResult> {
  const holder = await assertHolder(input.taskId, input.caller.computerId)
  if (!holder.ok) {
    // Задача уже done и claimed_by сброшен — это повторный заход, а не ошибка.
    if (holder.reason === "not-owner") {
      const done = await query<{ status: string }>(
        `SELECT status FROM tasks WHERE id = $1`,
        [input.taskId],
      )
      if (done.rows[0]?.status === "done") return { ok: true }
    }
    return holder
  }

  await withTransaction(async (client) => {
    /**
     * Итог ДОБАВЛЯЕТСЯ к payload, а не заменяет его.
     *
     * Раньше заменял — «у завершённой задачи payload занимает место и больше не
     * нужен». Оба утверждения оказались неверны. Место: несколько килобайт на
     * задачу, то есть ничто. А нужен он двоим:
     *
     * - тарификации. `settleUnbilled` берёт оси из `payload.description`
     *   (`payBase`, `payMeter`, `sourceUnits`) — в архиве машины их нет, и взять
     *   больше неоткуда. С обнулённым payload они приезжали пустыми, и КАЖДАЯ
     *   успешно завершённая задача уходила в «пропущено», то есть не списывалась
     *   никогда;
     * - окну очереди. Цепочка шагов лежит в `processingQueue`, и без неё у
     *   завершённой задачи в колонке «Шагов» стоял ноль — при том, что шаги
     *   прошли и известны.
     */
    await client.query(
      `UPDATE tasks
          SET status = 'done',
              payload = payload || jsonb_build_object(
                'outFiles', $2::jsonb,
                'totalCost', $3::numeric
              ),
              claimed_by = NULL,
              lease_expires_at = NULL,
              error = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.taskId,
        JSON.stringify(input.outFiles ?? []),
        input.totalCost ?? null,
      ],
    )
    // Строки прогресса тоже оставляем: это готовая история шагов со временем и
    // последним сообщением, и другой у нас нет. Растут они не бесконечно —
    // старые вычищает `evictOldProgress` на тике конвейера.
    await client.query(
      `UPDATE remote_computers
          SET status = 'idle', current_task_id = NULL, current_project_id = NULL
        WHERE id = $1`,
      [input.caller.computerId],
    )
  })

  return { ok: true }
}

/** Задача упала. payload сохраняется — иначе нечего переретраивать и не в чем разбираться. */
export async function failTask(input: {
  caller: QueueCaller
  taskId: string
  error: string
}): Promise<QueueMutationResult> {
  const holder = await assertHolder(input.taskId, input.caller.computerId)
  if (!holder.ok) return holder

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE tasks
          SET status = 'failed',
              error = $2,
              claimed_by = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [input.taskId, input.error.slice(0, 4000)],
    )
    await client.query(
      `UPDATE remote_computers
          SET status = 'error', current_task_id = NULL
        WHERE id = $1`,
      [input.caller.computerId],
    )
  })

  // Исходник уносим из IN в папку ошибок. `failed` — состояние терминальное:
  // назад в очередь эту задачу никто не вернёт, а пока файл лежит в IN, он для
  // конвейера невидим (обход берёт только элементы без задач). Перенос делает
  // это видимым в дереве и оставляет дорогу назад.
  await quarantineQuietly(input.taskId)

  return { ok: true }
}

/**
 * Задача снята из-за отсутствующего ключа внешнего сервиса (пункт 5 запроса).
 *
 * Третий исход рядом с `failTask` и `releaseTask`, и отличается от обоих:
 *
 * - `failTask` — «эта попытка не удалась»; задача уйдёт на повтор, и следующая
 *   машина упрётся в то же самое, пока не кончатся `maxAttempts`. Умрёт она
 *   тогда как «превышены попытки», хотя причина была известна с первой машины;
 * - `releaseTask` — «верните её кому-нибудь»; здесь это заведомо бесполезно,
 *   ключа нет ни у кого.
 *
 * Поэтому задача закрывается сразу и с кодом, а не с текстом: состояние проекта
 * показывают обе стороны, и разбирать строку ради значка — гарантированное
 * расхождение. Проект при этом гасится отдельно (`handleVendorIncident`), и
 * следующий проход конвейера соберёт задачу заново, когда ключ появится:
 * уникальность задач держится только на живых статусах, `failed` пересозданию
 * не мешает.
 *
 * Попытку не считаем: машина отработала честно, ей просто нечем было работать.
 */
export async function blockTaskOnVendorKey(input: {
  /** Кто держит задачу. Сейф зовёт это с `auth.computerId`, без полного caller. */
  computerId: string
  taskId: string
  code: string
  service: string
}): Promise<QueueMutationResult> {
  const holder = await assertHolder(input.taskId, input.computerId)
  if (!holder.ok) return holder

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE tasks
          SET status = 'failed',
              error = $2,
              -- Попытка не списывается: причина не в машине и не в попытке.
              attempts = GREATEST(0, attempts - 1),
              claimed_by = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [input.taskId, `${input.code}:${input.service}`],
    )
    // Машина не в ошибке: она исправна и готова к следующей задаче. Пометить её
    // `error` значило бы вывести из парка исправный узел.
    await client.query(
      `UPDATE remote_computers
          SET status = 'idle', current_task_id = NULL
        WHERE id = $1`,
      [input.computerId],
    )
  })

  return { ok: true }
}

/**
 * Явный возврат задачи в очередь — для аварийной остановки на машине.
 *
 * У машины две кнопки стопа, и это разные операции: мягкая доводит текущую задачу
 * до конца и отчитывается обычным taskDone, аварийная убивает процессы сейчас.
 * Без releaseTask после аварийной остановки задача пятнадцать минут числится
 * взятой, и никто её не подхватит.
 *
 * Попытку не считаем: оператор остановил осознанно, это не провал обработки.
 */
export async function releaseTask(input: {
  caller: QueueCaller
  taskId: string
}): Promise<QueueMutationResult> {
  const holder = await assertHolder(input.taskId, input.caller.computerId)
  if (!holder.ok) return holder

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              claimed_by = NULL,
              claimed_at = NULL,
              lease_expires_at = NULL,
              attempts = GREATEST(attempts - 1, 0),
              updated_at = NOW()
        WHERE id = $1`,
      [input.taskId],
    )
    await client.query(`DELETE FROM task_progress WHERE task_id = $1`, [
      input.taskId,
    ])
    await client.query(
      `UPDATE remote_computers
          SET status = 'idle', current_task_id = NULL, current_project_id = NULL
        WHERE id = $1`,
      [input.caller.computerId],
    )
  })

  return { ok: true }
}

/**
 * Чистка истории шагов у давно завершённых задач.
 *
 * Появилась вместе с решением не удалять прогресс при завершении: без потолка
 * `task_progress` растёт линейно и навсегда — тысяча элементов в день по пять
 * шагов это полтора миллиона строк в год ни для кого.
 *
 * Срок отмеряем от `tasks.updated_at`, а не от `task_progress.updated_at`:
 * интересует возраст задачи целиком, а не когда в последний раз шевельнулся
 * отдельный шаг. Живые задачи не трогаем ни при каком возрасте — у них шаги
 * показываются прямо сейчас.
 */
const PROGRESS_KEEP_DAYS = 30

export async function evictOldProgress(): Promise<number> {
  const result = await query(
    `DELETE FROM task_progress p
      USING tasks t
      WHERE t.id = p.task_id
        AND t.status IN ('done', 'failed')
        AND t.updated_at < NOW() - ($1 || ' days')::interval`,
    [String(PROGRESS_KEEP_DAYS)],
  )
  return result.rowCount ?? 0
}

/**
 * Возвращает в очередь задачи умерших машин.
 *
 * Вешается на тот же тик, что и сканер: аренда протухла — значит машина не
 * отчитывалась LEASE_MINUTES, и задачу надо отдать другой. Попытки исчерпаны —
 * помечаем failed, иначе задача крутилась бы по кругу вечно.
 */
export async function reapExpiredLeases(): Promise<number> {
  const result = await query<{ id: string; status: string }>(
    `UPDATE tasks
        SET status = CASE
                       WHEN attempts < max_attempts THEN 'queued'
                       ELSE 'failed'
                     END,
            error = CASE
                      WHEN attempts < max_attempts THEN error
                      ELSE COALESCE(error, 'Lease expired: machine stopped reporting.')
                    END,
            claimed_by = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE status IN ('claimed', 'running')
        AND lease_expires_at < NOW()
      RETURNING id, status`,
  )

  // Те, у кого попытки кончились, — такое же терминальное падение, как
  // `taskFailed`, только сказать о нём было некому. Исходник уносим по тому же
  // правилу, иначе файл молча остаётся в IN невидимым для обеих линий сборки.
  for (const row of result.rows) {
    if (row.status === "failed") await quarantineQuietly(row.id)
  }

  return result.rowCount ?? 0
}

/**
 * Гасит задачи, у которых больше нет источника.
 *
 * Появилось из живого случая: программа обработала файл своим прежним путём и
 * удалила его (`deleteAfter` в графе), а задача по нему уже стояла в очереди.
 * Байтов нет, presign на удалённый ключ отдаст 404 — задача невыполнима. Но сама
 * она из очереди не уйдёт: машина берёт её, возвращает через `releaseTask`, а тот
 * ещё и уменьшает `attempts` обратно, поэтому до `max_attempts` дело не доходит
 * никогда. Получается вечный цикл и очередь, которая показывает работу, которой
 * нет.
 *
 * Трогаем только `queued`. Задачу, которую держит машина, не отменяем: она могла
 * уже скачать байты и работать по своей копии — там источник в каталоге больше
 * ничего не решает.
 *
 * Источник ищем тремя способами, потому что ключ файла может измениться, а связь
 * остаться: по `source_file_id` (его же ставит сборка), по физическому ключу и по
 * имени папки в IN. Достаточно любого совпадения — гасим, только если не нашлось
 * ни одного.
 */
export async function reapOrphanedTasks(): Promise<number> {
  const result = await query(
    `UPDATE tasks t
        SET status = 'failed',
            error = COALESCE(t.error, $1),
            claimed_by = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE t.status = 'queued'
        AND NOT EXISTS (
          SELECT 1
            FROM project_files f
           WHERE f.project_id = t.project_id
             AND f.deleted_at IS NULL
             AND (
                   f.id = t.source_file_id
                OR f.s3_key = t.source_key
                OR (
                     f.is_folder
                 AND f.folder_path = 'IN'
                 AND f.name = regexp_replace(t.source_key, '^.*/', '')
                   )
             )
        )`,
    ["Источник задачи удалён из проекта — обрабатывать нечего."],
  )
  return result.rowCount ?? 0
}

/** Шаги задачи для окна очереди. */
export async function listTaskProgress(taskId: string): Promise<
  { stepId: string; status: string; message: string | null; updatedAt: string }[]
> {
  const result = await query<{
    stepId: string
    status: string
    message: string | null
    updatedAt: Date
  }>(
    `SELECT step_id AS "stepId", status, message, updated_at AS "updatedAt"
       FROM task_progress
      WHERE task_id = $1
      ORDER BY updated_at`,
    [taskId],
  )
  return result.rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }))
}
