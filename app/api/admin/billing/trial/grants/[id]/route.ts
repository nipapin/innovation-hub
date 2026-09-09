import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { findGrant, resetTrialGrant, revokeTrialGrant } from "@/lib/billing/grants"
import { resumeTrialProvision } from "@/lib/billing/trial"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Отзыв, сброс и дожим тестового периода (П9.1).
 *
 * Тег `billing.trial`, тот же, которым уже распоряжаются размером подарка и
 * составом набора: «кому и на сколько дарим» и «дарим ли ещё раз» — одно
 * решение и одна ответственность. Отдельного тега сюда не нужно.
 *
 * Команды на одном адресе, а не три ручки: они применяются к одному и тому же
 * гранту, и порядок между ними важен (сначала отзыв, потом сброс). Развести их
 * по разным путям значило бы предложить выполнять их независимо.
 *
 * `resume` — про застрявшую выдачу: копии не доехали, денег нет, отзывать
 * нечего. Это не разновидность сброса, а его противоположность: сброс отдаёт
 * право пройти период заново, дожим доводит до конца уже начатое.
 */
const bodySchema = z.object({
  action: z.enum(["revoke", "reset", "resume"]),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "billing.trial")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const grant = await findGrant(id)
  if (!grant || grant.kind !== "trial") {
    return NextResponse.json({ message: "Trial grant not found." }, { status: 404 })
  }

  // Почта человека — в журнал: через полгода `targetId` гранта не скажет
  // никому ничего, а «отозвали у такого-то» скажет.
  const user = await findUserById(grant.userId)
  const label = user?.email ?? grant.userId

  if (parsed.data.action === "revoke") {
    const result = await revokeTrialGrant({ grantId: id, actorUserId: auth.userId })
    if (!result.ok) {
      // 409: грант существует, но не в том состоянии. Это ответ на вопрос
      // «можно ли отозвать», а не ошибка вызова.
      return NextResponse.json({ code: result.reason }, { status: 409 })
    }
    await auditFrom(request, auth)({
      action: "trial.revoked",
      targetType: "user",
      targetId: grant.userId,
      targetLabel: label,
      meta: { grantId: id, burnedCents: result.burnedCents },
    })
    return NextResponse.json({ ok: true, burnedCents: result.burnedCents })
  }

  if (parsed.data.action === "resume") {
    const result = await resumeTrialProvision(grant)
    if (!result.ok) {
      return NextResponse.json({ code: result.reason }, { status: 409 })
    }
    await auditFrom(request, auth)({
      action: "trial.resumed",
      targetType: "user",
      targetId: grant.userId,
      targetLabel: label,
      meta: { grantId: id, jobId: result.jobId },
    })
    return NextResponse.json({ ok: true, jobId: result.jobId })
  }

  const result = await resetTrialGrant({ grantId: id, actorUserId: auth.userId })
  if (!result.ok) {
    return NextResponse.json({ code: result.reason }, { status: 409 })
  }
  await auditFrom(request, auth)({
    action: "trial.reset",
    targetType: "user",
    targetId: grant.userId,
    targetLabel: label,
    meta: { grantId: id, nextAttempt: result.attempt },
  })
  return NextResponse.json({ ok: true, attempt: result.attempt })
}
