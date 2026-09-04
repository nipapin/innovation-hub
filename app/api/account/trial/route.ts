import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getFunds } from "@/lib/billing/funds"
import { approximateRuntime } from "@/lib/billing/purchasing"
import { readBillingSettings } from "@/lib/billing/settings"
import { activateTrial, readTrialState } from "@/lib/billing/trial"

export const runtime = "nodejs"

/**
 * Тестовый период — состояние и активация.
 *
 * Только для себя: чужой период не запросить и не выдать. Раздача по решению
 * администратора идёт другим путём — адресным подарком в админском инструменте.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const [state, funds] = await Promise.all([
    readTrialState(auth.userId),
    getFunds(auth.userId),
  ])

  const { settings } = await readBillingSettings()
  // Хронометраж считаем по пробному набору, если он есть: обещание «столько-то
  // минут» относится именно к нашим шаблонам, стоимость секунды в которых мы
  // знаем. Для своих проектов человека — по ним же.
  const projectIds =
    "projectIds" in state && state.projectIds.length > 0
      ? state.projectIds
      : funds.grants.flatMap((g) => g.projectIds)

  const purchasing = await approximateRuntime({
    availableCents: funds.availableGiftCents || funds.availableOwnCents,
    projectIds,
    settings,
  })

  return NextResponse.json({
    trial: state,
    balances: funds.balances,
    availableOwnCents: funds.availableOwnCents,
    availableGiftCents: funds.availableGiftCents,
    purchasing,
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const result = await activateTrial(auth.userId)
  if (!result.ok) {
    // 409, а не 403: период не запрещён, он уже израсходован либо ещё не
    // настроен. Разные коды в теле, чтобы интерфейс сказал человеку, что именно.
    return NextResponse.json({ code: result.reason }, { status: 409 })
  }

  // 202: проекты ещё копируются. Отвечать 200 значило бы обещать готовый
  // кабинет, которого пару секунд не будет.
  //
  // `resumed` — это тот же 202, но по другому поводу: период уже был выдан, а
  // копии не доехали, и мы дожали прошлую попытку. Интерфейсу нужно различать,
  // чтобы не поздравлять человека с активацией второй раз.
  return NextResponse.json(
    { grantId: result.grant.id, jobId: result.jobId, resumed: result.resumed },
    { status: 202 },
  )
}
