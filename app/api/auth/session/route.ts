import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { getSessionLogin } from "@/lib/admin-auth"
import { readTrialState } from "@/lib/billing/trial"
import type { UserRole } from "@/lib/domain-types"
import { resolveSwitchTarget, setProfileSession } from "@/lib/profile-switch"
import { findUserById } from "@/lib/repositories/users"

export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ authenticated: false })
  }

  const session = await verifySessionToken(token)
  if (!session?.userId || !session.email) {
    return NextResponse.json({ authenticated: false })
  }

  let user = await findUserById(session.userId)
  let userId = session.userId
  let email = session.email
  let role = session.role
  let fallback = null as Awaited<ReturnType<typeof resolveSwitchTarget>>
  let loginUserId: string | null = null

  /**
   * Человека вывели из компании, пока он в ней работал
   * (docs/MULTI_COMPANY_PROFILES_PLAN.md §4.4). Вместо «Account is inactive» на
   * каждом запросе возвращаем сессию в «Личное» — вход у него по-прежнему есть.
   */
  if (user && !user.isActive && user.loginUserId !== null) {
    const login = await getSessionLogin()
    if (login) {
      fallback = await resolveSwitchTarget({
        loginUserId: login.loginUserId,
        profileId: login.loginUserId,
      })
      if (fallback) {
        loginUserId = login.loginUserId
        user = await findUserById(fallback.id)
        userId = fallback.id
        email = fallback.email
        role = fallback.role
      }
    }
  }

  /**
   * Доступен ли человеку тестовый период — здесь, а не отдельным запросом:
   * шапка опрашивает сессию на каждой навигации, и второй поход за одним
   * булевым значением был бы дороже, чем поле в этом ответе.
   *
   * Сбой не роняет сессию: не смогли выяснить — считаем, что предлагать нечего.
   * Кнопка, которой нет, лучше страницы, которая не открылась.
   */
  let trialAvailable = false
  try {
    const state = await readTrialState(userId)
    trialAvailable = state.status === "available"
  } catch (error) {
    console.error("[session] trial state failed", error)
  }

  const response = NextResponse.json({
    authenticated: true,
    userId,
    email,
    fullName: user?.fullName ?? null,
    role: (role ?? user?.role ?? "USER") as UserRole,
    trialAvailable,
  })
  if (fallback && loginUserId) {
    return setProfileSession(response, { profile: fallback, loginUserId })
  }
  return response
}
