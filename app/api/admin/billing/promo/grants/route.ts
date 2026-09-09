import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listGrants } from "@/lib/billing/reports"
import { parseGrantListQuery, serializeGrantList } from "@/lib/billing/grant-list"

export const runtime = "nodejs"

/**
 * Все выданные акции — общим списком, а не только по выбранному человеку.
 *
 * До него ответ на вопрос «кому мы вообще раздавали и сколько ещё живёт»
 * существовал только в базе: инструмент устроен вокруг выдачи конкретному
 * человеку, и его история открывалась, лишь когда этого человека уже нашли.
 * То есть увидеть выданное можно было, только заранее зная, кому оно выдано.
 *
 * Тег `billing.promo`, тот же, которым раздают: смотреть выданное — часть той
 * же ответственности.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const params = parseGrantListQuery(request)
  const rows = await listGrants({ kind: "targeted", ...params.forQuery })
  return NextResponse.json(serializeGrantList(rows, params.limit))
}
