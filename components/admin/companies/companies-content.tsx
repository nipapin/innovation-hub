"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Loader2, LogIn, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { tf, useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CompanyBrandingPanel } from "@/components/admin/companies/branding-panel"
import { CompanySetsPanel } from "@/components/admin/companies/sets-panel"
import { readCompanyFeatures } from "@/lib/company-features"
import { readBranding } from "@/lib/branding"
import { slugify } from "@/lib/slug"

/**
 * «Компании» — этап 3 плана docs/COMPANY_ACCOUNTS_PLAN.md.
 *
 * Компания на этом этапе ещё ничего не открывает своим людям: консоли
 * `/company` нет, это этап 4. Здесь только заведение (вместе со служебным
 * кошельком), перевод людей и выключение — работа суперадмина и `companies.manage`.
 */

type CompanyRow = {
  id: string
  slug: string
  title: string
  isActive: boolean
  memberCount: number
  domain: string | null
  branding: Record<string, unknown>
  /** Мешок настроек компании: отсюда берётся набор проданного (план §2). */
  features: Record<string, unknown>
}

type CompanyRole = "member" | "admin" | "owner"

type MemberRow = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
}

type UserPick = { userId: string; email: string; fullName: string }

function deleteErrorText(
  code: string | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (code) {
    case "has-members":
      return t.companyDeleteHasMembers
    case "wallet-has-ledger":
      return t.companyDeleteHasLedger
    case "wallet-has-dependents":
      return t.companyDeleteHasDependents
    default:
      return t.companyDeleteFailed
  }
}

