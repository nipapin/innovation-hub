import { query } from "@/lib/db"
import { loadVolumeSeries } from "@/lib/statistics/snapshots"
import {
  STAT_METRICS,
  STAT_ROW_LIMIT,
  breakdownsFor,
  periodToBuckets,
  periodToInterval,
  type StatBreakdown,
  type StatMetric,
  type StatPeriod,
  type StatsBucket,
  type StatsCardRow,
  type StatsElementCard,
  type StatsFunnelStep,
  type StatsHistogramBin,
  type StatsResponse,
  type StatsRow,
  type StatsScope,
  type StatsTotals,
  type StatVariant,
} from "@/lib/statistics/types"

/**
 * Слой запросов статистики. Один на админку и кабинет: разница только в
 * `scope.ownerId` (docs/STATISTICS_PLAN.md §6). Считает то, что база знает
 * сама, — файлы, объём, проекты и задачи конвейера. Обработки, себестоимость и
 * хронометраж приходят из архива (PIPELINE.md §14), а спенд — из ленты
 * транзакций (BILLING_AND_TRIAL_PLAN.md §П2).
 *
 * Три источника, и у каждого своя рамка. `scopeConditions` — для того, что
 * висит на проекте; `ledgerConditions` — для денег, где рамку задаёт плательщик
 * в самой строке. Смешивать их нельзя: проект удаляют, деньги остаются.
 */

/** Значение метрики строки — для отбора топов на сервере. */
function metricOf(row: StatsRow, metric: StatMetric): number {
  switch (metric) {
    case "files":
      return row.files
    case "bytes":
      return row.bytes
    case "tasks":
      return row.tasks
    case "errors":
      return row.errors
    case "procs":
      return row.procs
    case "spend":
      return row.spend
    case "cost":
      return row.cost
    case "render":
      return row.render
  }
}

