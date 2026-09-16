import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getFunds } from "@/lib/billing/funds"
import { listDependents, personLabel, readPayer } from "@/lib/billing/payer"
import { approximateCapacity } from "@/lib/billing/purchasing"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  // За кого платит другой, тот денег не видит вовсе
  // (docs/COMPANY_ACCOUNTS_PLAN.md §7.7): личный кошелёк не используется, а
  // чужой ему не показываем. Нули здесь — не остаток, а «не ваше»; интерфейс по
  // `paidBy` вместо сумм пишет, кто платит.
  const payer = await readPayer(auth.userId)
  if (payer) {
    return NextResponse.json({
      balances: { own: 0, gift: 0 },
      reserved: { own: 0, gift: 0 },
      availableOwnCents: 0,
      availableGiftCents: 0,
      overdraftLimitCents: 0,
      capacity: [],
      paidBy: { name: personLabel(payer) },
      payingFor: [],
    })
  }

  const [funds, dependents] = await Promise.all([
    getFunds(auth.userId),
    listDependents(auth.userId),
  ])

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
    reserved: funds.reserved,
    availableOwnCents: funds.availableOwnCents,
    availableGiftCents: funds.availableGiftCents,
    overdraftLimitCents: funds.overdraftLimitCents,
    capacity,
    paidBy: null,
    payingFor: dependents.map(personLabel),
  })
}
