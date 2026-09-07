import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getStatistics } from "@/lib/repositories/statistics"
import { parseStatisticsQuery } from "@/lib/statistics/query"

export const runtime = "nodejs"

/**
 * Та же статистика со скоупом «только своё»: **только свои** проекты,
 * расшаренные не в счёт — они принадлежат другому человеку. `ownerId` берётся
 * из сессии и клиентом не переопределяется.
 *
 * `userId` сюда не передаётся вовсе: в кабинете провала в человека нет, а
 * разрезы по людям и машинам сервер сводит к разрезу по проектам
 * (`getStatistics`). Оси кабинета ограничивает именно он, а не набор кнопок.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const q = parseStatisticsQuery(request.nextUrl.searchParams)
  if (!q) {
    return NextResponse.json({ message: "Invalid query." }, { status: 400 })
  }

  const data = await getStatistics({
    scope: { ownerId: auth.userId, userId: null, projectId: q.projectId },
    breakdown: q.breakdown,
    period: q.period,
  })
  return NextResponse.json(data)
}
