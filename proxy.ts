import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { isElevated } from "@/lib/admin-roles"
import { isEnvFeatureEnabled } from "@/lib/features-env"

/**
 * Disable HTML caching where the answer depends on the visitor's session —
 * the admin surface, and the site root once it redirects instead of rendering
 * the public catalog. The public marketing pages and video catalog stay
 * CDN-cacheable.
 */
function withNoCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  return response
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return withNoCache(NextResponse.redirect(new URL(path, request.url)))
}

async function hasSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return false
  const session = await verifySessionToken(token)
  return Boolean(session?.userId)
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  /**
   * Точка входа. На установке без публичной витрины корень сайта нечем занять:
   * показывать пустую страницу — хуже, чем сразу привести человека туда, куда он
   * и шёл. Вошедшего — в кабинет, остальных — на вход.
   *
   * Флаг читается из окружения, а не из базы, намеренно: здесь база недоступна,
   * и это же причина, по которой `public.catalog` объявлен `env`-флагом
   * (lib/features.ts).
   */
  if (pathname === "/") {
    if (isEnvFeatureEnabled("public.catalog")) {
      return NextResponse.next()
    }
    return redirectTo(request, (await hasSession(request)) ? "/account" : "/login")
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return redirectTo(request, "/login")
  }

  const session = await verifySessionToken(token)
  if (!session?.userId || !isElevated(session.role)) {
    // В кабинет, а не на `/`: там его может ждать ещё один редирект, когда
    // витрина выключена, — а вошедшему человеку в любом случае нужен кабинет.
    return redirectTo(request, "/account")
  }

  // Only the cheap JWT check runs here. The authoritative isActive/role
  // re-validation against the database happens once in app/admin/layout.tsx
  // (and in every /api/admin handler via requireAdminApi), so a suspended or
  // demoted admin is still bounced immediately — without paying a Postgres
  // round-trip in the proxy on every admin navigation.
  return withNoCache(NextResponse.next())
}

export const config = {
  matcher: ["/", "/admin/:path*"],
}
