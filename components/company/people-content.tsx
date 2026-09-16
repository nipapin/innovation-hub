"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { tf, useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CompanyRole } from "@/lib/domain-types"

type Person = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
  isActive: boolean
}

/**
 * «Сотрудники» — роли внутри компании.
 *
 * Заводить и переводить людей отсюда нельзя: перевод меняет плательщика и
 * снимает права, то есть задевает деньги и принадлежность, и живёт он в нашей
 * админке (план §6.6). Здесь — только роль в компании.
 */
export function CompanyPeople({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/people", { cache: "no-store" })
      if (res.ok) setPeople(await res.json())
      else toast.error(t.coLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const changeRole = async (userId: string, companyRole: CompanyRole) => {
    setBusy(true)
    try {
      const res = await fetch("/api/company/people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, companyRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(
          body.code === "last-owner"
            ? t.coPeopleLastOwner
            : body.code === "self"
              ? t.coPeopleSelfRole
              : t.coSaveFailed,
        )
        return
      }
      toast.success(t.coSaved)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t.coPeopleTitle} description={t.coPeopleSub}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.coEmpty}</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {people.map((person) => {
            const isSelf = person.userId === currentUserId
            return (
              <li
                key={person.userId}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {person.email}
                  {person.fullName ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {person.fullName}
                    </span>
                  ) : null}
                </span>
                {!person.isActive ? (
                  <Badge variant="secondary">{t.coPeopleSuspended}</Badge>
                ) : null}
                <Select
                  value={person.companyRole}
                  onValueChange={(value) =>
                    void changeRole(person.userId, value as CompanyRole)
                  }
                  disabled={busy || isSelf}
                >
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t.coRoleMember}</SelectItem>
                    <SelectItem value="admin">{t.coRoleAdmin}</SelectItem>
                    <SelectItem value="owner">{t.coRoleOwner}</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            )
          })}
        </ul>
      )}
      </Section>
      <CompanyOutsiders />
    </div>
  )
}

type Outsider = {
  userId: string
  email: string
  fullName: string
  projectId: string
  projectName: string
  role: string
  invitedByName: string | null
  invitedAt: string
}

/**
 * «Внешние участники» — кто не сотрудник компании, но видит её работу.
 *
 * Раздел появился вместе с тегом `people.invite`: запрет на приглашение
 * посторонних закрывает дорогу вперёд, но тех, кого позвали ДО него, он не
 * показывает. А до этого админ компании не видел их вовсе — ни в одном экране
 * консоли, при том что их обработка идёт с её кошелька.
 *
 * Пусто — раздел не рисуется совсем. Заголовок «Внешних участников нет» на
 * экране сотрудников был бы сообщением о том, что всё в порядке, а такие
 * сообщения перестают читать через неделю.
 */
function CompanyOutsiders() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Outsider[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/company/outsiders", { cache: "no-store" })
      if (!res.ok) return
      const body = (await res.json()) as { outsiders: Outsider[] }
      setRows(body.outsiders)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const revoke = async (row: Outsider) => {
    if (
      !confirm(
        tf(t.coOutsidersRevokeConfirm, {
          name: row.fullName || row.email,
          project: row.projectName,
        }),
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/company/outsiders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: row.projectId, userId: row.userId }),
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      toast.success(t.coOutsidersRevoked)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading || rows.length === 0) return null

  return (
    <Section title={t.coOutsidersTitle} description={t.coOutsidersSub}>
      <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
        {rows.map((row) => (
          <li
            key={`${row.projectId}:${row.userId}`}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {row.fullName || row.email}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {row.projectName} · {row.role}
                {row.invitedByName
                  ? ` · ${tf(t.coOutsidersInvitedBy, { name: row.invitedByName })}`
                  : ""}
              </span>
            </span>
            <Badge variant="secondary">{t.coOutsidersBadge}</Badge>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void revoke(row)}
            >
              {t.coOutsidersRevoke}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
