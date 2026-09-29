import { NextResponse } from "next/server"

import { getSessionLogin } from "@/lib/admin-auth"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
} from "@/lib/auth"
import type { UserRole } from "@/lib/domain-types"
import {
  findUserById,
  readLastProfileId,
  rememberLastProfile,
} from "@/lib/repositories/users"

/** Профиль, в который переключаемся: ровно то, что уходит в токен. */
export type SwitchTarget = { id: string; role: UserRole; email: string }

/**
 * Переключение активного профиля сессии — docs/MULTI_COMPANY_PROFILES_PLAN.md §4.2.
 *
 * Общий код роута переключателя и возврата из выключенного профиля (§4.4):
 * правило «куда можно» у них одно, и два его экземпляра однажды разошлись бы.
 */

/**
 * Можно ли этому входу стать этим профилем.
 *
 * Пускаем только в сам вход или в его подпрофиль, и только если активны оба:
 * выключенный профиль — это выведенный из компании человек, а заблокированный
 * вход закрывает все профили. Иначе — `null`, без подробностей: отказ не должен
 * подтверждать, что чужой профиль существует.
 */
export async function resolveSwitchTarget(input: {
  loginUserId: string
  profileId: string
}): Promise<SwitchTarget | null> {
  const [login, profile] = await Promise.all([
    findUserById(input.loginUserId),
    findUserById(input.profileId),
  ])
  if (!login || !login.isActive || login.loginUserId !== null) return null
  if (!profile || !profile.isActive) return null
  const belongs =
    profile.id === input.loginUserId || profile.loginUserId === input.loginUserId
  if (!belongs) return null
  return { id: profile.id, role: profile.role, email: profile.email }
}

/** Поставить на ответ куку сессии этого профиля под этим входом. */
export async function setProfileSession(
  response: NextResponse,
  input: {
    profile: SwitchTarget
    loginUserId: string
  },
): Promise<NextResponse> {
  const token = await createSessionToken({
    sub: input.profile.id,
    lid: input.loginUserId,
    role: input.profile.role,
    email: input.profile.email,
  })
  response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
  return response
}

/**
 * Путь для возврата после переключения — только относительный и только внутри
 * сайта. Всё прочее — `/account`: иначе ссылка «переключить профиль» из письма
 * стала бы открытым редиректом на чужой адрес.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/account"
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/account"
  }
  return value
}

/**
 * Куда уйти странице, открытой по ссылке с `?profile=` — или `null`, если
 * остаёмся (docs/MULTI_COMPANY_PROFILES_PLAN.md §9.3).
 *
 * Профиль переключается, только если из АКТИВНОГО проект не виден: доступ,
 * выданный на вход, работает из любого профиля, и дёргать человека из компании,
 * в которой он сейчас работает, незачем. Чужой профиль — параметр
 * игнорируется, дальше обычная проверка доступа.
 *
 * Куку серверный компонент поставить не может — поэтому через роут.
 */
export async function profileRedirectFor(input: {
  requestedProfileId: string | undefined
  currentProfileId: string
  hasAccess: boolean
  path: string
}): Promise<string | null> {
  const requested = input.requestedProfileId
  if (!requested || requested === input.currentProfileId || input.hasAccess) return null

  const session = await getSessionLogin()
  if (!session) return null
  const target = await resolveSwitchTarget({
    loginUserId: session.loginUserId,
    profileId: requested,
  })
  if (!target) return null

  return `/api/auth/switch-profile?${new URLSearchParams({
    to: target.id,
    next: input.path,
  }).toString()}`
}

/**
 * Куда пустить человека после входа — туда, где он работал в прошлый раз
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §17.6).
 *
 * Аккаунт, заведённый компанией, помечен её профилем с самого заведения, так
 * что и первый вход открывает компанию. Профиль больше не годится (человека
 * вывели из компании, компанию выключили — профиль неактивен) — «Личное».
 */
export async function profileAfterSignIn(login: SwitchTarget): Promise<SwitchTarget> {
  try {
    const lastProfileId = await readLastProfileId(login.id)
    if (!lastProfileId || lastProfileId === login.id) return login
    const target = await resolveSwitchTarget({
      loginUserId: login.id,
      profileId: lastProfileId,
    })
    return target ?? login
  } catch (error) {
    // Не смогли выяснить — впускаем в «Личное»: вход важнее удобства.
    console.error("[profile-switch] last profile lookup failed", error)
    return login
  }
}

/**
 * Запомнить, где человек теперь работает, — для следующего входа. Сбой записи
 * переключение не отменяет: оно уже состоялось.
 */
export async function rememberProfile(loginUserId: string, profileId: string): Promise<void> {
  try {
    await rememberLastProfile(loginUserId, profileId)
  } catch (error) {
    console.error("[profile-switch] remember last profile failed", error)
  }
}
