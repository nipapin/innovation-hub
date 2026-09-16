import { query } from "@/lib/db"
import {
  DEFAULT_BILLING_SETTINGS,
  PAY_METERS,
  isSupportedPair,
  type BillingSettings,
  type PayMeter,
  type PayPair,
} from "@/lib/billing/types"

/**
 * Настройки тарификации — синглтон с JSONB и `revision`, тем же приёмом, что и
 * общие словари конвейера (lib/repositories/automation-settings.ts).
 *
 * Почему одним документом, а не таблицей ставок: ставки, маржа, пороги и размер
 * подарка — это одно распоряжение, и меняются они целиком. Таблица добавила бы
 * состояние «половина тарифа обновлена», которого в распоряжении не бывает.
 *
 * `revision` растёт на КАЖДУЮ запись, даже если содержимое не изменилось: это
 * счётчик оптимистической блокировки, а не хеш состояния.
 */

const SINGLETON = "singleton"

export type WriteResult =
  | { ok: true; settings: BillingSettings; revision: number }
  | { ok: false; reason: "revision-conflict"; settings: BillingSettings; revision: number }

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function meterMap(
  raw: unknown,
  fallback: Record<PayMeter, number>,
): Record<PayMeter, number> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const out = { ...fallback }
  for (const meter of PAY_METERS) {
    if (source[meter] !== undefined) out[meter] = num(source[meter], fallback[meter])
  }
  return out
}

/**
 * Приводит хранимый документ к полной форме.
 *
 * Отсутствующее поле — это не ошибка: документ пишется целиком, но между
 * деплоями в нём появляются новые ключи, и старая запись обязана продолжать
 * читаться. Поэтому недостающее берётся из умолчаний, а не роняет чтение.
 */
export function normalizeSettings(raw: unknown): BillingSettings {
  const d = DEFAULT_BILLING_SETTINGS
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}

  const rates: Partial<Record<PayPair, number>> = {}
  const rawRates =
    src.rates && typeof src.rates === "object"
      ? (src.rates as Record<string, unknown>)
      : {}
  for (const [pair, value] of Object.entries(rawRates)) {
    // Неизвестная пара выбрасывается молча: она могла остаться от прошлой
    // раскладки осей, и держать её означало бы тарифицировать по правилу,
    // которого больше нет.
    if (!isSupportedPair(pair)) continue
    const cents = Math.round(num(value, -1))
    if (cents >= 0) rates[pair] = cents
  }

  const trialRaw =
    src.trial && typeof src.trial === "object"
      ? (src.trial as Record<string, unknown>)
      : {}
  const lifetime = trialRaw.lifetimeDays
  // Мусор в дате — это «даты нет», а не «сбросить всем»: неразобранное значение
  // не должно превращаться в распоряжение, которого никто не отдавал.
  const resetFrom =
    typeof trialRaw.resetFrom === "string" &&
    Number.isFinite(Date.parse(trialRaw.resetFrom))
      ? trialRaw.resetFrom
      : null
  return {
    rates,
    marginPct: num(src.marginPct, d.marginPct),
    minAdmitUnits: meterMap(src.minAdmitUnits, d.minAdmitUnits),
    defaultEstimateUnits: meterMap(src.defaultEstimateUnits, d.defaultEstimateUnits),
    overdraftLimitCents: Math.round(num(src.overdraftLimitCents, d.overdraftLimitCents)),
    trial: {
      enabled: trialRaw.enabled === true,
      amountCents: Math.round(num(trialRaw.amountCents, d.trial.amountCents)),
      lifetimeDays:
        lifetime == null ? null : Math.max(1, Math.round(num(lifetime, 1))),
      resetFrom,
    },
    enforceForOwnProjects: src.enforceForOwnProjects === true,
    vendorCurrency:
      typeof src.vendorCurrency === "string" && src.vendorCurrency.trim()
        ? src.vendorCurrency.trim().toUpperCase()
        : d.vendorCurrency,
    fxAdjustPct: num(src.fxAdjustPct, d.fxAdjustPct),
  }
}

export async function readBillingSettings(): Promise<{
  settings: BillingSettings
  revision: number
}> {
  const result = await query<{ settings: unknown; revision: number }>(
    `SELECT settings, revision FROM billing_settings WHERE id = $1`,
    [SINGLETON],
  )
  const row = result.rows[0]
  // Строки нет — миграция накачена, а INSERT почему-то не прошёл. Отдаём
  // умолчания: без ставок ничего не тарифицируется, то есть безопасно.
  if (!row) return { settings: DEFAULT_BILLING_SETTINGS, revision: 0 }
  return { settings: normalizeSettings(row.settings), revision: row.revision }
}

/**
 * Запись с проверкой ревизии. `baseRevision` — та, что клиент видел при чтении;
 * разошлась — отказ, а не молчаливое затирание чужой правки.
 */
export async function writeBillingSettings(input: {
  settings: BillingSettings
  baseRevision: number
  actorUserId: string
}): Promise<WriteResult> {
  const next = normalizeSettings(input.settings)
  const result = await query<{ settings: unknown; revision: number }>(
    `UPDATE billing_settings
        SET settings = $1::jsonb,
            revision = revision + 1,
            updated_by = $2,
            updated_at = NOW()
      WHERE id = $3
        AND revision = $4
      RETURNING settings, revision`,
    [JSON.stringify(next), input.actorUserId, SINGLETON, input.baseRevision],
  )

  if (result.rowCount === 1) {
    const row = result.rows[0]!
    return { ok: true, settings: normalizeSettings(row.settings), revision: row.revision }
  }

  const current = await readBillingSettings()
  return { ok: false, reason: "revision-conflict", ...current }
}

/**
 * Ставка за единицу по паре осей. `null` — пара не тарифицируется.
 *
 * Отдельно от `settings.rates[pair]` потому, что «ставки нет» и «ставка ноль» —
 * разные ответы: первый останавливает обработку, второй делает её бесплатной.
 */
export function rateForPair(
  settings: BillingSettings,
  pair: PayPair,
): number | null {
  const value = settings.rates[pair]
  return typeof value === "number" ? value : null
}
