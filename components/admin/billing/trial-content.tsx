"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, tf, useI18n } from "@/components/account/i18n"
import {
  NumberField,
  Section,
  centsToRubles,
  rublesToCents,
} from "@/components/admin/billing/fields"
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog"
import { GrantLists, type GrantListRow } from "@/components/admin/billing/grant-list"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { TrialSettings } from "@/lib/billing/types"

/**
 * «Тестовый период» — отдельный инструмент со своим тегом `billing.trial`.
 *
 * Решение «дарим ли мы новым пользователям и сколько» маркетинговое, а прайс —
 * коммерческое, и доверять их можно разным людям. Поэтому здесь только четыре
 * вещи: включение кнопки, сумма, срок и состав набора. Ставки — в «Тарифах», и
 * сохранение отсюда их не трогает.
 */

type TemplateRow = {
  projectId: string
  name: string
  cost: { centsPerSec: number | null; charges: number } | null
}

/**
 * Строка активации. Тип общий с «Акциями» — списки разные, а выдача одна и та
 * же строка `billing_grants`, и расходиться их полям не с чего.
 */
type ActivationRow = GrantListRow

type TrialAction = "revoke" | "reset" | "resume"

/** Что подтверждает открытый диалог. `null` — диалога нет. */
type PendingAction = { row: ActivationRow; action: TrialAction }

type PickRow = {
  projectId: string
  name: string
  ownerEmail: string
  isTemplate: boolean
}

