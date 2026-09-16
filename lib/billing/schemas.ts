import { z } from "zod"
import {
  PAY_BASES,
  PAY_METERS,
  SUPPORTED_PAY_PAIRS,
  payPair,
  type PayPair,
} from "@/lib/billing/types"

/**
 * Схемы админских правок биллинга.
 *
 * Пара осей проверяется целиком, а не по одной оси: сочетание бывает
 * синтаксически верным и при этом непосчитаемым (`source × sec` — нужен `srcSec`
 * из схемы v2 архива). Отказ на входе внятнее, чем задача, которую потом нечем
 * тарифицировать.
 */

export const payAxesSchema = z
  .object({
    base: z.enum(PAY_BASES).nullable(),
    meter: z.enum(PAY_METERS).nullable(),
  })
  .refine(
    (value) =>
      value.base === null ||
      (SUPPORTED_PAY_PAIRS as readonly string[]).includes(
        payPair(value.base, value.meter),
      ),
    { message: "Unsupported pay pair." },
  )

export const projectBillingPatchSchema = z.object({
  payAxes: payAxesSchema.optional(),
  /** Ожидаемое количество единиц на элемент. null — считать по истории. */
  estimateUnits: z.number().nonnegative().max(1e9).nullable().optional(),
  isTemplate: z.boolean().optional(),
  templateOrder: z.number().int().min(0).max(9999).nullable().optional(),
})

const rateMapSchema = z.record(
  z.string(),
  z.number().int().nonnegative().max(100_000_000),
)

const meterMapSchema = z.object({
  sec: z.number().nonnegative().max(1e9),
  count: z.number().nonnegative().max(1e9),
  bytes: z.number().nonnegative().max(1e15),
})

export const trialSettingsSchema = z.object({
  enabled: z.boolean(),
  amountCents: z.number().int().min(0).max(1e11),
  lifetimeDays: z.number().int().min(1).max(3650).nullable(),
  /**
   * Дата обновления набора. Строку проверяем на разбираемость, а не просто на
   * тип: непарсящаяся дата тихо отключила бы правило «разрешить заново», и
   * заметили бы это только по тому, что кнопка у людей не вернулась.
   */
  resetFrom: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), {
      message: "Invalid date.",
    })
    .nullable(),
})

/**
 * Правила и цены — всё, кроме тестового периода.
 *
 * Документ настроек один, а распоряжаются им двое: тарифом — `billing.manage`,
 * периодом — `billing.trial`. Поэтому и схемы две, и каждая ПОЛНАЯ в своей
 * части: приняв целый документ от любого из них, мы дали бы одному тегу тихо
 * переписать поля другого — ровно то, ради чего теги и разделяли.
 */
export const billingRulesSchema = z.object({
  rates: rateMapSchema,
  marginPct: z.number().min(0).max(1000),
  minAdmitUnits: meterMapSchema,
  defaultEstimateUnits: meterMapSchema,
  overdraftLimitCents: z.number().int().min(0).max(1e11),
  enforceForOwnProjects: z.boolean(),
  vendorCurrency: z.string().trim().length(3).toUpperCase(),
  fxAdjustPct: z.number().min(-50).max(100),
})

/** Ревизия, которую клиент видел при чтении: разошлась — отказ, а не затирание. */
const revision = z.number().int().min(0)

export const billingRulesWriteSchema = z.object({
  settings: billingRulesSchema,
  baseRevision: revision,
})

export const trialWriteSchema = z.object({
  trial: trialSettingsSchema,
  baseRevision: revision,
})

export function isKnownPair(value: string): value is PayPair {
  return (SUPPORTED_PAY_PAIRS as readonly string[]).includes(value)
}
