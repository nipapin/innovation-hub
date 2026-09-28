import bcrypt from "bcryptjs"
import { SignJWT, jwtVerify } from "jose"
import type { UserRole } from "@/lib/domain-types"

export const SESSION_COOKIE_NAME = "inhub_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

type SessionPayload = {
  /** Активный профиль. Все проверки прав — по нему и только по нему. */
  sub: string
  /**
   * Вход, под которым открыта сессия (docs/MULTI_COMPANY_PROFILES_PLAN.md §4.1).
   * При входе совпадает с `sub`; после переключения `sub` — подпрофиль.
   *
   * Гвардам не нужен и читаться ими не должен: он для переключателя, учётных
   * данных и участия входа в проектах. Токены до плана его не несут — поэтому
   * вход сессии всегда досчитывается по базе (`getSessionLogin`).
   */
  lid: string
  role: UserRole
  email: string
}

let cachedSecret: Uint8Array | null = null
let cachedSecretSource: string | null = null

function getJwtSecret() {
  const secret =
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV !== "production" ? "dev-session-secret-change-me" : null)

  if (!secret) {
    throw new Error("SESSION_SECRET is not configured")
  }

  // Cache the encoded secret so we don't re-encode on every JWT op, but
  // invalidate the cache if the env var changes between calls (HMR/tests).
  if (!cachedSecret || cachedSecretSource !== secret) {
    cachedSecret = new TextEncoder().encode(secret)
    cachedSecretSource = secret
  }
  return cachedSecret
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, email: payload.email, lid: payload.lid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret())
}

export async function verifySessionToken(token: string) {
  try {
    const verified = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    })

    return {
      userId: verified.payload.sub ?? "",
      role: verified.payload.role as UserRole | undefined,
      email: verified.payload.email as string | undefined,
      /** Нет у токенов, выданных до подпрофилей. См. SessionPayload.lid. */
      loginId:
        typeof verified.payload.lid === "string" ? verified.payload.lid : undefined,
    }
  } catch {
    return null
  }
}

export function buildSessionCookieConfig() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  }
}
