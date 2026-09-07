"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, tf, useI18n } from "@/components/account/i18n"
import {
  NumberField,
  Section,
  rublesToCents,
} from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * «Акции и подарки» — адресное начисление одному человеку.
 *
 * Тег свой, `billing.promo`: раздача денег конкретным людям и переписывание
 * прайса для всего сайта — разные полномочия. Ограничение «один раз на
 * человека» здесь не действует: оно про самообслуживание по кнопке, а не про
 * распоряжение администратора.
 *
 * Порядок на экране повторяет порядок решения: сначала кому, потом сколько и
 * насколько, и только потом — где именно действует.
 */

type UserPick = {
  userId: string
  email: string
  fullName: string
  balanceOwnCents: number
  balanceGiftCents: number
}

type ProjectRow = { projectId: string; name: string; isArchived: boolean }

type GrantRow = {
  grantId: string
  kind: string
  status: string
  amountCents: number
  remainingCents: number
  createdAt: string
  expiresAt: string | null
  comment: string
  projectIds: string[]
}

export function AdminBillingPromo() {
  const { t, lang } = useI18n()
  const [q, setQ] = useState("")
  const [users, setUsers] = useState<UserPick[]>([])
  const [picked, setPicked] = useState<UserPick | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [grants, setGrants] = useState<GrantRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState("")
  const [lifetime, setLifetime] = useState("")
  const [comment, setComment] = useState("")
  const [overdraft, setOverdraft] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) {
      setUsers([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/billing/promo?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        )
        if (!res.ok) return
        const body = (await res.json()) as { users: UserPick[] }
        setUsers(body.users)
      } catch {
        // Подсказка поиска — не то, ради чего показывают ошибку.
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  const loadUser = useCallback(async (user: UserPick) => {
    setPicked(user)
    setUsers([])
    setQ("")
    setSelected(new Set())
    try {
      const res = await fetch(
        `/api/admin/billing/promo?userId=${encodeURIComponent(user.userId)}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const body = (await res.json()) as {
        projects: ProjectRow[]
        grants: GrantRow[]
        overdraftLimitCents: number | null
      }
      setProjects(body.projects)
      setGrants(body.grants)
      setOverdraft(
        body.overdraftLimitCents == null
          ? ""
          : String(body.overdraftLimitCents / 100),
      )
    } catch {
      /* пусто */
    }
  }, [])

  const grant = async () => {
    if (!picked) return
    const amountCents = rublesToCents(amount)
    if (!amountCents || amountCents <= 0) return

    setBusy(true)
    try {
      const days = Number(lifetime.trim())
      const res = await fetch("/api/admin/billing/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: picked.userId,
          amountCents,
          lifetimeDays:
            lifetime.trim() && Number.isFinite(days) && days > 0
              ? Math.round(days)
              : null,
          projectIds: [...selected],
          comment: comment.trim(),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.promoGranted)
      setAmount("")
      setComment("")
      setSelected(new Set())
      await loadUser(picked)
    } catch {
      toast.error(t.promoGrantError)
    } finally {
      setBusy(false)
    }
  }

  const saveOverdraft = async () => {
    if (!picked) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/billing/promo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: picked.userId,
          // Пустое поле — вернуть под общий лимит; ноль — запретить кредит.
          limitCents: overdraft.trim() ? (rublesToCents(overdraft) ?? 0) : null,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.promoOverdraftSaved)
    } catch {
      toast.error(t.promoGrantError)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (projectId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.adminBillingPromo}
        description={t.adminBillingPromoDesc}
        help="billing.promo"
      />

      <Section title={t.promoPickUser} help="billing.promo.user">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t.promoUserSearch}
            className="pl-9"
          />
        </div>

        {users.length > 0 ? (
          <ul className="max-w-md divide-y divide-border/50 rounded-lg border border-border/60">
            {users.map((user) => (
              <li key={user.userId}>
                <button
                  type="button"
                  onClick={() => loadUser(user)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {user.email}
                    {user.fullName ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {user.fullName}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="text-sm font-medium text-foreground">
              {picked.email}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tf(t.promoBalance, {
                own: formatBalance(picked.balanceOwnCents, lang),
                gift: formatBalance(picked.balanceGiftCents, lang),
              })}
            </div>
          </div>
        ) : null}
      </Section>

      {picked ? (
        <>
          <Section title={t.promoGrantTitle} help="billing.promo.grant">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="promo-amount"
                label={t.promoAmount}
                value={amount}
                onChange={setAmount}
              />
              <NumberField
                id="promo-lifetime"
                label={t.promoLifetime}
                hint={t.promoLifetimeHint}
                value={lifetime}
                onChange={setLifetime}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="promo-comment"
                className="text-sm font-normal text-muted-foreground"
              >
                {t.promoComment}
              </Label>
              <Input
                id="promo-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="max-w-xl"
              />
              <p className="text-xs text-muted-foreground/80">
                {t.promoCommentHint}
              </p>
            </div>
          </Section>

          <Section
            title={t.promoProjects}
            description={t.promoProjectsHint}
            help="billing.promo.projects"
          >
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground/80">
                {t.promoNoProjects}
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {projects.map((project) => (
                  <li key={project.projectId}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2">
                      <Checkbox
                        checked={selected.has(project.projectId)}
                        onCheckedChange={() => toggle(project.projectId)}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          project.isArchived && "text-muted-foreground",
                        )}
                      >
                        {project.name}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <Button onClick={grant} disabled={busy || !rublesToCents(amount)}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Gift className="mr-2 h-4 w-4" />
              )}
              {t.promoGrant}
            </Button>
          </Section>

          <Section
            title={t.promoOverdraftTitle}
            description={t.promoOverdraftDesc}
            help="billing.promo.overdraft"
          >
            <NumberField
              id="promo-overdraft"
              label={t.promoOverdraftValue}
              value={overdraft}
              onChange={setOverdraft}
            />
            <Button variant="outline" onClick={saveOverdraft} disabled={busy}>
              {t.promoOverdraftSave}
            </Button>
          </Section>

          <Section title={t.promoHistory} help="billing.promo.history">
            {grants.length === 0 ? (
              <p className="text-sm text-muted-foreground/80">
                {t.promoHistoryEmpty}
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {grants.map((row) => (
                  <li
                    key={row.grantId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {date(row.createdAt)}
                    </span>
                    <span className="text-foreground">
                      {row.kind === "trial" ? t.promoKindTrial : t.promoKindTargeted}
                    </span>
                    <span>
                      {formatBalance(row.remainingCents, lang)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        / {formatBalance(row.amountCents, lang)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.projectIds.length === 0
                        ? t.promoEverywhere
                        : `${row.projectIds.length}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.status}
                    </span>
                    {row.comment ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
                        {row.comment}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
    </div>
  )
}
