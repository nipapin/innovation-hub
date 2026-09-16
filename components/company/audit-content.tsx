"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Section } from "@/components/admin/billing/fields"
import { ACTION_META, TONE_CLASS } from "@/components/admin/audit/action-meta"
import { Button } from "@/components/ui/button"
import { isAuditAction } from "@/lib/audit-actions"
import { cn } from "@/lib/utils"

type Event = {
  id: string
  actorEmail: string
  action: string
  targetLabel: string | null
  meta: Record<string, unknown>
  createdAt: string
}

/**
 * Журнал компании. Виден всем её админам — без отдельного тега (план §6.4).
 *
 * Подписи и значки берутся из общей карты действий админки: одно событие должно
 * называться одинаково в обеих лентах, иначе разбор «что случилось» начинается
 * со сверки словарей.
 */
export function CompanyAudit() {
  const { t, lang } = useI18n()
  const ta = useAdminI18n()
  const [events, setEvents] = useState<Event[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/audit", { cache: "no-store" })
      if (!res.ok) return
      const body = (await res.json()) as { events: Event[]; nextCursor: string | null }
      setEvents(body.events)
      setCursor(body.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    if (!cursor) return
    setMore(true)
    try {
      const res = await fetch(
        `/api/company/audit?before=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const body = (await res.json()) as { events: Event[]; nextCursor: string | null }
      setEvents((prev) => [...prev, ...body.events])
      setCursor(body.nextCursor)
    } finally {
      setMore(false)
    }
  }

  return (
    <Section title={t.coAuditTitle} description={t.coAuditSub}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.coAuditEmpty}</p>
      ) : (
        <>
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
            {events.map((event) => {
              const meta = isAuditAction(event.action)
                ? ACTION_META[event.action]
                : null
              const Icon = meta?.icon
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                      meta ? TONE_CLASS[meta.tone] : "bg-primary/10 text-primary",
                    )}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {meta ? ta[meta.labelKey] : event.action}
                    {event.targetLabel ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {event.targetLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {event.actorEmail}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString(lang)}
                  </span>
                </li>
              )
            })}
          </ul>
          {cursor ? (
            <Button
              variant="outline"
              size="sm"
              disabled={more}
              onClick={() => void loadMore()}
            >
              {more ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.coAuditMore}
            </Button>
          ) : null}
        </>
      )}
    </Section>
  )
}
