/**
 * Типы и константы биллинга. Без `pg`: этот файл импортируют и клиентские
 * компоненты, а из репозиториев в бандл уехал бы драйвер базы.
 *
 * Разбор решений — docs/BILLING_AND_TRIAL_PLAN.md.
 */

// ─── Кошельки ────────────────────────────────────────────────────────────────

export const WALLETS = ["own", "gift"] as const
export type Wallet = (typeof WALLETS)[number]

// ─── Оси тарификации (П6) ────────────────────────────────────────────────────

/** От чего отталкиваемся при расчёте. */
export const PAY_BASES = ["output", "source", "render", "fixed"] as const
export type PayBase = (typeof PAY_BASES)[number]

/** В чём считаем. */
export const PAY_METERS = ["sec", "count", "bytes"] as const

/**
 * Сколько байтов в одной тарифной единице объёма.
 *
 * Внутри всё меряется байтами, а ставка задаётся за МЕГАБАЙТ — иначе цена в
 * копейках за байт округлилась бы до нуля и объём стал бы бесплатным. Перевод
 * живёт здесь, в одном месте: разойдись он между оценкой и списанием, резерв
 * никогда не сошёлся бы с фактом.
 */
export const BYTES_PER_UNIT = 1024 * 1024
export type PayMeter = (typeof PAY_METERS)[number]

/**
 * Ключ пары. У `fixed` меры нет — платим за сам прогон, и вторая ось не
 * участвует. Отдельное значение честнее, чем `fixed:sec`, которое пришлось бы
 * везде игнорировать.
 */
export type PayPair = "fixed" | `${Exclude<PayBase, "fixed">}:${PayMeter}`

export function payPair(base: PayBase, meter: PayMeter | null): PayPair {
  return base === "fixed" ? "fixed" : (`${base}:${meter ?? "sec"}` as PayPair)
}

/**
 * Пары, которые сайт умеет считать сегодня.
 *
 * Проверяется пара целиком, а не каждая ось отдельно: новая ось иначе молча
 * создаёт сочетания, которых никто не считал. Чего здесь нет и почему:
 *
 * - `source:sec` — нужен `srcSec`, поле схемы v2 архива (правка в десктопе);
 * - `output:bytes` — размеров выходных файлов в архиве нет.
 */
/**
 * Все сочетания осей — полная решётка, а не только считаемое сегодня.
 *
 * Нужна интерфейсу: тариф удобнее читать таблицей «вход/выход × секунда/штуки/
 * объём», и пустая клетка в ней должна быть видна вместе с причиной, а не
 * молча отсутствовать. Что из этого сайт умеет считать — ниже.
 */
export const ALL_PAY_PAIRS = [
  "source:sec",
  "source:count",
  "source:bytes",
  "output:sec",
  "output:count",
  "output:bytes",
  "render:sec",
  "fixed",
] as const satisfies readonly PayPair[]

/**
 * Почему пара пока не считается. Ключ словаря подставляет интерфейс — здесь
 * только сама причина, потому что она про данные, а не про язык.
 */
/** Пар, которые нечем посчитать в принципе, не осталось. */
export const PAIR_BLOCKERS: Partial<Record<PayPair, "not-in-archive">> = {}

/**
 * Пары, готовые на сайте, но ждущие данных от машины.
 *
 * Ставку задать можно, проект настроить можно — списание пойдёт, как только
 * программа начнёт слать поле. До тех пор такие обработки видны отдельным
 * счётчиком в проходе списания, а не пропадают молча.
 */
export const PAIR_PENDING_DATA: Partial<Record<PayPair, "src-sec">> = {
  "source:sec": "src-sec",
}

/** Валюты, в которых внешние сервисы выставляют счёт. Курс берём у ЦБ. */
export const VENDOR_CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY"] as const

export const SUPPORTED_PAY_PAIRS = [
  "source:sec",
  "output:sec",
  "output:count",
  "source:count",
  "source:bytes",
  "output:bytes",
  "render:sec",
  "fixed",
] as const satisfies readonly PayPair[]

export function isSupportedPair(pair: string): pair is PayPair {
  return (SUPPORTED_PAY_PAIRS as readonly string[]).includes(pair)
}

export function isPayBase(raw: unknown): raw is PayBase {
  return typeof raw === "string" && (PAY_BASES as readonly string[]).includes(raw)
}

export function isPayMeter(raw: unknown): raw is PayMeter {
  return typeof raw === "string" && (PAY_METERS as readonly string[]).includes(raw)
}

// ─── Лента (П2) ──────────────────────────────────────────────────────────────

/**
 * Виды движений. Резерва среди них нет намеренно: лента — это состоявшиеся
 * движения, а резерв живёт на самой задаче и снимается тем, что задача уходит
 * из живых статусов (lib/billing/funds.ts).
 */
export const TX_KINDS = [
  "topup",
  "grant",
  "charge",
  "refund",
  "writeoff",
  "exempt",
  "adjust",
] as const
export type TxKind = (typeof TX_KINDS)[number]

/** Раскладка списания: из чего сложилась сумма (П5). Всё в копейках. */
export type ChargeBreakdown = {
  /** Наша цена за результат: количество × ставка. */
  ourCents: number
  /**
   * Себестоимость внешних сервисов, приведённая к рублям. Показывается
   * пользователю именно в этом виде — по себестоимости, без наценки.
   */
  vendorCents: number
  /** Наценка на себестоимость. Показывается внутри нашей строки, не чужой. */
  marginCents: number
}

export function breakdownTotal(b: ChargeBreakdown): number {
  return b.ourCents + b.vendorCents + b.marginCents
}