export function AdminCompanies({
  canEnterConsole,
}: {
  /** Только суперадмину: гейт /api/company/scope чужих не пускает. */
  canEnterConsole: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/companies", { cache: "no-store" })
      if (res.ok) setCompanies(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setActive = async (company: CompanyRow, isActive: boolean) => {
    const res = await fetch(`/api/admin/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) {
      toast.error(t.companyStatusFailed)
      return
    }
    toast.success(isActive ? t.companyEnabled : t.companyDisabled)
    await load()
  }

  const remove = async (company: CompanyRow) => {
    if (!confirm(tf(t.companyDeleteConfirm, { title: company.title }))) return
    const res = await fetch(`/api/admin/companies/${company.id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      toast.error(deleteErrorText(body.code, t))
      return
    }
    toast.success(t.companyDeleted)
    if (selectedId === company.id) setSelectedId(null)
    await load()
  }

  /**
   * Вход в консоль компании глазами её владельца: кука переключателя + переход
   * в `/company`. Тот же механизм, что и селектор в шапке консоли.
   */
  const enter = async (company: CompanyRow) => {
    setEnteringId(company.id)
    try {
      const res = await fetch("/api/company/scope", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id }),
      })
      if (!res.ok) {
        toast.error(t.companyEnterFailed)
        return
      }
      router.push("/company")
    } catch {
      toast.error(t.companyEnterFailed)
    } finally {
      setEnteringId(null)
    }
  }

  const selected = companies.find((c) => c.id === selectedId) ?? null

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={t.adminCompaniesEyebrow}
        title={t.adminCompaniesTitle}
        description={t.adminCompaniesDesc}
        help="companies.overview"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t.companyNew}
          </Button>
        }
      />

      <Section title={t.adminCompaniesTitle}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.companyEmptyList}</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
            {companies.map((company) => (
              <li
                key={company.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                {/* Само название и открывает настройки — отдельной кнопки
                    «Управлять» рядом не было смысла держать: она делала ровно
                    это же. Здесь настоящая <button>, а не строка с onClick,
                    поэтому доступ с клавиатуры от её удаления не пострадал. */}
                <button
                  type="button"
                  onClick={() => setSelectedId(company.id)}
                  className="min-w-0 flex-1 text-left hover:opacity-80"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {company.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {company.slug} · {tf(t.companyMembersCount, { count: company.memberCount })}
                  </span>
                </button>
                <Badge variant={company.isActive ? "default" : "secondary"}>
                  {company.isActive ? t.companyStatusActive : t.companyStatusInactive}
                </Badge>
                <Switch
                  checked={company.isActive}
                  onCheckedChange={(checked) => void setActive(company, checked)}
                />
                {/* «Войти» — посмотреть компанию изнутри, глазами её владельца.
                    Не суперадмину не рисуем: роут scope ему откажет, и кнопка,
                    обещающая отказ, хуже её отсутствия. */}
                {canEnterConsole ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enteringId !== null}
                    onClick={() => void enter(company)}
                  >
                    {enteringId === company.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    {t.companyEnter}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={company.memberCount > 0}
                  onClick={() => void remove(company)}
                  title={company.memberCount > 0 ? t.companyDeleteHasMembers : undefined}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {selected ? (
        <>
          <CompanyMembers
            company={selected}
            onBack={() => setSelectedId(null)}
            onChanged={load}
          />
          <CompanyBrandingPanel
            key={selected.id}
            companyId={selected.id}
            companyTitle={selected.title}
            initial={{
              ...readBranding(selected.branding),
              domain: selected.domain,
            }}
            onSaved={load}
          />
          {/* Набор — отдельной карточкой под оформлением: оформление про то, как
              компания выглядит, набор про то, что ей продано. */}
          <CompanySetsPanel
            key={`sets-${selected.id}`}
            companyId={selected.id}
            initial={{
              tools: readCompanyFeatures(selected.features).companyTools,
              sections: readCompanyFeatures(selected.features).companySections,
              chatSync: readCompanyFeatures(selected.features).chatYouGileSync,
              billingFree: readCompanyFeatures(selected.features).billingFree,
            }}
            onSaved={load}
          />
        </>
      ) : null}

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />
    </div>
  )
}

function CreateCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setTitle("")
      setSlug("")
      setSlugTouched(false)
    }
  }, [open])

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), slug }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(body.code === "slug-taken" ? t.companySlugTaken : t.companyCreateFailed)
        return
      }
      toast.success(t.companyCreated)
      onOpenChange(false)
      onCreated()
    } catch {
      toast.error(t.companyCreateFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t.companyNew}</DialogTitle>
          <DialogDescription>{t.adminCompaniesDesc}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-title">{t.companyTitleLabel}</Label>
            <Input
              id="company-title"
              placeholder={t.companyTitlePlaceholder}
              value={title}
              onChange={(event) => {
                const value = event.target.value
                setTitle(value)
                if (!slugTouched) setSlug(slugify(value))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-slug">{t.companySlugLabel}</Label>
            <Input
              id="company-slug"
              placeholder={t.companySlugPlaceholder}
              value={slug}
              onChange={(event) => {
                setSlugTouched(true)
                setSlug(slugify(event.target.value))
              }}
            />
            <p className="text-[11px] text-muted-foreground">{t.companySlugHint}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim().length < 2 || slug.length < 2}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitting ? t.companyCreating : t.companyCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function transferErrorText(
  code: string | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (code) {
    case "is-wallet":
      return t.companyTransferErrWallet
    case "company-inactive":
      return t.companyTransferErrInactive
    case "not-found":
      return t.companyTransferErrNotFound
    case "has-dependents":
      return t.companyTransferErrDependents
    case "has-open-grants":
      return t.companyTransferErrGrants
    default:
      return t.companyTransferFailed
  }
}

function CompanyMembers({
  company,
  onBack,
  onChanged,
}: {
  company: CompanyRow
  onBack: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<UserPick[]>([])
  const [addRole, setAddRole] = useState<CompanyRole>("member")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/members`, {
        cache: "no-store",
      })
      if (res.ok) setMembers(await res.json())
    } finally {
      setLoading(false)
    }
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/companies/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const body = (await res.json()) as { users: UserPick[] }
        const memberIds = new Set(members.map((m) => m.userId))
        setHits(body.users.filter((user) => !memberIds.has(user.userId)))
      } catch {
        // Подсказка поиска — не то, ради чего показывают ошибку.
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, members])

  const addPerson = async (userId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, companyRole: addRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(transferErrorText(body.code, t))
        return
      }
      setQ("")
      setHits([])
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (userId: string, companyRole: CompanyRole) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, companyRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(transferErrorText(body.code, t))
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member: MemberRow) => {
    if (!confirm(tf(t.companyRemoveConfirm, { email: member.email }))) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/admin/companies/${company.id}/members?userId=${encodeURIComponent(member.userId)}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        toast.error(t.companyTransferFailed)
        return
      }
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title={`${t.companyPeopleTitle} — ${company.title}`}
      description={t.companyPeopleDesc}
      help="companies.people"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        {t.companyBack}
      </Button>

      <p className="text-xs text-muted-foreground">{t.companyWalletHint}</p>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.companyEmptyMembers}</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.email}
                {member.fullName ? (
                  <span className="ml-2 text-xs text-muted-foreground">{member.fullName}</span>
                ) : null}
              </span>
              <Select
                value={member.companyRole}
                onValueChange={(value) => void changeRole(member.userId, value as CompanyRole)}
                disabled={busy}
              >
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t.companyRoleMember}</SelectItem>
                  <SelectItem value="admin">{t.companyRoleAdmin}</SelectItem>
                  <SelectItem value="owner">{t.companyRoleOwner}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void removeMember(member)}
              >
                {t.companyRemove}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 pt-2">
        <Label>{t.companyAddPerson}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t.companySearchPlaceholder}
              className="pl-9"
              disabled={busy}
            />
          </div>
          <Select value={addRole} onValueChange={(value) => setAddRole(value as CompanyRole)}>
            <SelectTrigger className="h-10 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t.companyRoleMember}</SelectItem>
              <SelectItem value="admin">{t.companyRoleAdmin}</SelectItem>
              <SelectItem value="owner">{t.companyRoleOwner}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hits.length > 0 ? (
          <ul className="max-w-md divide-y divide-border/50 rounded-lg border border-border/60">
            {hits.map((user) => (
              <li key={user.userId}>
                <button
                  type="button"
                  onClick={() => void addPerson(user.userId)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/40 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {user.email}
                    {user.fullName ? (
                      <span className="ml-2 text-xs text-muted-foreground">{user.fullName}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}
