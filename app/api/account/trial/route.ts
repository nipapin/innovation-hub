import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getFunds } from "@/lib/billing/funds"
import { personLabel, readPayer } from "@/lib/billing/payer"
import { approximateRuntime } from "@/lib/billing/purchasing"
import { readBillingSettings } from "@/lib/billing/settings"
import {
  activateTrial,
  readTrialState,
  type TrialChoice,
} from "@/lib/billing/trial"

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

  const [state, payer] = await Promise.all([
    readTrialState(auth.userId),
    readPayer(auth.userId),
  ])

  // За кого платит другой, тому ни сумм, ни периода: деньги не его
  // (docs/COMPANY_ACCOUNTS_PLAN.md §7.7). Карточка по `paidBy` пишет, кто платит.
  if (payer) {
    return NextResponse.json({
      trial: state,
      balances: { own: 0, gift: 0 },
      availableOwnCents: 0,
      availableGiftCents: 0,
      purchasing: null,
      paidBy: { name: personLabel(payer) },
    })
  }

  const funds = await getFunds(auth.userId)

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
    /**
     * Какому предложению соответствует нынешняя кнопка. Человек может её
     * закрыть, и браузер запоминает именно этот ключ: обновится набор —
     * изменится дата, ключ разойдётся, и кнопка вернётся сама. Иначе отказ от
     * одного набора молча похоронил бы все следующие.
     */
    offerKey: settings.trial.resetFrom ?? "initial",
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  /**
   * Тело необязательно: первый запрос идёт пустым, и если имена свободны,
   * период выдаётся сразу. Выбор приезжает вторым запросом — только когда мы
   * сами ответили `conflicts` и человек решил, что делать.
   */
  const body = (await request.json().catch(() => null)) as {
    strategy?: unknown
    names?: unknown
  } | null

  const strategy =
    body?.strategy === "rename" || body?.strategy === "replace"
      ? body.strategy
      : null

  let choice: TrialChoice | undefined
  if (strategy === "replace") {
    choice = { strategy: "replace" }
  } else if (strategy === "rename") {
    // Имена приходят как `templateId → имя`. Пустых не берём: пустое имя
    // означало бы проект без названия, а не «оставь как есть».
    const raw =
      body?.names && typeof body.names === "object" && !Array.isArray(body.names)
        ? (body.names as Record<string, unknown>)
        : {}
    const names: Record<string, string> = {}
    for (const [templateId, value] of Object.entries(raw)) {
      const name = typeof value === "string" ? value.trim().slice(0, 180) : ""
      if (name) names[templateId] = name
    }
    choice = { strategy: "rename", names }
  }

  const result = await activateTrial(auth.userId, choice)
  if (!result.ok) {
    // 409, а не 403: период не запрещён, он уже израсходован либо ещё не
    // настроен. Разные коды в теле, чтобы интерфейс сказал человеку, что именно.
    //
    // `conflicts` из этого ряда выбивается: это не отказ, а вопрос, и вместе с
    // кодом едет список занятых имён — из него интерфейс строит диалог.
    if (result.reason === "conflicts") {
      return NextResponse.json(
        { code: result.reason, conflicts: result.conflicts },
        { status: 409 },
      )
    }
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
