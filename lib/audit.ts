import type { NextRequest } from "next/server"
import { getClientIp } from "@/lib/rate-limit"
import {
  recordAuditEvent,
  type AuditAction,
} from "@/lib/repositories/admin-audit"

/**
 * Обёртка над журналом для роутов: подставляет актора и IP один раз, дальше
 * вызов события — одна строка.
 *
 * Возвращаемая функция дожидается вставки. Fire-and-forget был бы соблазнителен
 * (журнал не должен задерживать ответ), но запись в очередь микротасок легко
 * теряется, если процесс перезапускают между действием и логом, а потерянная
 * запись хуже лишних пяти миллисекунд. Бросить она всё равно не может —
 * recordAuditEvent гасит ошибку внутри.
 */
export function auditFrom(
  request: Request | NextRequest,
  actor: { userId: string | null; email: string },
) {
  const ip = getClientIp(request)
  return (input: {
    action: AuditAction
    targetType?: string | null
    targetId?: string | null
    targetLabel?: string | null
    companyId?: string | null
    meta?: Record<string, unknown>
  }) =>
    recordAuditEvent({
      actorId: actor.userId,
      actorEmail: actor.email,
      ip,
      ...input,
    })
}
