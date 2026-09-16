import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { setPayer } from "@/lib/billing/payer"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"

/**
 * Кто платит за человека — docs/COMPANY_ACCOUNTS_PLAN.md §7.
 *
 * Тег тот же, что у подарков и лимита овердрафта, `billing.promo`, и по той же
 * причине: решение про одного человека, а по риску — того же порядка, что
 * подарить ему деньги. Здесь даже весомее: после смены счёт за его работу
 * приходит другому, поэтому каждое изменение ложится в журнал.
 */
const schema = z.object({
  userId: z.string().min(1),
  /** null — снять плательщика: человек снова платит сам. */
  payerId: z.string().min(1).nullable(),
})

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await setPayer(parsed.data)
  if (!result.ok) {
    const status =
      result.reason === "not-found" || result.reason === "payer-not-found"
        ? 404
        : 409
    return NextResponse.json({ code: result.reason }, { status })
  }

  if (result.changed) {
    const { userId, payerId } = parsed.data
    const [target, payer] = await Promise.all([
      findUserById(userId),
      payerId ? findUserById(payerId) : Promise.resolve(null),
    ])
    await auditFrom(request, auth)({
      action: "billing.payer_changed",
      targetType: "user",
      targetId: userId,
      targetLabel: target?.email ?? null,
      meta: {
        payerId,
        payerEmail: payer?.email ?? null,
        previousPayerId: result.previousPayerId,
      },
    })
  }

  return NextResponse.json({ ok: true })
}
