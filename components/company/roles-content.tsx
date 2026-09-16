"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useI18n, type Dictionary } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Checkbox } from "@/components/ui/checkbox"
import {
  COMPANY_CAPABILITIES,
  type CompanyCapability,
} from "@/lib/company-capabilities"
import type { CompanyRole } from "@/lib/domain-types"

type AdminRow = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
  capabilities: CompanyCapability[]
}

const LABEL_KEY: Record<CompanyCapability, keyof Dictionary> = {
  "wallet.manage": "coCapWallet",
  "statistics.view": "coCapStatistics",
  "people.manage": "coCapPeople",
  "roles.manage": "coCapRoles",
  "keys.manage": "coCapKeys",
  "machines.manage": "coCapMachines",
  "people.invite": "coCapInvite",
}

/**
 * «Права» — выдача тегов внутри компании.
 *
 * Галочки ограничены тем, что есть у самого выдающего (`grantable` с сервера):
 * правило «выдать можно только то, что есть у тебя» (план §4). Владельцу
 * галочки не рисуются вовсе — у него все теги неявно, и строки в таблице стали
 * бы вторым источником правды.
 */
export function CompanyRoles({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n()
  const [people, setPeople] = useState<AdminRow[]>([])
  const [grantable, setGrantable] = useState<CompanyCapability[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/roles", { cache: "no-store" })
      if (!res.ok) {
        toast.error(t.coLoadFailed)
        return
      }
      const body = (await res.json()) as {
        people: AdminRow[]
        grantable: CompanyCapability[]
      }
      setPeople(body.people)
      setGrantable(body.grantable)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (
    person: AdminRow,
    capability: CompanyCapability,
    checked: boolean,
  ) => {
    const next = checked
      ? [...person.capabilities, capability]
      : person.capabilities.filter((c) => c !== capability)

    setBusy(true)
    try {
      const res = await fetch("/api/company/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.userId, capabilities: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(
          body.code === "not-allowed" ? t.coRolesBeyond : t.coSaveFailed,
        )
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t.coRolesTitle} description={t.coRolesSub}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.coRolesNoAdmins}</p>
      ) : (
        <div className="space-y-4">
          {people.map((person) => (
            <div
              key={person.userId}
              className="rounded-lg border border-border/60 p-4"
            >
              <p className="text-sm font-medium text-foreground">
                {person.email}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {person.companyRole === "owner" ? t.coRoleOwner : t.coRoleAdmin}
                </span>
              </p>

              {person.companyRole === "owner" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.coRolesOwnerAll}
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {COMPANY_CAPABILITIES.map((capability) => {
                    const allowed = grantable.includes(capability)
                    const id = `${person.userId}-${capability}`
                    return (
                      <label
                        key={capability}
                        htmlFor={id}
                        className="flex items-center gap-2.5 text-sm data-[muted=true]:opacity-50"
                        data-muted={!allowed}
                      >
                        <Checkbox
                          id={id}
                          checked={person.capabilities.includes(capability)}
                          disabled={
                            busy || !allowed || person.userId === currentUserId
                          }
                          onCheckedChange={(checked) =>
                            void toggle(person, capability, checked === true)
                          }
                        />
                        {t[LABEL_KEY[capability]]}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
