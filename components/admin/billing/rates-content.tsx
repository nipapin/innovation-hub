"use client"

import { useCallback, useEffect, useState } from "react"
import { Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { tf, useI18n, type DictKey } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  NumberField,
  Section,
  centsToRubles,
  rublesToCents,
} from "@/components/admin/billing/fields"
import {
  ALL_PAY_PAIRS,
  PAIR_PENDING_DATA,
  PAY_METERS,
  SUPPORTED_PAY_PAIRS,
  VENDOR_CURRENCIES,
  isSupportedPair,
  type BillingSettings,
  type PayMeter,
} from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * «Тарифы» — распоряжения о деньгах для всего сайта.
 *
 * Все правки действуют только вперёд: в транзакции лежит применённая ставка, а
 * не ссылка на текущую. Поэтому форма ничего не пересчитывает задним числом и
 * не показывает, «как было бы» — это привело бы к ожиданию, что прошлое можно
 * переиграть.
 */

/** Подписи пар — по одному ключу словаря на пару, а не склейка из двух осей. */
/**
 * Ставки читаются решёткой «от чего × в чём», а не плоским списком: так видно,
 * что клеток восемь, а считаются сегодня шесть, и почему именно эти две пусты.
 */
const BASE_ROWS = [
  { base: "source", labelKey: "billingBaseSource" },
  { base: "output", labelKey: "billingBaseOutput" },
  { base: "render", labelKey: "billingBaseRender" },
] as const satisfies readonly { base: string; labelKey: DictKey }[]

/** Столбцы решётки: единица названа целиком, иначе «байты» читаются как байты. */
const METER_LABEL: Record<PayMeter, DictKey> = {
  sec: "billingMeterSec",
  count: "billingMeterCount",
  bytes: "billingMeterBytes",
}

/** Пороги и оценки — там уже понятно, о чём речь, и длинная подпись мешает. */
const METER_SHORT: Record<PayMeter, DictKey> = {
  sec: "meterShortSec",
  count: "meterShortCount",
  bytes: "meterShortMb",
}

