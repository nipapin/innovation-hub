import { NextResponse, type NextRequest } from "next/server"

import { getSessionLogin } from "@/lib/admin-auth"
import {
  resolveSwitchTarget,
  safeNextPath,
  setProfileSession,
} from "@/lib/profile-switch"

export const runtime = "nodejs"

/**
 * Переключить активный профиль сессии — docs/MULTI_COMPANY_PROFILES_PLAN.md §4.2.
 *
 * `POST { profileId }` — из переключателя в шапке. Ответ — только «можно / нет»:
 * кабинет после него перезагружается целиком, а не перерисовывается
 * по кусочку (§6), потому что кэша по пользователю в нём много.
 *
 * Журнал не пишем: переключение — обычная работа, и оно утопило бы админские
 * строки (тот же довод, что у `viaCapability` в lib/project-access.ts).
 */
export async function POST(request: NextRequest) {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const payload = (await request.json().catch(() => null)) as {
    profileId?: unknown
  } | null
  const profileId = typeof payload?.profileId === "string" ? payload.profileId : ""
  if (!profileId) {
    return NextResponse.json({ message: "profileId is required." }, { status: 400 })
  }

  const target = await resolveSwitchTarget({
    loginUserId: session.loginUserId,
    profileId,
  })
  // Без подробностей: отказ не должен подтверждать, что чужой профиль есть.
  if (!target) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  return setProfileSession(NextResponse.json({ ok: true, profileId: target.id }), {
    profile: target,
    loginUserId: session.loginUserId,
  })
}

/**
 * `GET ?to=&next=` — для ссылок: из писем, push и страницы проекта (§9.3).
 *
 * Без сессии — на вход с возвратом сюда же. Переключиться нельзя (чужой или
 * выключенный профиль) — просто идём на `next` без переключения: дальше
 * страница сама проверит доступ, как проверила бы без всякой ссылки.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") ?? ""
  const next = safeNextPath(request.nextUrl.searchParams.get("next"))

  const session = await getSessionLogin()
  if (!session) {
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`
    return NextResponse.redirect(
      new URL(`/login?${new URLSearchParams({ next: back }).toString()}`, request.url),
    )
  }

  const redirect = NextResponse.redirect(new URL(next, request.url))
  if (!to || to === session.profileId) return redirect

  const target = await resolveSwitchTarget({
    loginUserId: session.loginUserId,
    profileId: to,
  })
  if (!target) return redirect

  return setProfileSession(redirect, {
    profile: target,
    loginUserId: session.loginUserId,
  })
}
