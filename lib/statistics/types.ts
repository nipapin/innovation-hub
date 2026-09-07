/**
 * Оси раздела статистики. Один набор типов на три слоя: запросы, API и UI —
 * иначе скоуп «только своё» расходится между админкой и кабинетом, а его
 * расхождение и есть главный риск этого раздела (docs/STATISTICS_PLAN.md §6).
 */

/**
 * Витрина. Разница не косметическая: кабинет отвечает на вопрос «сколько сделал
 * и потратил я», админка — «что происходит в системе». Поэтому набор осей у них
 * разный, и решает его сервер, а не клиент (см. `getStatistics`).
 */
export const STAT_VARIANTS = ["account", "admin"] as const
export type StatVariant = (typeof STAT_VARIANTS)[number]

/**
 * Метрика: что считаем.
 *
 * Два денежных счёта, и путать их нельзя:
 *
 *   spend  СПИСАНО С ЧЕЛОВЕКА — копейки в рублях из `billing_transactions`
 *   cost   ЧТО РАБОТА СТОИЛА НАМ — доллары из `processing_stats.total_cost`
 *
 * Это не одна величина в двух валютах: первая включает нашу цену за результат и
 * наценку (BILLING_AND_TRIAL_PLAN.md §П5), вторая — только счёт внешнего
 * сервиса, и валюта у неё по контракту доллар (§В3). Поэтому `cost` живёт
 * только в админке: пользователю он ответил бы на вопрос, которого тот не
 * задавал, зато в чужой валюте.
 */
export const STAT_METRICS = [
  "files",
  "bytes",
  "tasks",
  "errors",
  "procs",
  "spend",
  "cost",
  "render",
] as const
export type StatMetric = (typeof STAT_METRICS)[number]

/** Метрики кабинета: всё, кроме нашей себестоимости. */
export const ACCOUNT_METRICS = STAT_METRICS.filter(
  (metric) => metric !== "cost",
)

/** Разрез: по чему группируем. */
export const STAT_BREAKDOWNS = [
  "user",
  "project",
  "fileType",
  "machine",
] as const
export type StatBreakdown = (typeof STAT_BREAKDOWNS)[number]

/**
 * Разрезы кабинета. Ни людей, ни машин: и то, и другое — взгляд снаружи на
 * человека, а кабинет это его собственная витрина. Машины вдобавок наша кухня,
 * и «на какой из них считалось» не тот вопрос, ради которого сюда приходят.
 */
export const ACCOUNT_BREAKDOWNS = STAT_BREAKDOWNS.filter(
  (breakdown) => breakdown !== "user" && breakdown !== "machine",
)

export function metricsFor(variant: StatVariant): readonly StatMetric[] {
  return variant === "admin" ? STAT_METRICS : ACCOUNT_METRICS
}

export function breakdownsFor(variant: StatVariant): readonly StatBreakdown[] {
  return variant === "admin" ? STAT_BREAKDOWNS : ACCOUNT_BREAKDOWNS
}

/** Период события. Состояния («сейчас в хранилище») от него не зависят. */
export const STAT_PERIODS = ["7d", "30d", "90d", "12m", "all"] as const
export type StatPeriod = (typeof STAT_PERIODS)[number]

export type StatBucketUnit = "day" | "week" | "month"

/**
 * Скоуп запроса. `ownerId` — жёсткая рамка кабинета: **только свои** проекты,
 * расшаренные не в счёт (см. `scopeConditions`). У админки он null.
 * `projectId` — провал в элемент, доступен обеим витринам; `userId` — только
 * админке, в кабинете провала в человека нет вовсе.
 */
export type StatsScope = {
  ownerId: string | null
  userId: string | null
  projectId: string | null
}

/** Состояние на сейчас: период на него не влияет. */
export type StatsTotals = {
  files: number
  bytes: number
  projects: number
  tasksTotal: number
  tasksDone: number
  tasksFailed: number
  /** Только для админки: сколько активных пользователей попало в скоуп. */
  users: number | null
  /** Архив обработок. Ноль значит «архив ещё не импортирован». */
  procsTotal: number
  procsDone: number
  procsError: number
  /** Списано с человека, КОПЕЙКИ в рублях. Лента транзакций, не архив. */
  spend: number
  /** Во что работа обошлась нам: `total_cost` архива, ДОЛЛАРЫ. Только админка. */
  cost: number
  /** Медиана и p95 важнее среднего: среднее прячет выбросы (§6.2). */
  renderP50: number | null
  renderP95: number | null
}

