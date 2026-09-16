import { NextResponse, type NextRequest } from "next/server"
import { requireCompanyApi } from "@/lib/company-auth"
import { getStatistics } from "@/lib/repositories/statistics"
import { parseStatisticsQuery } from "@/lib/statistics/query"

export const runtime = "nodejs"

/**
 * Статистика компании — третий режим scope (план §6.5).
 *
 * `companyId` берётся ИЗ ГЕЙТА и клиентом не переопределяется: в разборе
 * запроса его нет вовсе, поэтому подставить чужую компанию параметром нельзя.
 * Человек и проект приходят от клиента и сводятся к допустимым внутри
 * `sanitizeScope`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "statistics.view")
  if (auth instanceof NextResponse) return auth

  const q = parseStatisticsQuery(request.nextUrl.searchParams)
  if (!q) {
    return NextResponse.json({ message: "Invalid query." }, { status: 400 })
  }

  const data = await getStatistics({
    scope: {
      ownerId: null,
      userId: q.userId,
      projectId: q.projectId,
      companyId: auth.companyId,
    },
    breakdown: q.breakdown,
    period: q.period,
  })
  return NextResponse.json(data)
}
