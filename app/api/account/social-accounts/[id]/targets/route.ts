import { NextResponse, type NextRequest } from "next/server"

import { requireUserApi } from "@/lib/admin-auth"
import { findAccount, refreshTargets } from "@/lib/social/accounts"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Каталог целей: сообщества VK, каналы Telegram.
 *
 * GET отдаёт КЭШ — тот, что лежит у аккаунта. Выпадающий список в настройках
 * проекта открывается десятки раз за сессию, и ходить за ним в VK на каждый
 * показ значило бы упереться в лимит запросов там, где ничего не менялось.
 *
 * POST идёт к площадке и обновляет кэш. Это же и единственная проверка живости
 * токена, которую можно сделать не публикуя.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const account = await findAccount({ id, userId: auth.userId })
  if (!account) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }
  return NextResponse.json({
    targets: account.targets,
    targetsAt: account.targetsAt,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const result = await refreshTargets({ id, userId: auth.userId })
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 })
  }
  return NextResponse.json({ account: result.account })
}
