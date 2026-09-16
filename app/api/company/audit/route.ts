import { NextResponse, type NextRequest } from "next/server"
import { requireCompanyApiAnyAdmin } from "@/lib/company-auth"
import { listCompanyAuditEvents } from "@/lib/repositories/admin-audit"

export const runtime = "nodejs"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * Журнал компании — виден ВСЕМ её админам, без отдельного тега (план §6.4).
 *
 * Это названное решение, а не умолчание: запреты без журнала бессмысленны
 * наполовину, и прятать его от тех, кого им же и проверяют, значило бы оставить
 * компанию без единственного способа разобраться, кто что сделал.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApiAnyAdmin(request)
  if (auth instanceof NextResponse) return auth

  const params = request.nextUrl.searchParams

  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT

  // Курсор уходит в SQL как ::bigint — пускаем только цифры, иначе запрос упадёт
  // на приведении типа и отдаст 500 там, где хватит пустой страницы.
  const rawBefore = params.get("before")
  const before = rawBefore && /^\d+$/.test(rawBefore) ? rawBefore : null

  const { events, nextCursor } = await listCompanyAuditEvents({
    companyId: auth.companyId,
    limit,
    before,
  })

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      actorEmail: event.actorEmail,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      targetLabel: event.targetLabel,
      meta: event.meta,
      createdAt: event.createdAt.toISOString(),
    })),
    nextCursor,
  })
}