export function AdminBillingRates() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  /**
   * Ставки держим строками, а не числами: пустое поле означает «пара не
   * тарифицируется», и приведение к числу на каждом нажатии стёрло бы разницу
   * между пустым и нулём.
   */
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({})
  /** Курс, по которому сейчас пересчитывается себестоимость. Читается, не правится. */
  const [rate, setRate] = useState<{
    rateDay: string
    rate: number
    source: string
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/settings", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        settings: BillingSettings
        revision: number
        rate: { rateDay: string; rate: number; source: string } | null
      }
      setSettings(data.settings)
      setRevision(data.revision)
      setRateDrafts(
        Object.fromEntries(
          SUPPORTED_PAY_PAIRS.map((pair) => [
            pair,
            centsToRubles(data.settings.rates[pair]),
          ]),
        ),
      )
      setRate(data.rate ?? null)
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const patch = (next: Partial<BillingSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const rates: Record<string, number> = {}
      // Только считаемые пары: у заблокированных поля нет, и записывать по ним
      // ставку значило бы обещать тариф, по которому нечего посчитать.
      for (const pair of SUPPORTED_PAY_PAIRS.filter(isSupportedPair)) {
        const cents = rublesToCents(rateDrafts[pair] ?? "")
        if (cents != null) rates[pair] = cents
      }

      const res = await fetch("/api/admin/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Период сюда не попадает намеренно: у него свой тег и свой роут, а
        // отправив весь документ, «Тарифы» переписали бы чужую половину.
        body: JSON.stringify({
          settings: {
            rates,
            marginPct: settings.marginPct,
            minAdmitUnits: settings.minAdmitUnits,
            defaultEstimateUnits: settings.defaultEstimateUnits,
            overdraftLimitCents: settings.overdraftLimitCents,
            enforceForOwnProjects: settings.enforceForOwnProjects,
            vendorCurrency: settings.vendorCurrency,
            fxAdjustPct: settings.fxAdjustPct,
          },
          baseRevision: revision,
        }),
      })

      if (res.status === 409) {
        // Ревизия разошлась — показываем актуальное, а не молча перетираем
        // чужую правку своей формой.
        toast.error(t.billingConflict)
        await load()
        return
      }
      if (!res.ok) throw new Error(String(res.status))

      const data = (await res.json()) as { revision: number }
      setRevision(data.revision)
      toast.success(t.billingSaved)
    } catch {
      toast.error(t.billingSaveError)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const s = settings

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.adminBillingRates}
        description={t.adminBillingRatesDesc}
        help="billing.rates"
        actions={
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.billingSaving}
              </>
            ) : (
              t.billingSave
            )}
          </Button>
        }
      />

      <Section
        title={t.billingRatesTitle}
        description={t.billingRatesDesc}
        help="billing.rates.grid"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-x-3 border-spacing-y-2">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="font-medium">{t.billingRatesGridBase}</th>
                {PAY_METERS.map((meter) => (
                  <th key={meter} className="font-medium">
                    {t[METER_LABEL[meter]]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BASE_ROWS.map((row) => (
                <tr key={row.base}>
                  <td className="whitespace-nowrap align-middle text-sm text-foreground">
                    {t[row.labelKey]}
                  </td>
                  {PAY_METERS.map((meter) => {
                    const pair = `${row.base}:${meter}`
                    const known = (ALL_PAY_PAIRS as readonly string[]).includes(pair)
                    // Клетки, которой не бывает по смыслу (время в штуках),
                    // просто нет — пустая ячейка честнее прочерка.
                    if (!known) return <td key={meter} />
                    // Пара, готовая у нас и ждущая поля от машины: ставку
                    // задать можно, но пообещать списание сегодня — нет.
                    const pending = PAIR_PENDING_DATA[pair as never]
                    return (
                      <td key={meter} className="align-middle">
                        <Input
                          inputMode="decimal"
                          value={rateDrafts[pair] ?? ""}
                          placeholder="—"
                          onChange={(event) =>
                            setRateDrafts((prev) => ({
                              ...prev,
                              [pair]: event.target.value,
                            }))
                          }
                          className="max-w-[11rem]"
                        />
                        {pending ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* Значок, а не абзац под полем: объяснение нужно
                                  один раз, а место в таблице занимало бы всегда
                                  и разъезжало строки. */}
                              <button
                                type="button"
                                aria-label={t.billingPendingSrcSec}
                                className="mt-1 inline-flex items-center gap-1 text-xs text-warning"
                              >
                                <Info className="h-3.5 w-3.5" />
                                {t.billingPendingShort}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs leading-snug">
                              {t.billingPendingSrcSec}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <td className="whitespace-nowrap align-middle text-sm text-foreground">
                  {t.billingBaseFixed}
                </td>
                <td className="align-middle">
                  <Input
                    inputMode="decimal"
                    value={rateDrafts.fixed ?? ""}
                    placeholder="—"
                    onChange={(event) =>
                      setRateDrafts((prev) => ({
                        ...prev,
                        fixed: event.target.value,
                      }))
                    }
                    className="max-w-[11rem]"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={t.billingVendorTitle}
        description={t.billingVendorDesc}
        help="billing.rates.vendor"
      >
        <NumberField
          id="margin"
          label={t.billingMarginPct}
          hint={t.billingMarginDesc}
          value={String(s.marginPct)}
          onChange={(next) => patch({ marginPct: Number(next) || 0 })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="vendor-currency"
              className="text-sm font-normal text-muted-foreground"
            >
              {t.billingVendorCurrencyLabel}
            </Label>
            {/* Список, а не поле ввода: курс мы тянем у ЦБ, и валюта, которой
                там нет, молча осталась бы без пересчёта. */}
            <select
              id="vendor-currency"
              value={s.vendorCurrency}
              onChange={(event) => patch({ vendorCurrency: event.target.value })}
              className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            >
              {VENDOR_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground/80">
              {rate
                ? tf(t.billingRateNow, {
                    day: rate.rateDay,
                    rate: rate.rate.toFixed(4),
                  })
                : t.billingRateNone}
            </p>
            {/* Поле живёт только ради старого пути, где нода присылает
                `total_cost` одним числом. У сервисов с построчным учётом валюта
                берётся из карточки сервиса, и это надо говорить прямо: иначе
                вопрос «почему валюта задаётся в двух местах» возвращается. */}
            <p className="text-xs text-amber-500/80">
              {t.billingVendorCurrencyFallback}
            </p>
          </div>
          <NumberField
            id="fx-adjust"
            label={t.billingFxAdjust}
            hint={t.billingFxDesc}
            value={String(s.fxAdjustPct)}
            onChange={(next) => patch({ fxAdjustPct: Number(next) || 0 })}
          />
        </div>
      </Section>

      <Section title={t.billingLimitsTitle} help="billing.rates.limits">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{t.billingMinAdmit}</p>
          <p className="max-w-3xl text-xs text-muted-foreground/80">
            {t.billingMinAdmitDesc}
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-3">
            {PAY_METERS.map((meter) => (
              <NumberField
                key={meter}
                id={`min-${meter}`}
                label={t[METER_SHORT[meter]]}
                value={String(s.minAdmitUnits[meter])}
                onChange={(next) =>
                  patch({
                    minAdmitUnits: {
                      ...s.minAdmitUnits,
                      [meter]: Number(next) || 0,
                    },
                  })
                }
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <p className="text-sm text-muted-foreground">
            {t.billingEstimateTitle}
          </p>
          <p className="max-w-3xl text-xs text-muted-foreground/80">
            {t.billingEstimateWhy}
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-3">
            {PAY_METERS.map((meter) => (
              <NumberField
                key={meter}
                id={`estimate-${meter}`}
                label={t[METER_SHORT[meter]]}
                value={String(s.defaultEstimateUnits[meter])}
                onChange={(next) =>
                  patch({
                    defaultEstimateUnits: {
                      ...s.defaultEstimateUnits,
                      [meter]: Number(next) || 0,
                    },
                  })
                }
              />
            ))}
          </div>
        </div>

        <NumberField
          id="overdraft"
          label={t.billingOverdraft}
          hint={`${t.billingOverdraftSign} · ${t.billingOverdraftDesc}`}
          value={centsToRubles(s.overdraftLimitCents)}
          onChange={(next) =>
            patch({ overdraftLimitCents: rublesToCents(next) ?? 0 })
          }
        />
      </Section>

      <Section
        title={t.billingEnforceTitle}
        description={t.billingEnforceDesc}
        help="billing.rates.enforce"
      >
        <div className="flex items-center gap-3">
          <Switch
            id="enforce"
            checked={s.enforceForOwnProjects}
            onCheckedChange={(checked) =>
              patch({ enforceForOwnProjects: checked })
            }
          />
          <Label htmlFor="enforce" className="text-sm font-normal">
            {t.billingEnforceTitle}
          </Label>
        </div>
      </Section>
    </div>
    </TooltipProvider>
  )
}
