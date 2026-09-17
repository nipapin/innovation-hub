import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { isCompanyBillingFree } from "@/lib/company-billing-gate"
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
  // Работа компании идёт за наш счёт (docs/COMPANY_SETUP_PANEL_PLAN.md §3.5) —
  // кошелька она не видит вовсе. Проверка ПЕРЕД плательщиком, а не после: у
  // сотрудника такой компании плательщиком стоит её служебный кошелёк, и ветка
  // ниже написала бы ему «за вас платит ООО „Ромашка“» — то есть назвала бы
  // плательщиком того, с кого мы ничего не берём.
  //
  // Настоящий минус на кошельке компании при этом никуда не девается: это цифра
  // нашего вложения (§3.3), и она для нас, а не для них.
  if (await isCompanyBillingFree(auth.userId)) {
    return NextResponse.json({
      balances: { own: 0, gift: 0 },
      reserved: { own: 0, gift: 0 },
      availableOwnCents: 0,
      availableGiftCents: 0,
      overdraftLimitCents: 0,
      capacity: [],
      paidBy: null,
      freeOfCharge: true,
      payingFor: [],
    })
  }

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
      freeOfCharge: false,
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
    freeOfCharge: false,
    payingFor: dependents.map(personLabel),
  })
}
