import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listGrants } from "@/lib/billing/reports"
import { parseGrantListQuery, serializeGrantList } from "@/lib/billing/grant-list"

export const runtime = "nodejs"

/**
 * Активации тестового периода: страницами, с поиском и делением на действующие
 * и завершённые.
 *
 * Отдельный адрес, а не поле в настройках периода: настройки открывают, чтобы
 * поменять сумму, и тащить вместе с ними всю историю выдач — платить за то,
 * чего не просили. Список растёт без потолка, поэтому и страницы.
 *
 * Тег тот же, `billing.trial`: кто распоряжается выдачей, тот и смотрит, кому
 * она досталась.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.trial")
  if (auth instanceof NextResponse) return auth

  const params = parseGrantListQuery(request)
  const rows = await listGrants({ kind: "trial", ...params.forQuery })
  return NextResponse.json(serializeGrantList(rows, params.limit))
}