/** Как считали — уезжает в транзакцию, чтобы прошлое не пересчитывалось. */
export type ChargeTerms = {
  base: PayBase
  meter: PayMeter | null
  units: number
  unitRateCents: number
  marginPct: number
  /** Валюта себестоимости до пересчёта и применённый курс. */
  vendorCurrency: string | null
  vendorRate: number | null
  vendorRateSource: string | null
}

// ─── Настройки (П12) ─────────────────────────────────────────────────────────

export type TrialSettings = {
  /** Включена ли кнопка «Попробовать бесплатно». */
  enabled: boolean
  amountCents: number
  /** null — подарок бессрочный. */
  lifetimeDays: number | null
}

export type BillingSettings = {
  /**
   * Ставка в копейках за единицу, по паре осей. Пары без ставки не
   * тарифицируются — и обработка по ним не берётся. Нуль как «бесплатно» здесь
   * недопустим: тогда забытая ставка выглядела бы как осознанное решение.
   */
  rates: Partial<Record<PayPair, number>>
  /** Наценка на себестоимость внешних сервисов, проценты. */
  marginPct: number
  /**
   * Порог допуска: минимум единиц, ради которых стоит начинать обработку.
   * В единицах, а не в деньгах — «10 секунд» понятно при любой ставке, «40 ₽»
   * устаревает с первой правкой тарифа.
   */
  minAdmitUnits: Record<PayMeter, number>
  /** Оценка, когда истории по проекту ещё нет. */
  defaultEstimateUnits: Record<PayMeter, number>
  /** Общий лимит овердрафта своего кошелька. У пользователя может быть свой. */
  overdraftLimitCents: number
  trial: TrialSettings
  /**
   * Проверять ли деньги в обычных проектах. По умолчанию выключено: иначе
   * первое же включение остановит обработку у всех — балансы нулевые, тарифа
   * ещё нет. Пробные проекты работают независимо от флага, у них есть грант.
   */
  enforceForOwnProjects: boolean
  /** В какой валюте плагины сообщают себестоимость. Контракт — доллар США. */
  vendorCurrency: string
  /**
   * Поправка к биржевому курсу, проценты. Не «наш курс», а компенсация того, что
   * реальная конвертация по карте дороже биржевой.
   */
  fxAdjustPct: number
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  rates: {},
  marginPct: 0,
  minAdmitUnits: { sec: 10, count: 1, bytes: 1 },
  defaultEstimateUnits: { sec: 60, count: 1, bytes: 0 },
  // Ноль, а не «немного»: овердрафт — это кредит, и выдаваться он должен
  // осознанным решением, а не значением по умолчанию.
  overdraftLimitCents: 0,
  trial: { enabled: false, amountCents: 600_000, lifetimeDays: null },
  enforceForOwnProjects: false,
  vendorCurrency: "USD",
  fxAdjustPct: 0,
}

// ─── Подарки (П7, П8) ────────────────────────────────────────────────────────

export const GRANT_KINDS = ["trial", "targeted"] as const
export type GrantKind = (typeof GRANT_KINDS)[number]

export const GRANT_STATUSES = [
  "provisioning",
  "active",
  "exhausted",
  "expired",
  "revoked",
] as const
export type GrantStatus = (typeof GRANT_STATUSES)[number]

/**
 * Адрес работы копирования у гранта: один на грант — отсюда идемпотентность
 * выдачи. Живёт здесь, а не рядом с выдачей: тот же адрес спрашивает сброс,
 * а импорт друг из друга замкнул бы модули в кольцо.
 */
export function provisionEventId(grantId: string): string {
  return `trial-provision:${grantId}`
}

export type GrantRecord = {
  id: string
  userId: string
  kind: GrantKind
  amountCents: number
  status: GrantStatus
  expiresAt: Date | null
  grantedBy: string | null
  comment: string
  provisionJobId: string | null
  closedAt: Date | null
  createdAt: Date
  /**
   * Когда период сбросили, разрешив пройти его заново (П9.1). Строка при этом
   * остаётся: по ней считаны прошлые начисления, и удалить её значило бы
   * оставить движения денег без адресата. `null` — обычный, несброшенный грант.
   */
  resetAt: Date | null
}

// ─── Форматирование ──────────────────────────────────────────────────────────

/**
 * Валюта учёта. Одна на весь сайт, и это не настройка.
 *
 * Лента хранит КОПЕЙКИ В РУБЛЯХ (П2): себестоимость внешних сервисов приводится
 * к рублю по курсу ЦБ прямо в транзакции, ставки задаются в рублях, клиент
 * платит рублями. Переключатель «показывать в долларах» не перевёл бы деньги —
 * он бы только подменил значок над теми же числами, и баланс 4 210 ₽ стал бы
 * «$4 210». Мультивалютность отложена сознательно (В2): поля валюты и курса в
 * ленте есть, но баланс в v1 рублёвый.
 *
 * Отдельно от `BillingSettings.vendorCurrency`: та отвечает на другой вопрос —
 * в чём выставляют счёт внешние сервисы, прежде чем мы приведём его к рублю.
 */
export const ACCOUNT_CURRENCY = "RUB"

/** Копейки → «1 234,50 ₽». Показ, а не расчёт. */
export function formatCents(cents: number, lang: "ru" | "en" = "ru"): string {
  const value = cents / 100
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: ACCOUNT_CURRENCY,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Секунды → `ЧЧ:ММ:СС`, а после суток — `10 д 15:25:12`.
 *
 * Переключателя формата нет: настройка, которую надо найти и понять, дороже
 * правила, которое просто работает. Кадры не участвуют — хронометраж приходит
 * целыми секундами.
 */
export function formatRuntime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const pad = (n: number) => String(n).padStart(2, "0")
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days} д ${clock}` : clock
}
