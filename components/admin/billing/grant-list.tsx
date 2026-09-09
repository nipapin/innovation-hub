"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Список выданных подарков: действующие отдельно, завершённые отдельно.
 *
 * Одна оболочка на «Тестовый период» и «Акции». Списки у них про разное —
 * период выдаёт себе человек, акцию выдаём мы, — но вопрос к списку один и тот
 * же: «что живёт сейчас» и «что было раньше». Две копии этой механики
 * разъехались бы на первой же правке: постраничность и поиск легко сделать
 * по-разному, и тогда одинаковые с виду экраны начали бы вести себя не
 * одинаково.
 *
 * Завершённые скрыты под раскрывашкой и грузятся только при раскрытии. Их со
 * временем становится на порядок больше живых, и открытый по умолчанию список
 * истории означал бы, что за действующими надо прокручивать чужое прошлое.
 */

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

export type GrantListRow = {
  grantId: string
  userId: string
  email: string
  fullName: string
  kind: "trial" | "targeted"
  status: string
  amountCents: number
  remainingCents: number
  activatedAt: string
  expiresAt: string | null
  registeredAt: string
  projectCount: number
  /** Сброшен — значит выдача больше не действует, даже если статус остался. */
  resetAt: string | null
  /** Который это подарок у человека по счёту. */
  attempt: number
  comment: string
}

type Props = {
  /** Адрес списка: `?scope&q&limit&offset` → `{ rows, hasMore }`. */
  endpoint: string
  /** Шапка таблицы — своя у каждого инструмента. */
  head: React.ReactNode
  renderRow: (row: GrantListRow) => React.ReactNode
  /**
   * Меняется — оба списка перечитываются. Нужно после команд над выдачей:
   * отозванный период обязан переехать в завершённые сразу, а не после F5.
   */
  reloadKey?: number
}

export function GrantLists({ endpoint, head, renderRow, reloadKey = 0 }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [closedOpen, setClosedOpen] = useState(false)

  // Поиск с задержкой: печатают по букве, а ходит запрос в базу.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(query.trim()),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [query])

  return (
    <div className="space-y-5">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.billingGrantsSearch}
          className="pl-9"
        />
      </div>

      <GrantGroup
        endpoint={endpoint}
        scope="active"
        search={search}
        head={head}
        renderRow={renderRow}
        title={t.billingGrantsActive}
        empty={search ? t.billingGrantsNotFound : t.billingGrantsNoneActive}
        reloadKey={reloadKey}
      />

      <div>
        <button
          type="button"
          onClick={() => setClosedOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {closedOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {t.billingGrantsClosed}
        </button>
        {/* Смонтирована только раскрытой: это и есть «грузим по запросу».
            Держать её загруженной и спрятанной значило бы платить за историю
            каждым открытием экрана. */}
        {closedOpen ? (
          <div className="mt-3">
            <GrantGroup
              endpoint={endpoint}
              scope="closed"
              search={search}
              head={head}
              renderRow={renderRow}
              empty={search ? t.billingGrantsNotFound : t.billingGrantsNoneClosed}
              reloadKey={reloadKey}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function GrantGroup({
  endpoint,
  scope,
  search,
  head,
  renderRow,
  title,
  empty,
  reloadKey,
}: {
  endpoint: string
  scope: "active" | "closed"
  search: string
  head: React.ReactNode
  renderRow: (row: GrantListRow) => React.ReactNode
  title?: string
  empty: string
  reloadKey: number
}) {
  const { t } = useI18n()
  const [rows, setRows] = useState<GrantListRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const qs = new URLSearchParams({
        scope,
        q: search,
        limit: String(limit),
        offset: String(offset),
      })
      const res = await fetch(`${endpoint}?${qs.toString()}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as { rows: GrantListRow[]; hasMore: boolean }
    },
    [endpoint, scope, search],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchPage(0, PAGE_SIZE)
      .then((data) => {
        if (cancelled) return
        setRows(data.rows)
        setHasMore(data.hasMore)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage, reloadKey])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const data = await fetchPage(rows.length, PAGE_SIZE)
      setRows((prev) => [...prev, ...data.rows])
      setHasMore(data.hasMore)
    } catch {
      // Молча: страница на месте, кнопку можно нажать ещё раз.
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div>
      {title ? (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {/* «20+» честнее точного числа: страницу мы посчитали, всю базу — нет. */}
          {rows.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {rows.length}
              {hasMore ? "+" : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground/80">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              {head}
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row) => renderRow(row))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className={cn("mt-3", loadingMore && "opacity-70")}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t.billingGrantsMore}
        </Button>
      ) : null}
    </div>
  )
}