export function AdminBillingTrial() {
  const { t, lang } = useI18n()
  const [trial, setTrial] = useState<TrialSettings | null>(null)
  const [revision, setRevision] = useState(0)
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  /**
   * Счётчик перечитки списка активаций. Список грузит себя сам постранично, и
   * дёргать его после команды можно только так: отозванный период обязан
   * переехать в завершённые сразу, а не после перезагрузки страницы.
   */
  const [activationsKey, setActivationsKey] = useState(0)
  const [q, setQ] = useState("")
  const [picks, setPicks] = useState<PickRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/trial", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        trial: TrialSettings
        revision: number
        templates: TemplateRow[]
      }
      setTrial(data.trial)
      setRevision(data.revision)
      setTemplates(data.templates)
      setActivationsKey((prev) => prev + 1)
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Поиск с задержкой: экран открывают, чтобы посмотреть набор, а не искать.
  useEffect(() => {
    if (q.trim().length < 2) {
      setPicks([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/billing/search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        )
        if (!res.ok) return
        const body = (await res.json()) as { projects: PickRow[] }
        setPicks(body.projects)
      } catch {
        // Подсказка поиска — не то, ради чего показывают ошибку.
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  const save = async () => {
    if (!trial) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/billing/trial", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trial, baseRevision: revision }),
      })
      if (res.status === 409) {
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

  const setTemplate = async (projectId: string, isTemplate: boolean) => {
    setBusy(projectId)
    try {
      const res = await fetch(`/api/admin/billing/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTemplate }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.billingSaved)
      setQ("")
      setPicks([])
      await load()
    } catch {
      toast.error(t.billingSaveError)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Отзыв и сброс (П9.1).
   *
   * Одна функция на две команды: они ходят на один адрес и различаются только
   * телом запроса. Разводить их по двум обработчикам значило бы дважды писать
   * один и тот же разбор ответа.
   */
  const runTrialAction = async ({ row, action }: PendingAction) => {
    setBusy(row.grantId)
    try {
      const res = await fetch(`/api/admin/billing/trial/grants/${row.grantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (res.status === 409) {
        // 409 — грант не в том состоянии. Говорим, в каком именно: «не
        // получилось» тут бесполезно, человек не поймёт, что делать дальше.
        const body = (await res.json()) as { code?: string }
        const reasons: Record<string, string> = {
          "not-active": t.billingTrialNotActive,
          "still-open": t.billingTrialStillOpen,
          "already-reset": t.billingTrialAlreadyReset,
          "in-flight": t.billingTrialInFlight,
          "not-provisioning": t.billingTrialNotProvisioning,
          "no-templates": t.billingTrialNoTemplates,
        }
        toast.error(
          (body.code ? reasons[body.code] : null) ?? t.billingTrialActionError,
        )
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      if (action === "revoke") {
        const body = (await res.json()) as { burnedCents: number }
        toast.success(
          tf(t.billingTrialRevoked, {
            amount: formatBalance(body.burnedCents, lang),
          }),
        )
      } else if (action === "resume") {
        toast.success(t.billingTrialResumed)
      } else {
        toast.success(t.billingTrialResetDone)
      }
      await load()
    } catch {
      toast.error(t.billingTrialActionError)
    } finally {
      setBusy(null)
      setPending(null)
    }
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  if (!trial) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.adminBillingTrial}
        description={t.adminBillingTrialDesc}
        help="billing.trial"
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
        title={t.billingTrialTitle}
        description={t.billingTrialDesc}
        help="billing.trial.settings"
      >
        <div className="flex items-center gap-3">
          <Switch
            id="trial-enabled"
            checked={trial.enabled}
            onCheckedChange={(checked) =>
              setTrial({ ...trial, enabled: checked })
            }
          />
          <Label htmlFor="trial-enabled" className="text-sm font-normal">
            {t.billingTrialEnabled}
          </Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="trial-amount"
            label={t.billingTrialAmount}
            value={centsToRubles(trial.amountCents)}
            onChange={(next) =>
              setTrial({ ...trial, amountCents: rublesToCents(next) ?? 0 })
            }
          />
          <NumberField
            id="trial-lifetime"
            label={t.billingTrialLifetime}
            hint={t.billingTrialLifetimeHint}
            value={trial.lifetimeDays == null ? "" : String(trial.lifetimeDays)}
            onChange={(next) => {
              const value = Number(next.trim())
              setTrial({
                ...trial,
                lifetimeDays:
                  next.trim() && Number.isFinite(value) && value > 0
                    ? Math.round(value)
                    : null,
              })
            }}
          />
        </div>
      </Section>

      <Section
        title={t.billingTemplatesTitle}
        description={t.billingTemplatesDesc}
        help="billing.trial.templates"
      >
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground/80">
            {t.billingTemplatesEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {templates.map((row) => (
              <li
                key={row.projectId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {row.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.billingTemplateCost}:{" "}
                  {row.cost?.centsPerSec
                    ? formatBalance(Math.round(row.cost.centsPerSec), lang)
                    : t.billingTemplateNoCost}
                </span>
                <button
                  type="button"
                  disabled={busy === row.projectId}
                  onClick={() => setTemplate(row.projectId, false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  {t.billingTemplateRemove}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground/80">
          {t.billingTemplateCostHint}
        </p>

        <div className="space-y-2">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t.billingTemplateSearch}
              className="pl-9"
            />
          </div>
          {picks.length > 0 ? (
            <ul className="max-w-md divide-y divide-border/50 rounded-lg border border-border/60">
              {picks.map((pick) => (
                <li key={pick.projectId} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {pick.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {pick.ownerEmail}
                    </span>
                  </span>
                  {pick.isTemplate ? null : (
                    <button
                      type="button"
                      disabled={busy === pick.projectId}
                      onClick={() => setTemplate(pick.projectId, true)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2 py-1 text-xs text-primary hover:bg-primary/25 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.billingTemplateAdd}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      <Section
        title={t.billingActivationsTitle}
        description={t.billingActivationsDesc}
        help="billing.trial.activations"
      >
        <GrantLists
          endpoint="/api/admin/billing/trial/activations"
          reloadKey={activationsKey}
          head={
            <tr>
              <th className="pb-2 font-medium">{t.billingActivationUser}</th>
              <th className="pb-2 font-medium">
                {t.billingActivationRegistered}
              </th>
              <th className="pb-2 font-medium">
                {t.billingActivationActivated}
              </th>
              <th className="pb-2 font-medium">{t.billingActivationLeft}</th>
              <th className="pb-2 font-medium">{t.billingActivationStatus}</th>
              <th className="pb-2 text-right font-medium">
                {t.billingActivationActions}
              </th>
            </tr>
          }
          renderRow={(row) => (
            <tr key={row.grantId}>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <span className="truncate text-foreground">{row.email}</span>
                  {/* Номер попытки рядом с почтой, а не отдельной колонкой:
                      серия сбросов у одного человека должна бросаться в глаза
                      так же, как серия однотипных регистраций. */}
                  {row.attempt > 1 ? (
                    <span className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-500">
                      {tf(t.billingActivationAttempt, { n: row.attempt })}
                    </span>
                  ) : null}
                </div>
                {row.fullName ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {row.fullName}
                  </div>
                ) : null}
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">
                {date(row.registeredAt)}
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">
                {date(row.activatedAt)}
              </td>
              <td className="py-2.5 pr-4">
                {formatBalance(row.remainingCents, lang)}
                <span className="ml-1 text-xs text-muted-foreground">
                  / {formatBalance(row.amountCents, lang)}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-muted-foreground">
                {row.status}
                {row.resetAt ? (
                  <div className="text-xs text-amber-500/80">
                    {tf(t.billingActivationResetAt, {
                      date: date(row.resetAt),
                    })}
                  </div>
                ) : null}
              </td>
              <td className="py-2.5 text-right">
                {/* Три команды, а не одна кнопка с тремя смыслами: отзыв про
                    деньги сейчас, сброс про право на будущее, дожим про
                    застрявшую выдачу. Самый частый сценарий — отзыв и сброс по
                    очереди. */}
                <div className="flex justify-end gap-1">
                  {row.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === row.grantId}
                      onClick={() => setPending({ row, action: "revoke" })}
                    >
                      {t.billingTrialRevoke}
                    </Button>
                  ) : null}
                  {/* Дожим без диалога: он ничего не отнимает, а доводит до
                      конца то, что человек запросил сам. Спрашивать
                      подтверждение у безобидной команды — учить нажимать «ок»
                      не глядя там, где рядом стоят опасные. */}
                  {row.status === "provisioning" && !row.resetAt ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === row.grantId}
                      onClick={() => void runTrialAction({ row, action: "resume" })}
                    >
                      {t.billingTrialResume}
                    </Button>
                  ) : null}
                  {/* `provisioning` сюда попадает намеренно: выдача, которая не
                      доехала, — единственное состояние, из которого раньше не
                      было выхода вообще. Идущее копирование отобьёт сервер, а
                      не спрятанная кнопка. */}
                  {!row.resetAt && row.status !== "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === row.grantId}
                      onClick={() => setPending({ row, action: "reset" })}
                    >
                      {t.billingTrialReset}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          )}
        />
      </Section>

      {/* Диалог, а не window.confirm: подтверждение обязано назвать числа —
          сколько сгорит и сколько проектов уже есть. Без них человек нажимает
          «ок» вслепую, а обе команды двигают чужие деньги. */}
      <AdminConfirmDialog
        open={pending !== null}
        destructive
        title={
          pending?.action === "revoke"
            ? tf(t.billingTrialRevokeTitle, { email: pending.row.email })
            : pending
              ? t.billingTrialResetTitle
              : ""
        }
        description={
          pending?.action === "revoke"
            ? tf(t.billingTrialRevokeDesc, {
                amount: formatBalance(pending.row.remainingCents, lang),
              })
            : // У застрявшей выдачи ни копий, ни денег, и общий текст про
              // «проекты прошлого набора» назвал бы ноль там, где вопрос совсем
              // другой: дожать или начать заново.
              pending?.row.status === "provisioning"
              ? tf(t.billingTrialResetStuckDesc, { email: pending.row.email })
              : pending
                ? tf(t.billingTrialResetDesc, {
                    email: pending.row.email,
                    count: pending.row.projectCount,
                  })
                : undefined
        }
        confirmLabel={
          pending?.action === "revoke" ? t.billingTrialRevoke : t.billingTrialReset
        }
        onConfirm={() => {
          if (pending) void runTrialAction(pending)
        }}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      />
    </div>
  )
}