/** Строка разреза. Все метрики сразу — переключение метрики не ходит на сервер. */
export type StatsRow = {
  key: string
  label: string
  files: number
  bytes: number
  tasks: number
  errors: number
  procs: number
  /** Копейки в рублях. */
  spend: number
  /** Доллары. */
  cost: number
  render: number
  /** Куда можно провалиться кликом. */
  drill: "user" | "project" | null
}

export type StatsBucket = {
  bucket: string
  files: number
  bytes: number
  tasks: number
  errors: number
  procs: number
  spend: number
  cost: number
  render: number
}

/** Точка ряда «объём в хранилище»: состояние на конец интервала. */
export type StatsVolumePoint = {
  bucket: string
  bytes: number
  files: number
}

/** Столбик гистограммы длительностей. `to = null` — последний, открытый бин. */
export type StatsHistogramBin = {
  from: number
  to: number | null
  count: number
}

/** Шаг воронки задач конвейера. Порядок — от находки к результату. */
export type StatsFunnelStep = {
  status: "queued" | "claimed" | "running" | "done" | "failed"
  count: number
}

/** Строка вклада в карточке элемента: участник проекта или проект пользователя. */
export type StatsCardRow = {
  key: string
  label: string
  files: number
  bytes: number
}

/**
 * Карточка элемента: фиксированный набор по §6.2, а не конструктор. Появляется
 * при провале в проект или пользователя.
 */
export type StatsElementCard = {
  kind: "project" | "user"
  title: string
  subtitle: string | null
  lastActivityAt: string | null
  /**
   * Сколько человек имеет доступ к проекту помимо владельца. Ноль — проект не
   * расшарен. Для карточки пользователя всегда ноль.
   */
  members: number
  /** Для проекта — кто в нём работал; для пользователя — его проекты. */
  contributors: StatsCardRow[]
  fileTypes: StatsCardRow[]
}

export type StatsResponse = {
  totals: StatsTotals
  rows: StatsRow[]
  timeline: StatsBucket[]
  /** Состояние по снимкам. Пустой ряд значит «снимки ещё не копились». */
  volume: StatsVolumePoint[]
  /** Распределение времени рендера по архиву. */
  histogram: StatsHistogramBin[]
  /** Где стоит работа: задачи конвейера по статусам. */
  funnel: StatsFunnelStep[]
  /** Карточка элемента — только при провале в проект или пользователя. */
  card: StatsElementCard | null
  bucketUnit: StatBucketUnit
  /** Какая витрина посчитана. Оси UI берёт отсюда, а не из собственного пропса. */
  variant: StatVariant
  breakdown: StatBreakdown
  period: StatPeriod
  /** Подписи активных фильтров провала — чтобы UI не ходил за ними отдельно. */
  scope: {
    userId: string | null
    userLabel: string | null
    projectId: string | null
    projectLabel: string | null
  }
  /** Сколько строк отброшено лимитом. Молчаливых обрезаний быть не должно. */
  truncated: number
}

export const STAT_ROW_LIMIT = 200

/** Период → шаг таймлайна и окно. `all` показывает 36 месяцев, разрез — всё. */
export function periodToBuckets(period: StatPeriod): {
  unit: StatBucketUnit
  span: string
  step: string
} {
  switch (period) {
    case "7d":
      return { unit: "day", span: "6 days", step: "1 day" }
    case "30d":
      return { unit: "day", span: "29 days", step: "1 day" }
    case "90d":
      return { unit: "week", span: "12 weeks", step: "1 week" }
    case "12m":
      return { unit: "month", span: "11 months", step: "1 month" }
    case "all":
      return { unit: "month", span: "35 months", step: "1 month" }
  }
}

/** Окно фильтра для строк разреза. `all` — без ограничения по времени. */
export function periodToInterval(period: StatPeriod): string | null {
  switch (period) {
    case "7d":
      return "7 days"
    case "30d":
      return "30 days"
    case "90d":
      return "90 days"
    case "12m":
      return "12 months"
    case "all":
      return null
  }
}
