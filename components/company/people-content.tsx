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
import { Textarea } from "@/components/ui/textarea"
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
 * Заводить новых — можно (план §7). ПЕРЕВОДИТЬ существующих нельзя: перевод
 * меняет плательщика и снимает права, то есть задевает деньги и принадлежность,
 * и живёт он в нашей админке (план §6.6).
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
      <AddPeople onAdded={load} />
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

type AddOutcome =
  | "created"
  | "mail-failed"
  | "already"
  | "taken"
  | "invalid"
  | "failed"

/**
 * «Добавить сотрудника» — заведение нового аккаунта по почте.
 *
 * Результат показывается построчно и НЕ исчезает сам: в строке «заведён, но
 * письмо не ушло» лежит единственное, что отличает заведённого человека от
 * вошедшего, — и всплывающее уведомление унесло бы это через три секунды.
 */
function AddPeople({ onAdded }: { onAdded: () => Promise<void> | void }) {
  const { t } = useI18n()
  const [raw, setRaw] = useState("")
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<
    { email: string; outcome: AddOutcome }[]
  >([])

  const outcomeText: Record<AddOutcome, string> = {
    created: t.coPeopleAddCreated,
    "mail-failed": t.coPeopleAddMailFailed,
    already: t.coPeopleAddAlready,
    taken: t.coPeopleAddTaken,
    invalid: t.coPeopleAddInvalid,
    failed: t.coPeopleAddFailed,
  }

  // Запятая, точка с запятой, пробел, перевод строки: адреса приходят из письма,
  // из таблицы и из мессенджера, и требовать одного разделителя — значит просить
  // человека почистить список руками.
  const emails = raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  const submit = async () => {
    if (emails.length === 0) return
    setBusy(true)
    try {
      const res = await fetch("/api/company/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      const body = (await res.json()) as {
        results: { email: string; outcome: AddOutcome }[]
      }
      setResults(body.results)
      // Поле чистим только если кого-то действительно завели: иначе человек
      // потеряет список, который вставлял, и наберёт его заново.
      if (body.results.some((row) => row.outcome === "created")) {
        setRaw("")
        await onAdded()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t.coPeopleAddTitle} description={t.coPeopleAddSub}>
      <div className="space-y-3">
        <Textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={t.coPeopleAddPlaceholder}
          rows={3}
          disabled={busy}
        />
        <Button onClick={() => void submit()} disabled={busy || emails.length === 0}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t.coPeopleAddButton}
        </Button>
        {results.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {results.map((row) => (
              <li key={row.email} className="flex flex-wrap gap-x-2">
                <span className="text-foreground">{row.email}</span>
                <span
                  className={
                    row.outcome === "created"
                      ? "text-muted-foreground"
                      : "text-amber-600 dark:text-amber-500"
                  }
                >
                  {outcomeText[row.outcome]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
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
