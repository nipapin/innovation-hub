import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { getStatistics } from "@/lib/repositories/statistics"
import { parseStatisticsQuery } from "@/lib/statistics/query"

export const runtime = "nodejs"

/** Статистика без скоупа: все пользователи, все проекты, все машины. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "statistics.view")
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
      // Админка видит всё: рамка компании ей ничего не добавила бы, а разрез по
      // компании делается фильтром по человеку.
      companyId: null,
    },
    breakdown: q.breakdown,
    period: q.period,
  })
  return NextResponse.json(data)
}
