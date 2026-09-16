import { NextResponse } from "next/server"
import { loginSchema } from "@/lib/auth-schemas"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth"
import { findUserByEmail } from "@/lib/repositories/users"

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null)
    const parsed = loginSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid credentials format.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const user = await findUserByEmail(parsed.data.email.toLowerCase())
    if (!user) {
      return NextResponse.json(
        { message: "Invalid email or password." },
        { status: 401 },
      )
    }

    // Служебный кошелёк компании (docs/COMPANY_ACCOUNTS_PLAN.md §7.3): нет
    // пароля и не должен быть. Ответ такой же, как «нет такого email», а не
    // ветка ниже про OAuth — она про другую причину и путала бы при разборе.
    if (user.kind === "company_wallet") {
      return NextResponse.json(
        { message: "Invalid email or password." },
        { status: 401 },
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { message: "Account is inactive." },
        { status: 403 },
      )
    }

    // OAuth-only accounts (e.g. Google sign-in) have no password hash. Direct
    // them to the matching provider rather than leaking which account exists.
    if (!user.passwordHash) {
      return NextResponse.json(
        {
          message:
            user.authProvider === "google"
              ? "This account uses Google sign-in. Please continue with Google."
              : "This account uses single sign-on. Please use the matching provider.",
        },
        { status: 401 },
      )
    }

    const isValidPassword = await verifyPassword(
      parsed.data.password,
      user.passwordHash,
    )
    if (!isValidPassword) {
      return NextResponse.json(
        { message: "Invalid email or password." },
        { status: 401 },
      )
    }

    const token = await createSessionToken({
      sub: user.id,
      role: user.role,
      email: user.email,
    })

    const response = NextResponse.json(
      {
        message: `Welcome back, ${user.fullName}.`,
        role: user.role,
        mustChangePassword: user.mustChangePassword === true,
      },
      { status: 200 },
    )

    response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
    return response
  } catch (error) {
    console.error("[auth/signin] failed", error)
    const message =
      error instanceof Error && /column .* does not exist/i.test(error.message)
        ? "Server database is out of date. Run npm run db:migrate on the host."
        : "Sign in failed due to a server error. Please try again."
    return NextResponse.json({ message }, { status: 500 })
  }
}
