"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Badge } from "@/components/ui/badge"

type KeyRow = {
  accountId: string
  label: string
  serviceSlug: string
  serviceTitle: string
  status: string
  createdAt: string
}

/**
 * «Ключи внешних сервисов» — учётки компании, метками.
 *
 * Только чтение: сами ключи не покидают сейф, а заводят учётки в «Сервисах»
 * нашей админки, где стоит вся работа с секретами. Второе место, куда можно
 * положить чужой ключ, — это второе место, где его можно положить не туда.
 */
export function CompanyKeys() {
  const { t, lang } = useI18n()
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/company/keys", { cache: "no-store" })
        if (!res.ok) return
        const body = (await res.json()) as { keys: KeyRow[] }
        setKeys(body.keys)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <Section title={t.coKeysTitle} description={t.coKeysSub}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.coKeysEmpty}</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {keys.map((key) => (
            <li key={key.accountId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm">
                {key.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {key.serviceTitle}
                </span>
              </span>
              <Badge variant={key.status === "active" ? "default" : "secondary"}>
                {key.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(key.createdAt).toLocaleDateString(lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t.coKeysHint}</p>
    </Section>
  )
}
