import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
} from "@/lib/auth"
import {
  buildGoogleRedirectUri,
  exchangeCodeForToken,
  fetchGoogleProfile,
  readGoogleOAuthConfig,
} from "@/lib/google-oauth"
import {
  createOAuthUser,
  findUserByEmail,
  findUserByProviderAccount,
  linkProviderToUser,
} from "@/lib/repositories/users"
import { syncUserMeta } from "@/lib/project-storage"

export const dynamic = "force-dynamic"

const GOOGLE_STATE_COOKIE = "google_oauth_state"
const GOOGLE_NEXT_COOKIE = "google_oauth_next"

function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value
}

function clearOAuthCookies(response: NextResponse) {
  // Match the path used when the cookie was set so the browser actually
  // removes it (cookie deletion requires the same path attribute).
  for (const name of [GOOGLE_STATE_COOKIE, GOOGLE_NEXT_COOKIE]) {
    response.cookies.set(name, "", {
      path: "/api/auth/google",
      maxAge: 0,
    })
  }
}

function loginErrorRedirect(request: Request, code: string): NextResponse {
  const target = new URL("/login", request.url)
  target.searchParams.set("error", code)
  const response = NextResponse.redirect(target)
  clearOAuthCookies(response)
  return response
}

export async function GET(request: Request) {
  const config = readGoogleOAuthConfig()
  if (!config) {
    return loginErrorRedirect(request, "google_unconfigured")
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const stateParam = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")

  if (oauthError) {
    return loginErrorRedirect(request, "google_denied")
  }
  if (!code || !stateParam) {
    return loginErrorRedirect(request, "google_invalid_response")
  }

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(GOOGLE_STATE_COOKIE)?.value
  if (!stateCookie || stateCookie !== stateParam) {
    return loginErrorRedirect(request, "google_state_mismatch")
  }

  const nextCookie = cookieStore.get(GOOGLE_NEXT_COOKIE)?.value
  const next = safeNextPath(nextCookie ?? null)

  let profile
  try {
    const token = await exchangeCodeForToken({
      config,
      code,
      redirectUri: buildGoogleRedirectUri(request),
    })
    profile = await fetchGoogleProfile(token.accessToken)
  } catch (error) {
    console.error("[google-oauth] callback failed", error)
    return loginErrorRedirect(request, "google_token_failed")
  }

  if (!profile.emailVerified) {
    return loginErrorRedirect(request, "google_email_unverified")
  }

  const email = profile.email.toLowerCase()
  const fullName =
    profile.name?.trim() ||
    [profile.givenName, profile.familyName].filter(Boolean).join(" ").trim() ||
    email

  let user = await findUserByProviderAccount("google", profile.sub)

  if (!user) {
    const byEmail = await findUserByEmail(email)
    if (byEmail) {
      // Existing local account — link the Google identity to it so the user
      // can sign in with either method afterwards. We never overwrite the
      // password here; the local credentials remain valid.
      const linked = await linkProviderToUser({
        userId: byEmail.id,
        provider: "google",
        providerAccountId: profile.sub,
      })
      if (!linked) {
        return loginErrorRedirect(request, "google_link_failed")
      }
      user = { ...byEmail, authProvider: "google", providerAccountId: profile.sub }
    } else {
      try {
        const created = await createOAuthUser({
          fullName,
          email,
          provider: "google",
          providerAccountId: profile.sub,
        })
        void syncUserMeta({
          userId: created.id,
          email: created.email,
          createdAt: created.createdAt.toISOString(),
        })
        user = {
          ...created,
          passwordHash: null,
          authProvider: "google",
          providerAccountId: profile.sub,
          kind: "person",
        }
      } catch (error) {
        console.error("[google-oauth] failed to create user", error)
        return loginErrorRedirect(request, "google_create_failed")
      }
    }
  }

  if (!user.isActive) {
    return loginErrorRedirect(request, "account_inactive")
  }

  const sessionToken = await createSessionToken({
    sub: user.id,
    role: user.role,
    email: user.email,
  })

  const target = new URL(next, request.url)
  const response = NextResponse.redirect(target)
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, buildSessionCookieConfig())
  clearOAuthCookies(response)
  return response
}
