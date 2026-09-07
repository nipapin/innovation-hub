import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getFunds } from "@/lib/billing/funds"
import { approximateCapacity } from "@/lib/billing/purchasing"

export const runtime = "nodejs"

/**
 * Кошельки и «на что ещё хватит» — для виджета баланса.
 *
 * Отдельно от `/api/account/trial`: виджет висит в боковой панели на каждой
 * странице, и тянуть ради него состояние тестового периода, шаблоны и активации
 * значило бы платить за то, что виджету не нужно.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const funds = await getFunds(auth.userId)

  // Считаем по проектам, покрытым подарками, если они есть: обещание «столько-то
  // минут» относится к нашим шаблонам, стоимость единицы в которых мы знаем.
  // Иначе — по всем проектам владельца, и тогда основой станет его собственная
  // история списаний.
  const grantProjects = funds.grants.flatMap((g) => g.projectIds)
  const available = funds.availableGiftCents || funds.availableOwnCents

  const capacity = await approximateCapacity({
    availableCents: available,
    projectIds: grantProjects,
    userId: auth.userId,
    settings: funds.settings,
  })

  return NextResponse.json({
    balances: funds.balances,
    // Резерв отдаётся отдельно от остатка, а не вычтенным из него: «остаток
    // 900, из них 400 держат запущенные задачи» — это ответ, а «доступно 500»
    // без второй половины выглядит как пропавшие деньги.
    reserved: funds.reserved,
    availableOwnCents: funds.availableOwnCents,
    availableGiftCents: funds.availableGiftCents,
    overdraftLimitCents: funds.overdraftLimitCents,
    capacity,
  })
}
