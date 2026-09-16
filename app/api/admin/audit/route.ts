import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  isAuditAction,
  listAuditEvents,
} from "@/lib/repositories/admin-audit"

export const runtime = "nodejs"

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

/**
 * GET /api/admin/audit?limit=&before=&action=&actorId=&targetType=&targetId=
 * — лента, свежее сверху.
 *
 * `targetType` + `targetId` отвечают на вопрос «что происходило с этим
 * аккаунтом»: его задаёт подсказка на строке пользователя и ссылка «весь
 * журнал по нему». Только парой — см. listAuditEvents.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "audit.view")
  if (auth instanceof NextResponse) return auth

  const params = request.nextUrl.searchParams

  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT

  // Курсор приходит в SQL как ::bigint — пускаем только цифры, иначе запрос
  // упадёт на приведении типа и отдаст 500 там, где хватит пустой страницы.
  const rawBefore = params.get("before")
  const before = rawBefore && /^\d+$/.test(rawBefore) ? rawBefore : null

  const rawAction = params.get("action")
  const action = isAuditAction(rawAction) ? rawAction : null

  const { events, nextCursor } = await listAuditEvents({
    limit,
    before,
    action,
    actorId: params.get("actorId") || null,
    targetType: params.get("targetType") || null,
    targetId: params.get("targetId") || null,
  })

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      actorId: event.actorId,
      actorEmail: event.actorEmail,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      targetLabel: event.targetLabel,
      companyId: event.companyId,
      meta: event.meta,
      ip: event.ip,
      createdAt: event.createdAt.toISOString(),
    })),
    nextCursor,
  })
}
