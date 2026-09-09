import type { NextRequest } from "next/server"
import type { Activation, GrantScope } from "@/lib/billing/reports"

/**
 * Разбор и упаковка постраничного списка выдач.
 *
 * Два инструмента — «Тестовый период» и «Акции» — спрашивают одно и то же
 * разными адресами: у них разные теги доступа, но одинаковый вопрос «покажи
 * страницу выданного». Общий разбор параметров держит их ответы одинаковыми:
 * разъехавшиеся `limit` в двух роутах — это разное поведение кнопки «Показать
 * ещё» на двух экранах, где она выглядит одной и той же.
 */

/** Сколько строк отдаём за раз. Столько же добирает «Показать ещё». */
export const GRANT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export function parseGrantListQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const scope: GrantScope = params.get("scope") === "closed" ? "closed" : "active"
  const search = (params.get("q") ?? "").slice(0, 200)
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0)
  const requested = Number(params.get("limit") ?? GRANT_PAGE_SIZE) || GRANT_PAGE_SIZE
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE)

  return {
    limit,
    forQuery: {
      scope,
      search,
      offset,
      // На строку больше запрошенного: «есть ли ещё» отвечается тем же
      // запросом, без второго — COUNT(*) по всем выдачам ради одной кнопки.
      limit: limit + 1,
    },
  }
}

export function serializeGrantList(rows: Activation[], limit: number) {
  const hasMore = rows.length > limit
  return { rows: rows.slice(0, limit), hasMore }
}
