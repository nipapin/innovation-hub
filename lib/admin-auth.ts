import { cache } from "react"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById, loginIdOf } from "@/lib/repositories/users"
import { listCapabilitiesFor } from "@/lib/repositories/admin-capabilities"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { UserRecord, UserRole } from "@/lib/domain-types"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { isElevated, isSuperAdmin } from "@/lib/admin-roles"

// React.cache dedupes the JWT verify + DB lookup within a single render
// pass, so layout + page calling getCurrentUser costs one query, not two.
export type CurrentUser = UserRecord & { capabilities: AdminCapability[] }

export const getCurrentUser = cache(async () => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const session = await verifySessionToken(token)
  if (!session?.userId) return null

  const user = await findUserById(session.userId)
  if (!user) return null

  // Теги спрашиваем только у тех, у кого они вообще что-то значат: у обычного
  // пользователя их нет, суперадмину они не проверяются. Лишний запрос на
  // каждый рендер кабинета — не то, за что стоит платить.
  const capabilities =
    isElevated(user.role) && !isSuperAdmin(user.role)
      ? await listCapabilitiesFor(user.id)
      : []

  return { ...user, capabilities }
})

export type SessionLogin = {
  /** Активный профиль — `sub` токена. */
  profileId: string
  /** Вход, под которым открыта сессия. */
  loginUserId: string
}

/**
 * Сессия глазами входа: активный профиль и вход человека
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §4.1).
 *
 * Вход берётся из базы, а не из токена как есть: у сотрудников, переведённых
 * миграцией перевода, в уже выданной куке `sub` — строка, ставшая подпрофилем,
 * а `lid` там нет. Так переключатель у них работает без повторного входа.
 *
 * ГВАРДЫ ЭТО НЕ ЗОВУТ. Права считаются по активному профилю; вход нужен только
 * переключателю, учётным данным, push и возврату из выключенного профиля.
 * Проверка — `npm run profiles:check`.
 *
 * Активность здесь не проверяется намеренно: выведенный из компании человек
 * должен суметь вернуться в «Личное», хотя его активный профиль уже выключен.
 */
export const getSessionLogin = cache(async (): Promise<SessionLogin | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const session = await verifySessionToken(token)
  if (!session?.userId) return null

  const loginUserId = await loginIdOf(session.loginId ?? session.userId)
  if (!loginUserId) return null
  return { profileId: session.userId, loginUserId }
})

export type LoginAdmin = {
  /** Профиль, в котором живут админские права, — сам вход, то есть «Личное». */
  profileId: string
  role: UserRole
  capabilities: AdminCapability[]
}

/**
 * Админ ли ВХОД человека, когда активный профиль — не админ.
 *
 * Права админки принадлежат входу («Личному»), а у профиля компании роль своя
 * и обычная. Меню же обещает админку из любого рабочего места, поэтому оно
 * узнаёт здесь, есть ли что обещать, а сам переход идёт через переключение
 * профиля. Гвардам это НЕ источник прав: они, как и прежде, смотрят только на
 * активный профиль.
 *
 * `null` — активный профиль и есть вход, или вход не админ.
 */
export const getLoginAdmin = cache(async (): Promise<LoginAdmin | null> => {
  const session = await getSessionLogin()
  if (!session || session.profileId === session.loginUserId) return null

  const login = await findUserById(session.loginUserId)
  if (!login || !login.isActive || !isElevated(login.role)) return null

  const capabilities = isSuperAdmin(login.role)
    ? []
    : await listCapabilitiesFor(login.id)
  return { profileId: login.id, role: login.role, capabilities }
})

export type AuthenticatedApiUser = {
  userId: string
  email: string
  role: UserRole
  /** Пусто у всех, кроме админа: суперадмину теги не проверяются. */
  capabilities: AdminCapability[]
}

/** Any signed-in active user (not admin-only). */
export async function requireUserApi(
  request: NextRequest,
): Promise<AuthenticatedApiUser | NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json(
      { message: "Sign in to submit a suggestion." },
      { status: 401 },
    )
  }

  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json(
      { message: "Sign in to submit a suggestion." },
      { status: 401 },
    )
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json(
      { message: "Account is inactive." },
      { status: 403 },
    )
  }

  const capabilities =
    isElevated(user.role) && !isSuperAdmin(user.role)
      ? await listCapabilitiesFor(user.id)
      : []

  return { userId: user.id, email: user.email, role: user.role, capabilities }
}

export type AuthenticatedAdmin = {
  userId: string
  email: string
  role: UserRole
  capabilities: AdminCapability[]
}

/**
 * Гвард админских роутов.
 *
 * Второй аргумент обязателен намеренно, без умолчания. Это единственное, что
 * защищает модель прав от гниения: новый роут в /api/admin/* без решения о теге
 * просто не соберётся, и автору придётся выбрать. С умолчанием через полгода
 * половина роутов оказалась бы в категории «доступно всем», и никто бы этого не
 * заметил.
 *
 * Машинные поверхности сюда не ходят и тегов не имеют — они авторизуются
 * протоколом (lib/storage/auth.ts). См. docs/ADMIN_ROLES_PLAN.md §7.
 */
export async function requireAdminApi(
  request: NextRequest,
  capability: AdminCapability,
): Promise<AuthenticatedAdmin | NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json({ message: "Account is inactive." }, { status: 403 })
  }

  if (!isElevated(user.role)) {
    return NextResponse.json({ message: "Admin access required." }, { status: 403 })
  }

  const capabilities = isSuperAdmin(user.role)
    ? []
    : await listCapabilitiesFor(user.id)

  if (!hasCapability(user.role, capabilities, capability)) {
    return NextResponse.json(
      { message: "You don't have access to this section." },
      { status: 403 },
    )
  }

  // email нужен там, где запись помечается автором — siteUpdatedBy() в сайдкарах
  // проекта пишет, кто именно менял состояние.
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    capabilities,
  }
}
