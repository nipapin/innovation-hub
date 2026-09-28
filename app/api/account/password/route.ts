import { NextResponse } from "next/server"
import { changePasswordSchema } from "@/lib/account-schemas"
import { hashPassword, verifyPassword } from "@/lib/auth"
import { getCurrentUser, getSessionLogin } from "@/lib/admin-auth"
import { findLoginById, updateUser } from "@/lib/repositories/users"

export async function POST(request: Request) {
  const current = await getCurrentUser()
  if (!current) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  if (!current.isActive) {
    return NextResponse.json(
      { message: "Account is inactive." },
      { status: 403 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = changePasswordSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid password change request.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  // Пароль один — у входа, из какого бы профиля его ни меняли
  // (docs/MULTI_COMPANY_PROFILES_PLAN.md §5.3). Вход берём по сессии, а не по
  // почте текущего профиля: почта у входа и подпрофилей одна, и поиск по ней
  // однажды попал бы не в ту строку.
  const session = await getSessionLogin()
  const full = session ? await findLoginById(session.loginUserId) : null
  if (!full) {
    return NextResponse.json(
      { message: "Account no longer exists." },
      { status: 404 },
    )
  }

  if (!full.passwordHash) {
    return NextResponse.json(
      {
        message:
          "This account does not have a password yet. It was created via single sign-on.",
      },
      { status: 400 },
    )
  }

  const matches = await verifyPassword(parsed.data.currentPassword, full.passwordHash)
  if (!matches) {
    return NextResponse.json(
      { message: "Current password is incorrect." },
      { status: 400 },
    )
  }

  const passwordHash = await hashPassword(parsed.data.newPassword)
  const updated = await updateUser(full.id, {
    passwordHash,
    mustChangePassword: false,
  })
  if (!updated) {
    return NextResponse.json(
      { message: "Unable to update your password right now." },
      { status: 500 },
    )
  }

  return NextResponse.json({ message: "Password updated." })
}