/** Накопитель параметров: номера $n расставляются по факту добавления. */
class Params {
  readonly values: unknown[] = []

  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

/**
 * Рамка кабинета: **только свои проекты**, где пользователь владелец.
 *
 * Расшаренные сюда не входят, и это не упрощение: проект, расшаренный мне,
 * принадлежит другому человеку, и его объём, спенд и участники — его статистика,
 * а не моя. Кабинет отвечает на вопрос «сколько сделал я», и чужих в нём быть не
 * должно ни строкой, ни суммой (§1, требование 5).
 *
 * Проекты в корзине (`deleted_at`) по умолчанию исключены: иначе «объём сейчас»
 * расходится с дашбордом, который считает через `countProjectsByOwner`. Для
 * архива обработок делается исключение (`includeDeleted`) — там строки это
 * история работы, и терять её из-за корзины неправильно.
 */
function scopeConditions(
  scope: StatsScope,
  p: Params,
  options?: { includeDeleted?: boolean },
): string[] {
  const where: string[] = []
  if (!options?.includeDeleted) where.push("p.deleted_at IS NULL")
  if (scope.ownerId) where.push(`p.user_id = ${p.add(scope.ownerId)}`)
  if (scope.projectId) where.push(`p.id = ${p.add(scope.projectId)}`)
  return where
}

/** Ключ и подпись разреза для файлов. Машины у файла нет — см. rowsFromFiles. */
function fileBreakdownExpr(breakdown: StatBreakdown): {
  key: string
  label: string
} {
  switch (breakdown) {
    case "user":
      return {
        key: "COALESCE(f.uploaded_by, p.user_id)",
        label:
          "COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '')",
      }
    case "project":
      return { key: "p.id", label: "p.name" }
    case "fileType":
      return {
        key: "COALESCE(lower(substring(f.name from '\\.([^.]+)$')), '')",
        label: "COALESCE(lower(substring(f.name from '\\.([^.]+)$')), '')",
      }
    case "machine":
      return { key: "''", label: "''" }
  }
}

/** То же для задач конвейера: у них есть машина, а заливщик — через исходный файл. */
function taskBreakdownExpr(breakdown: StatBreakdown): {
  key: string
  label: string
} {
  switch (breakdown) {
    case "user":
      return {
        key: "COALESCE(sf.uploaded_by, p.user_id)",
        label:
          "COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '')",
      }
    case "project":
      return { key: "p.id", label: "p.name" }
    case "fileType":
      return {
        key: "COALESCE(lower(substring(t.source_key from '\\.([^.]+)$')), '')",
        label: "COALESCE(lower(substring(t.source_key from '\\.([^.]+)$')), '')",
      }
    case "machine":
      // Ключ — имя машины, а не `claimed_by`: в архиве машина приходит суффиксом
      // имени файла, и по UUID компьютера они бы никогда не сошлись. Пока нет
      // сквозной идентичности машины (PIPELINE §15), строки сливаются только при
      // совпадении имён — расхождение видно глазами, а не прячется в сумме.
      return { key: "COALESCE(rc.name, '')", label: "COALESCE(rc.name, '')" }
  }
}

/**
 * Разрез для архива обработок. Пользователь здесь — владелец проекта, а не
 * заливщик: у строки архива атрибуции по файлу нет. Тип файла берём входной
 * (`in_type`) — вопрос «чем чаще всего кормим» задаётся про вход.
 */
function archiveBreakdownExpr(breakdown: StatBreakdown): {
  key: string
  label: string
} {
  switch (breakdown) {
    case "user":
      return {
        key: "COALESCE(p.user_id, '')",
        label:
          "COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '')",
      }
    case "project":
      // Проект мог быть удалён (ON DELETE SET NULL) — история остаётся. Ключом
      // тогда служит имя из самой строки архива с префиксом: пустой ключ слил бы
      // все удалённые проекты в одну строку под именем первого из них.
      return {
        key: "COALESCE(p.id, 'name:' || ps.project_name)",
        label: "COALESCE(NULLIF(p.name, ''), ps.project_name, '')",
      }
    case "fileType":
      return {
        key: "COALESCE(lower(ps.in_type), '')",
        label: "COALESCE(lower(ps.in_type), '')",
      }
    case "machine":
      return {
        key: "COALESCE(ps.machine, '')",
        label: "COALESCE(ps.machine, '')",
      }
  }
}

type FileRow = { key: string | null; label: string | null; files: number; bytes: string }
type TaskRow = { key: string | null; label: string | null; tasks: number; errors: number }
type ArchiveRow = {
  key: string | null
  label: string | null
  procs: number
  /** `total_cost` архива — доллары, а не копейки: в ответе это `cost`. */
  cost: string
  render: number
}
type LedgerRow = { key: string | null; label: string | null; spend: string }

async function rowsFromFiles(
  scope: StatsScope,
  breakdown: StatBreakdown,
  period: StatPeriod,
): Promise<FileRow[]> {
  // Разрез по машинам к файлам не применим: файл не знает, кто его обработает.
  if (breakdown === "machine") return []

  const p = new Params()
  const expr = fileBreakdownExpr(breakdown)
  const where = [
    "f.is_folder = FALSE",
    "f.deleted_at IS NULL",
    ...scopeConditions(scope, p),
  ]
  if (scope.userId) {
    where.push(`COALESCE(f.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
  }
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`f.created_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<FileRow>(
    `SELECT ${expr.key} AS key,
            ${expr.label} AS label,
            COUNT(*)::int AS files,
            COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN users u ON u.id = COALESCE(f.uploaded_by, p.user_id)
      WHERE ${where.join(" AND ")}
      GROUP BY 1, 2`,
    p.values,
  )
  return result.rows
}

async function rowsFromTasks(
  scope: StatsScope,
  breakdown: StatBreakdown,
  period: StatPeriod,
): Promise<TaskRow[]> {
  const p = new Params()
  const expr = taskBreakdownExpr(breakdown)
  const where = scopeConditions(scope, p)
  if (scope.userId) {
    where.push(`COALESCE(sf.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
  }
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`t.created_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<TaskRow>(
    `SELECT ${expr.key} AS key,
            ${expr.label} AS label,
            COUNT(*)::int AS tasks,
            COUNT(*) FILTER (WHERE t.status = 'failed')::int AS errors
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_files sf ON sf.id = t.source_file_id
       LEFT JOIN users u ON u.id = COALESCE(sf.uploaded_by, p.user_id)
       LEFT JOIN remote_computers rc ON rc.id = t.claimed_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY 1, 2`,
    p.values,
  )
  return result.rows
}

/**
 * Необязательный источник: пока миграция не применена, `processing_stats` и
 * `storage_snapshots` не существуют. Раздел должен работать и без них — с
 * нулями вместо архива, а не пустой страницей вместо всего.
 */
async function optional<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(`[stats] ${label} unavailable`, error)
    return fallback
  }
}

/** Строки разреза из архива обработок. */
async function rowsFromArchive(
  scope: StatsScope,
  breakdown: StatBreakdown,
  period: StatPeriod,
): Promise<ArchiveRow[]> {
  const p = new Params()
  const expr = archiveBreakdownExpr(breakdown)
  const where = scopeConditions(scope, p, { includeDeleted: true })
  if (scope.userId) where.push(`p.user_id = ${p.add(scope.userId)}`)
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`ps.ended_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<ArchiveRow>(
    `SELECT ${expr.key} AS key,
            ${expr.label} AS label,
            COUNT(*)::int AS procs,
            COALESCE(SUM(ps.total_cost), 0)::float8 AS cost,
            COALESCE(SUM(ps.render_sec), 0)::int AS render
       FROM processing_stats ps
       LEFT JOIN projects p ON p.id = ps.project_id
       LEFT JOIN users u ON u.id = p.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY 1, 2`,
    p.values,
  )
  return result.rows
}

/**
 * Рамка ленты транзакций — своя, а не `scopeConditions`.
 *
 * Платит владелец проекта, и его id уже лежит в самой строке: join к `projects`
 * ради того же условия был бы лишним, а `p.deleted_at IS NULL` оттуда вдобавок
 * стирал бы историю денег вместе с проектом. Деньги проект переживают, и в этом
 * весь смысл ленты.
 *
 * Считаем только `charge` — ровно то же, что показывает «Баланс и расход»
 * (lib/billing/spending.ts). Две витрины про одни деньги обязаны сходиться до
 * копейки, поэтому набор видов здесь не «шире, зато честнее», а такой же.
 */
function ledgerConditions(scope: StatsScope, p: Params): string[] {
  const where = ["b.kind = 'charge'"]
  // В кабинете плательщик — сам владелец скоупа; в админке им становится тот,
  // в кого провалились. Обоих сразу не бывает: `sanitizeScope` это исключает.
  const payer = scope.ownerId ?? scope.userId
  if (payer) where.push(`b.user_id = ${p.add(payer)}`)
  if (scope.projectId) where.push(`b.project_id = ${p.add(scope.projectId)}`)
  return where
}

/**
 * Ключ и подпись разреза для денег.
 *
 * Тип файла и машину лента не знает — их приносит строка архива, связанная
 * ключом `billing_transactions.task_id = processing_stats.item_id`
 * (BILLING_AND_TRIAL_PLAN.md §П2). Поэтому джойн нужен ровно этим двум
 * разрезам: в остальных `processing_stats` могло и не быть в базе.
 */
function ledgerBreakdownExpr(breakdown: StatBreakdown): {
  key: string
  label: string
  needsArchive: boolean
} {
  switch (breakdown) {
    case "user":
      return {
        key: "b.user_id",
        label:
          "COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '')",
        needsArchive: false,
      }
    case "project":
      // Тот же вид ключа, что у архива: проект удалён (ON DELETE SET NULL) —
      // строка живёт под именем из архива. Иначе списания за удалённый проект
      // и его же обработки разъехались бы по двум строкам таблицы.
      return {
        key: "COALESCE(b.project_id, 'name:' || ps.project_name, '')",
        label: "COALESCE(NULLIF(p.name, ''), ps.project_name, '')",
        needsArchive: true,
      }
    case "fileType":
      return {
        key: "COALESCE(lower(ps.in_type), '')",
        label: "COALESCE(lower(ps.in_type), '')",
        needsArchive: true,
      }
    case "machine":
      return {
        key: "COALESCE(ps.machine, '')",
        label: "COALESCE(ps.machine, '')",
        needsArchive: true,
      }
  }
}

/** Строки разреза по деньгам: сколько списано, в копейках. */
async function rowsFromLedger(
  scope: StatsScope,
  breakdown: StatBreakdown,
  period: StatPeriod,
): Promise<LedgerRow[]> {
  const p = new Params()
  const expr = ledgerBreakdownExpr(breakdown)
  const where = ledgerConditions(scope, p)
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`b.created_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<LedgerRow>(
    `SELECT ${expr.key} AS key,
            ${expr.label} AS label,
            COALESCE(SUM(-b.amount_cents), 0)::text AS spend
       FROM billing_transactions b
       LEFT JOIN projects p ON p.id = b.project_id
       LEFT JOIN users u ON u.id = b.user_id
       ${expr.needsArchive ? "LEFT JOIN processing_stats ps ON ps.item_id = b.task_id" : ""}
      WHERE ${where.join(" AND ")}
      GROUP BY 1, 2`,
    p.values,
  )
  return result.rows
}

/** Деньги по корзинам таймлайна. Отдельным запросом — по той же причине, что архив. */
async function loadLedgerTimeline(
  scope: StatsScope,
  period: StatPeriod,
): Promise<Map<string, number>> {
  const { unit } = periodToBuckets(period)
  const p = new Params()
  const unitP = p.add(unit)
  const where = ledgerConditions(scope, p)
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`b.created_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<{ bucket: Date; spend: string }>(
    `SELECT date_trunc(${unitP}::text, b.created_at) AS bucket,
            COALESCE(SUM(-b.amount_cents), 0)::text AS spend
       FROM billing_transactions b
      WHERE ${where.join(" AND ")}
      GROUP BY 1`,
    p.values,
  )

  return new Map(
    result.rows.map((r) => [
      new Date(r.bucket).toISOString(),
      Number(r.spend),
    ]),
  )
}

/**
 * Гистограмма времени рендера. Бины фиксированные, а не посчитанные от максимума:
 * так соседние периоды сравнимы между собой, а подписи предсказуемы.
 */
const RENDER_BINS = [0, 5, 15, 30, 60, 120, 300, 600] as const

async function loadRenderHistogram(
  scope: StatsScope,
  period: StatPeriod,
): Promise<StatsHistogramBin[]> {
  const p = new Params()
  const where = [
    "ps.render_sec IS NOT NULL",
    ...scopeConditions(scope, p, { includeDeleted: true }),
  ]
  if (scope.userId) where.push(`p.user_id = ${p.add(scope.userId)}`)
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`ps.ended_at >= NOW() - ${p.add(interval)}::interval`)
  }

  // width_bucket по массиву границ возвращает 1 для первого интервала, поэтому
  // индекс бина — на единицу меньше.
  const bins = p.add([...RENDER_BINS])
  const result = await query<{ bin: number; count: number }>(
    `SELECT width_bucket(ps.render_sec, ${bins}::int[]) - 1 AS bin,
            COUNT(*)::int AS count
       FROM processing_stats ps
       LEFT JOIN projects p ON p.id = ps.project_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY 1`,
    p.values,
  )

  const counts = new Map(result.rows.map((r) => [Number(r.bin), r.count]))
  return RENDER_BINS.map((from, index) => ({
    from,
    to: index + 1 < RENDER_BINS.length ? RENDER_BINS[index + 1]! : null,
    count: counts.get(index) ?? 0,
  }))
}

/** Воронка задач конвейера: где именно стоит работа. */
async function loadTaskFunnel(scope: StatsScope): Promise<StatsFunnelStep[]> {
  const p = new Params()
  const where = scopeConditions(scope, p)
  if (scope.userId) {
    where.push(`COALESCE(sf.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
  }
  const result = await query<{ status: string; count: number }>(
    `SELECT t.status, COUNT(*)::int AS count
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_files sf ON sf.id = t.source_file_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY 1`,
    p.values,
  )
  const counts = new Map(result.rows.map((r) => [r.status, r.count]))
  const order: StatsFunnelStep["status"][] = [
    "queued",
    "claimed",
    "running",
    "done",
    "failed",
  ]
  return order.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

async function loadTotals(scope: StatsScope): Promise<StatsTotals> {
  const filesParams = new Params()
  const filesWhere = [
    "f.is_folder = FALSE",
    "f.deleted_at IS NULL",
    ...scopeConditions(scope, filesParams),
  ]
  if (scope.userId) {
    filesWhere.push(
      `COALESCE(f.uploaded_by, p.user_id) = ${filesParams.add(scope.userId)}`,
    )
  }
  const files = await query<{ files: number; bytes: string }>(
    `SELECT COUNT(*)::int AS files,
            COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE ${filesWhere.join(" AND ")}`,
    filesParams.values,
  )

  const projParams = new Params()
  const projWhere = scopeConditions(scope, projParams)
  // Провал в пользователя показывает его проекты — владельца, а не заливщика:
  // «сколько проектов у человека» иначе не считается.
  if (scope.userId) {
    projWhere.push(`p.user_id = ${projParams.add(scope.userId)}`)
  }
  const projects = await query<{ projects: number }>(
    `SELECT COUNT(*)::int AS projects
       FROM projects p
      ${projWhere.length ? `WHERE ${projWhere.join(" AND ")}` : ""}`,
    projParams.values,
  )

  const taskParams = new Params()
  const taskWhere = scopeConditions(scope, taskParams)
  if (scope.userId) {
    taskWhere.push(
      `COALESCE(sf.uploaded_by, p.user_id) = ${taskParams.add(scope.userId)}`,
    )
  }
  const tasks = await query<{ total: number; done: number; failed: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.status = 'done')::int AS done,
            COUNT(*) FILTER (WHERE t.status = 'failed')::int AS failed
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_files sf ON sf.id = t.source_file_id
      ${taskWhere.length ? `WHERE ${taskWhere.join(" AND ")}` : ""}`,
    taskParams.values,
  )

  // Архив: тоталы за всё время, как и остальные — период живёт в разрезах.
  const archiveParams = new Params()
  const archiveWhere = scopeConditions(scope, archiveParams, {
    includeDeleted: true,
  })
  if (scope.userId) {
    archiveWhere.push(`p.user_id = ${archiveParams.add(scope.userId)}`)
  }
  const archive = await optional(
    "archive totals",
    () =>
      query<{
        total: number
        done: number
        failed: number
        cost: number
        p50: number | null
        p95: number | null
      }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ps.status = 'done')::int AS done,
                COUNT(*) FILTER (WHERE ps.status <> 'done')::int AS failed,
                COALESCE(SUM(ps.total_cost), 0)::float8 AS cost,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.render_sec)::float8 AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY ps.render_sec)::float8 AS p95
           FROM processing_stats ps
           LEFT JOIN projects p ON p.id = ps.project_id
          ${archiveWhere.length ? `WHERE ${archiveWhere.join(" AND ")}` : ""}`,
        archiveParams.values,
      ).then((r) => r.rows[0] ?? null),
    null,
  )

  // Деньги — за всё время, как и остальные тоталы: период живёт в разрезах.
  const ledgerParams = new Params()
  const ledgerWhere = ledgerConditions(scope, ledgerParams)
  const ledger = await optional(
    "ledger totals",
    () =>
      query<{ spend: string }>(
        `SELECT COALESCE(SUM(-b.amount_cents), 0)::text AS spend
           FROM billing_transactions b
          WHERE ${ledgerWhere.join(" AND ")}`,
        ledgerParams.values,
      ).then((r) => r.rows[0] ?? null),
    null,
  )

  let users: number | null = null
  if (!scope.ownerId) {
    if (scope.userId) {
      users = 1
    } else {
      const res = await query<{ users: number }>(
        `SELECT COUNT(*)::int AS users FROM users WHERE is_active = TRUE`,
      )
      users = res.rows[0]?.users ?? 0
    }
  }

  return {
    files: files.rows[0]?.files ?? 0,
    bytes: Number(files.rows[0]?.bytes ?? 0),
    projects: projects.rows[0]?.projects ?? 0,
    tasksTotal: tasks.rows[0]?.total ?? 0,
    tasksDone: tasks.rows[0]?.done ?? 0,
    tasksFailed: tasks.rows[0]?.failed ?? 0,
    users,
    procsTotal: archive?.total ?? 0,
    procsDone: archive?.done ?? 0,
    procsError: archive?.failed ?? 0,
    spend: Number(ledger?.spend ?? 0),
    cost: Number(archive?.cost ?? 0),
    renderP50: archive?.p50 != null ? Number(archive.p50) : null,
    renderP95: archive?.p95 != null ? Number(archive.p95) : null,
  }
}

async function loadTimeline(
  scope: StatsScope,
  period: StatPeriod,
): Promise<StatsBucket[]> {
  const { unit, span, step } = periodToBuckets(period)
  const p = new Params()
  const unitP = p.add(unit)
  const spanP = p.add(span)
  const stepP = p.add(step)

  const fileWhere = [
    "f.is_folder = FALSE",
    "f.deleted_at IS NULL",
    ...scopeConditions(scope, p),
  ]
  if (scope.userId) {
    fileWhere.push(`COALESCE(f.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
  }
  // Один и тот же фильтр нужен дважды, но параметры уже добавлены — повторно
  // ссылаемся на те же номера, поэтому условия задач собираем отдельным
  // накопителем с продолжением нумерации.
  const taskWhere = scopeConditions(scope, p)
  if (scope.userId) {
    taskWhere.push(`COALESCE(sf.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
  }

  const result = await query<{
    bucket: Date
    files: number
    bytes: string
    tasks: number
    errors: number
  }>(
    `WITH b AS (
        SELECT generate_series(
                 date_trunc(${unitP}::text, NOW() - ${spanP}::interval),
                 date_trunc(${unitP}::text, NOW()),
                 ${stepP}::interval
               ) AS bucket
     ),
     fb AS (
        SELECT date_trunc(${unitP}::text, f.created_at) AS bucket,
               COUNT(*)::int AS files,
               COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
          FROM project_files f
          JOIN projects p ON p.id = f.project_id
         WHERE ${fileWhere.join(" AND ")}
         GROUP BY 1
     ),
     tb AS (
        SELECT date_trunc(${unitP}::text, t.created_at) AS bucket,
               COUNT(*)::int AS tasks,
               COUNT(*) FILTER (WHERE t.status = 'failed')::int AS errors
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          LEFT JOIN project_files sf ON sf.id = t.source_file_id
         ${taskWhere.length ? `WHERE ${taskWhere.join(" AND ")}` : ""}
         GROUP BY 1
     )
     SELECT b.bucket,
            COALESCE(fb.files, 0)::int AS files,
            COALESCE(fb.bytes, 0)::bigint AS bytes,
            COALESCE(tb.tasks, 0)::int AS tasks,
            COALESCE(tb.errors, 0)::int AS errors
       FROM b
       LEFT JOIN fb ON fb.bucket = b.bucket
       LEFT JOIN tb ON tb.bucket = b.bucket
      ORDER BY 1`,
    p.values,
  )

  return result.rows.map((r) => ({
    bucket: new Date(r.bucket).toISOString(),
    files: r.files,
    bytes: Number(r.bytes),
    tasks: r.tasks,
    errors: r.errors,
    procs: 0,
    spend: 0,
    cost: 0,
    render: 0,
  }))
}

/**
 * Архивная часть таймлайна отдельным запросом, а не CTE в общем: без
 * применённой миграции `processing_stats` не существует, и один упавший CTE
 * уронил бы весь ряд вместе с заливками. Склейка по корзинам — в getStatistics.
 */
async function loadArchiveTimeline(
  scope: StatsScope,
  period: StatPeriod,
): Promise<Map<string, { procs: number; cost: number; render: number }>> {
  const { unit } = periodToBuckets(period)
  const p = new Params()
  const unitP = p.add(unit)
  const where = [
    "ps.ended_at IS NOT NULL",
    ...scopeConditions(scope, p, { includeDeleted: true }),
  ]
  if (scope.userId) where.push(`p.user_id = ${p.add(scope.userId)}`)
  const interval = periodToInterval(period)
  if (interval) {
    where.push(`ps.ended_at >= NOW() - ${p.add(interval)}::interval`)
  }

  const result = await query<{
    bucket: Date
    procs: number
    cost: number
    render: number
  }>(
    `SELECT date_trunc(${unitP}::text, ps.ended_at) AS bucket,
            COUNT(*)::int AS procs,
            COALESCE(SUM(ps.total_cost), 0)::float8 AS cost,
            COALESCE(SUM(ps.render_sec), 0)::int AS render
       FROM processing_stats ps
       LEFT JOIN projects p ON p.id = ps.project_id
      WHERE ${where.join(" AND ")}
      GROUP BY 1`,
    p.values,
  )

  return new Map(
    result.rows.map((r) => [
      new Date(r.bucket).toISOString(),
      {
        procs: r.procs,
        cost: Number(r.cost),
        render: r.render,
      },
    ]),
  )
}

async function loadScopeLabels(scope: StatsScope) {
  let userLabel: string | null = null
  let projectLabel: string | null = null

  if (scope.userId) {
    const res = await query<{ label: string }>(
      `SELECT COALESCE(NULLIF(contact_name, ''), NULLIF(full_name, ''), email) AS label
         FROM users WHERE id = $1`,
      [scope.userId],
    )
    userLabel = res.rows[0]?.label ?? null
  }
  if (scope.projectId) {
    const res = await query<{ label: string }>(
      `SELECT name AS label FROM projects WHERE id = $1`,
      [scope.projectId],
    )
    projectLabel = res.rows[0]?.label ?? null
  }
  return { userLabel, projectLabel }
}

/**
 * Карточка элемента (§6.2): не конструктор, а фиксированный набор — кто работал,
 * какие типы файлов, когда последняя активность. Считается только из базовых
 * таблиц, без архива и снимков: карточка не должна зависеть от того, применены
 * ли миграции статистики.
 *
 * Спенд, обработки и хронометраж по элементу видны в плитках выше: при провале
 * они уже посчитаны с тем же фильтром.
 */
async function loadElementCard(
  scope: StatsScope,
): Promise<StatsElementCard | null> {
  const kind: StatsElementCard["kind"] | null = scope.projectId
    ? "project"
    : scope.userId
      ? "user"
      : null
  if (!kind) return null

  const fileFilters = (p: Params): string[] => {
    const where = [
      "f.is_folder = FALSE",
      "f.deleted_at IS NULL",
      ...scopeConditions(scope, p),
    ]
    if (scope.userId) {
      where.push(`COALESCE(f.uploaded_by, p.user_id) = ${p.add(scope.userId)}`)
    }
    return where
  }

  /**
   * Вклад. У пользователя это его проекты, у проекта — люди.
   *
   * Люди берутся не только из заливок: владелец, приглашённые участники и
   * заливщики сводятся объединением, поэтому в списке видно и того, кого
   * позвали, но кто ещё ничего не принёс. «Кто с ним работал» иначе отвечало бы
   * только про тех, кто успел залить файл.
   *
   * Чужие имена здесь законны и в кабинете: это участники **его** проекта.
   * Скоуп уже гарантировал, что проект свой.
   */
  const contributors = await (kind === "project"
    ? query<{
        key: string | null
        label: string | null
        files: number
        bytes: string
      }>(
        `WITH people AS (
              SELECT p.user_id AS user_id FROM projects p WHERE p.id = $1
              UNION
              SELECT m.user_id FROM project_members m WHERE m.project_id = $1
              UNION
              SELECT f.uploaded_by FROM project_files f
               WHERE f.project_id = $1 AND f.uploaded_by IS NOT NULL
         )
         SELECT ppl.user_id AS key,
                COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '') AS label,
                COUNT(f.id)::int AS files,
                COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
           FROM people ppl
           LEFT JOIN users u ON u.id = ppl.user_id
           LEFT JOIN project_files f
                  ON f.project_id = $1
                 AND f.is_folder = FALSE
                 AND f.deleted_at IS NULL
                 AND COALESCE(f.uploaded_by, (SELECT user_id FROM projects WHERE id = $1))
                     = ppl.user_id
          WHERE ppl.user_id IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 3 DESC, 2
          LIMIT 20`,
        [scope.projectId],
      )
    : (() => {
        const contribParams = new Params()
        const contribWhere = fileFilters(contribParams)
        return query<{
          key: string | null
          label: string | null
          files: number
          bytes: string
        }>(
          `SELECT p.id AS key,
                  p.name AS label,
                  COUNT(*)::int AS files,
                  COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
             FROM project_files f
             JOIN projects p ON p.id = f.project_id
            WHERE ${contribWhere.join(" AND ")}
            GROUP BY 1, 2
            ORDER BY 3 DESC
            LIMIT 20`,
          contribParams.values,
        )
      })())

  // Расшарен или нет — по числу приглашённых, владелец здесь не считается.
  const members =
    kind === "project"
      ? await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM project_members WHERE project_id = $1`,
          [scope.projectId],
        ).then((r) => r.rows[0]?.count ?? 0)
      : 0

  const typeParams = new Params()
  const typeWhere = fileFilters(typeParams)
  const fileTypes = await query<{
    key: string | null
    label: string | null
    files: number
    bytes: string
  }>(
    `SELECT COALESCE(lower(substring(f.name from '\\.([^.]+)$')), '') AS key,
            COALESCE(lower(substring(f.name from '\\.([^.]+)$')), '') AS label,
            COUNT(*)::int AS files,
            COALESCE(SUM(f.size_bytes), 0)::bigint AS bytes
       FROM project_files f
       JOIN projects p ON p.id = f.project_id
      WHERE ${typeWhere.join(" AND ")}
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 12`,
    typeParams.values,
  )

  // Последняя активность: файлы и задачи. Архив сознательно не трогаем, см. выше.
  const activityParams = new Params()
  const activityWhere = scopeConditions(scope, activityParams)
  if (scope.userId) {
    activityWhere.push(`p.user_id = ${activityParams.add(scope.userId)}`)
  }
  const activityCond = activityWhere.length
    ? `WHERE ${activityWhere.join(" AND ")}`
    : ""
  const activity = await query<{ last: string | null }>(
    `SELECT GREATEST(
              (SELECT MAX(GREATEST(f.created_at, f.updated_at))
                 FROM project_files f
                 JOIN projects p ON p.id = f.project_id
                ${activityCond}),
              (SELECT MAX(t.updated_at)
                 FROM tasks t
                 JOIN projects p ON p.id = t.project_id
                ${activityCond})
            )::text AS last`,
    // Условие подставлено в оба подзапроса с теми же номерами $n, поэтому
    // значения передаются один раз — иначе Postgres отвергнет лишние параметры.
    activityParams.values,
  )

  const labels = await loadScopeLabels(scope)
  const subtitle =
    kind === "project"
      ? await query<{ owner: string }>(
          `SELECT COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email, '') AS owner
             FROM projects p
             LEFT JOIN users u ON u.id = p.user_id
            WHERE p.id = $1`,
          [scope.projectId],
        ).then((r) => r.rows[0]?.owner ?? null)
      : await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
          scope.userId,
        ]).then((r) => r.rows[0]?.email ?? null)

  const toRows = (
    rows: { key: string | null; label: string | null; files: number; bytes: string }[],
  ): StatsCardRow[] =>
    rows.map((r) => ({
      key: r.key ?? "",
      label: r.label ?? "",
      files: r.files,
      bytes: Number(r.bytes),
    }))

  return {
    kind,
    title:
      (kind === "project" ? labels.projectLabel : labels.userLabel) ?? "",
    subtitle,
    members,
    lastActivityAt: activity.rows[0]?.last
      ? new Date(activity.rows[0].last).toISOString()
      : null,
    contributors: toRows(contributors.rows),
    fileTypes: toRows(fileTypes.rows),
  }
}

/**
 * Проверка фильтров провала перед любым запросом.
 *
 * Без неё кабинет читал бы чужие имена: подписи скоупа и подзаголовок карточки
 * разрешают `projectId`/`userId` напрямую, без рамки владельца, — то есть
 * `/api/account/statistics?projectId=<чужой uuid>` вернул бы название чужого
 * проекта и почту его владельца.
 *
 * В кабинете проект должен быть **своим**: расшаренный не подходит, он чужой.
 * Фильтр по человеку в кабинете снимается целиком — витрина отвечает на вопрос
 * «сколько сделал я», и разбивать её по людям незачем; заодно исчезает
 * единственное место, где кабинет мог показать чужое имя.
 *
 * Недоступный фильтр молча сбрасывается, а не отдаёт ошибку: разница между
 * «нет доступа» и «не существует» сама по себе утечка.
 */
async function sanitizeScope(scope: StatsScope): Promise<StatsScope> {
  if (!scope.ownerId) return scope

  let projectId = scope.projectId
  if (projectId) {
    const allowed = await query(
      `SELECT 1 FROM projects p WHERE p.id = $1 AND p.user_id = $2 LIMIT 1`,
      [projectId, scope.ownerId],
    )
    if (allowed.rowCount === 0) projectId = null
  }

  return { ...scope, projectId, userId: null }
}

export async function getStatistics({
  scope: requestedScope,
  breakdown: requestedBreakdown,
  period,
}: {
  scope: StatsScope
  breakdown: StatBreakdown
  period: StatPeriod
}): Promise<StatsResponse> {
  // Фильтры провала приходят от клиента, поэтому проверяются до всего остального.
  const scope = await sanitizeScope(requestedScope)
  const variant: StatVariant = scope.ownerId ? "account" : "admin"
  // Разрез сводится к допустимому здесь, а не в UI: клиент волен прислать
  // `breakdown=machine` мимо интерфейса, и запрет, живущий только в кнопках, —
  // не запрет. Недопустимый молча становится разрезом по проектам, как и любой
  // недоступный фильтр выше.
  const breakdown: StatBreakdown = breakdownsFor(variant).includes(
    requestedBreakdown,
  )
    ? requestedBreakdown
    : "project"

  const [
    totals,
    fileRows,
    taskRows,
    archiveRows,
    ledgerRows,
    timeline,
    archiveTimeline,
    ledgerTimeline,
    volume,
    histogram,
    funnel,
    labels,
    card,
  ] = await Promise.all([
    loadTotals(scope),
    rowsFromFiles(scope, breakdown, period),
    rowsFromTasks(scope, breakdown, period),
    // Всё, что читает архив и снимки, обёрнуто: до применения миграций этих
    // таблиц нет, и раздел должен показывать нули, а не пустую страницу.
    optional("archive rows", () => rowsFromArchive(scope, breakdown, period), []),
    optional("ledger rows", () => rowsFromLedger(scope, breakdown, period), []),
    loadTimeline(scope, period),
    optional(
      "archive timeline",
      () => loadArchiveTimeline(scope, period),
      new Map<string, { procs: number; cost: number; render: number }>(),
    ),
    optional(
      "ledger timeline",
      () => loadLedgerTimeline(scope, period),
      new Map<string, number>(),
    ),
    optional("volume series", () => loadVolumeSeries(scope, period), []),
    optional("render histogram", () => loadRenderHistogram(scope, period), []),
    loadTaskFunnel(scope),
    loadScopeLabels(scope),
    loadElementCard(scope),
  ])

  for (const bucket of timeline) {
    const archive = archiveTimeline.get(bucket.bucket)
    if (archive) {
      bucket.procs = archive.procs
      bucket.cost = archive.cost
      bucket.render = archive.render
    }
    bucket.spend = ledgerTimeline.get(bucket.bucket) ?? 0
  }

  const drill: StatsRow["drill"] =
    breakdown === "user" ? "user" : breakdown === "project" ? "project" : null
  // Синтетические ключи (история удалённого проекта — `name:…`) не UUID, и
  // провал по ним отдал бы 400 на валидации. Такие строки видно, но не кликабельны.
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

  const merged = new Map<string, StatsRow>()
  const touch = (key: string, label: string): StatsRow => {
    const existing = merged.get(key)
    if (existing) {
      if (!existing.label && label) existing.label = label
      return existing
    }
    const row: StatsRow = {
      key,
      label,
      files: 0,
      bytes: 0,
      tasks: 0,
      errors: 0,
      procs: 0,
      spend: 0,
      cost: 0,
      render: 0,
      drill: key && isUuid(key) ? drill : null,
    }
    merged.set(key, row)
    return row
  }

  for (const r of fileRows) {
    const row = touch(r.key ?? "", r.label ?? "")
    row.files += r.files
    row.bytes += Number(r.bytes)
  }
  for (const r of taskRows) {
    const row = touch(r.key ?? "", r.label ?? "")
    row.tasks += r.tasks
    row.errors += r.errors
  }
  for (const r of archiveRows) {
    const row = touch(r.key ?? "", r.label ?? "")
    row.procs += r.procs
    row.cost += Number(r.cost)
    row.render += r.render
  }
  for (const r of ledgerRows) {
    const row = touch(r.key ?? "", r.label ?? "")
    row.spend += Number(r.spend)
  }

  const all = [...merged.values()].sort(
    (a, b) =>
      b.files - a.files ||
      b.procs - a.procs ||
      b.tasks - a.tasks ||
      b.bytes - a.bytes,
  )

  // Лимит нельзя брать одной сортировкой: метрику переключает клиент, и топ по
  // спенду мог бы не попасть в срез, отобранный по числу файлов. Поэтому берём
  // объединение топов по каждой метрике — сумма ограничена, а лидер не теряется.
  const keep = new Set<string>()
  for (const metric of STAT_METRICS) {
    const top = [...all]
      .sort((a, b) => metricOf(b, metric) - metricOf(a, metric))
      .slice(0, STAT_ROW_LIMIT)
    for (const row of top) keep.add(row.key)
  }
  const rows = all.filter((row) => keep.has(row.key))

  return {
    totals,
    rows,
    timeline,
    volume,
    histogram,
    funnel,
    card,
    bucketUnit: periodToBuckets(period).unit,
    variant,
    breakdown,
    period,
    scope: {
      userId: scope.userId,
      userLabel: labels.userLabel,
      projectId: scope.projectId,
      projectLabel: labels.projectLabel,
    },
    truncated: all.length - rows.length,
  }
}
