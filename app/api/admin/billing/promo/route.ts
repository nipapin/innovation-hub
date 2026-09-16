import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { createGrant } from "@/lib/billing/grants"
import { listDependents, readPayer } from "@/lib/billing/payer"
import {
  listUserGrants,
  listUserProjects,
  readOverdraftLimit,
  searchUsers,
  setOverdraftLimit,
} from "@/lib/billing/reports"

export const runtime = "nodejs"

/**
 * Акции и адресные подарки.
 *
 * Отдельный тег `billing.promo`, а не общий `billing.manage`: раздача денег
 * конкретным людям и переписывание прайса для всего сайта — разные полномочия,
 * и совмещать их в одном теге означало бы, что человеку, которому доверили
 * начислять акции, заодно открыт тариф.
 *
 * Ограничение «один раз на человека» здесь НЕ действует: оно про
 * самообслуживание по кнопке, а не про распоряжение администратора.
 */
const createSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().positive().max(1e11),
  lifetimeDays: z.number().int().min(1).max(3650).nullable(),
  /** Пустой список — подарок действует в любом проекте этого человека. */
  projectIds: z.array(z.string().min(1)).max(200),
  comment: z.string().trim().max(500),
})

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get("userId")
  if (userId) {
    // Плательщик и подопечные — здесь же, потому что меняют смысл остального:
    // у того, за кого платит другой, подарок ложится на плательщика, а лимит
    // овердрафта не задаётся вовсе (docs/COMPANY_ACCOUNTS_PLAN.md §7.8).
    const [projects, grants, overdraftLimitCents, payer, dependents] =
      await Promise.all([
        listUserProjects(userId),
        listUserGrants(userId),
        readOverdraftLimit(userId),
        readPayer(userId),
        listDependents(userId),
      ])
    return NextResponse.json({
      projects,
      grants,
      overdraftLimitCents,
      payer,
      dependents,
    })
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  // Пустой запрос — пустой список, а не все пользователи разом: экран
  // открывают, чтобы подарить конкретному человеку, а не полистать базу.
  if (q.length < 2) return NextResponse.json({ users: [] })
  return NextResponse.json({ users: await searchUsers(q) })
}

/**
 * Персональный лимит овердрафта.
 *
 * Живёт здесь, а не в «Тарифах»: тариф — правило для всего сайта, а разрешить
 * ЭТОМУ человеку уйти в минус на пять тысяч — решение про него, и по риску оно
 * ровно того же порядка, что подарить ему эти пять тысяч. Значит и тег тот же.
 */
const overdraftSchema = z.object({
  userId: z.string().min(1),
  /** `null` — вернуть человека под общий лимит из «Тарифов». */
  limitCents: z.number().int().min(0).max(1e11).nullable(),
})

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const parsed = overdraftSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // Лимит читается у кошелька, который платит. Задать его тому, за кого платит
  // другой, значит сохранить число, которое ни на что не влияет.
  if (await readPayer(parsed.data.userId)) {
    return NextResponse.json({ code: "paid-by-other" }, { status: 409 })
  }

  await setOverdraftLimit(parsed.data)
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // Проекты — только этого человека. Экран других и не предлагает, но запрос в
  // обход него привязал бы подарок к чужому проекту, где им никто не заплатит.
  const owned = new Set(
    (await listUserProjects(parsed.data.userId)).map((p) => p.projectId),
  )
  if (parsed.data.projectIds.some((id) => !owned.has(id))) {
    return NextResponse.json({ code: "foreign-project" }, { status: 400 })
  }

  // За кого платит другой — тому подарок ложится на кошелёк плательщика:
  // деньги читаются у него, а подарок на кошельке подопечного повис бы
  // невидимым. Проекты тогда обязательны: подарок «в любом проекте» на
  // кошельке плательщика действовал бы во всех проектах всех, за кого он платит.
  const payer = await readPayer(parsed.data.userId)
  if (payer && parsed.data.projectIds.length === 0) {
    return NextResponse.json({ code: "projects-required" }, { status: 400 })
  }

  const grant = await createGrant({
    userId: payer?.userId ?? parsed.data.userId,
    kind: "targeted",
    amountCents: parsed.data.amountCents,
    lifetimeDays: parsed.data.lifetimeDays,
    projectIds: parsed.data.projectIds,
    grantedBy: auth.userId,
    comment: parsed.data.comment,
    // Адресный подарок начисляется сразу: проекты уже существуют, тратить есть
    // где, ждать нечего.
    activateNow: true,
  })

  if (!grant) {
    return NextResponse.json({ message: "Grant was not created." }, { status: 409 })
  }
  return NextResponse.json({ grant }, { status: 201 })
}
