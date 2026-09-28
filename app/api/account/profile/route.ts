import { NextResponse } from "next/server"
import { updateProfileSchema } from "@/lib/account-schemas"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
} from "@/lib/auth"
import { getCurrentUser, getSessionLogin } from "@/lib/admin-auth"
import {
  findLoginByEmail,
  listLoginProfiles,
  updateLoginIdentity,
} from "@/lib/repositories/users"
import { syncUserMeta } from "@/lib/project-storage"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  return NextResponse.json({
    id: user.id,
    fullName: user.fullName,
    contactName: user.contactName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    // «Удалить аккаунт» — только в «Личном» (docs/MULTI_COMPANY_PROFILES_PLAN.md
    // §5.3): из профиля компании удалять пришлось бы вход целиком, а человек в
    // этот момент стоит в одном из его рабочих мест.
    isPersonal: user.loginUserId === null,
  })
}

/**
 * Имя, подпись и почта — общие у человека, а не у рабочего места
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §3.3, §5.3).
 *
 * Поэтому правка из любого профиля пишется во вход и копируется во все его
 * подпрофили одной транзакцией: письма компании уходят на ту же почту, по
 * которой человек входит, а статистика не расщепляет его на две подписи.
 */
export async function PATCH(request: Request) {
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
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const parsed = updateProfileSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid profile data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const nextEmail = parsed.data.email
  const emailChanged = nextEmail !== current.email
  if (emailChanged) {
    // Занятость — среди входов: у подпрофилей почта не своя, а копия.
    const existing = await findLoginByEmail(nextEmail)
    if (existing && existing.id !== session.loginUserId) {
      return NextResponse.json(
        { message: "Email is already in use." },
        { status: 409 },
      )
    }
  }

  let updated
  try {
    updated = await updateLoginIdentity(session.loginUserId, {
      fullName: parsed.data.fullName,
      contactName: parsed.data.contactName,
      email: nextEmail,
    })
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "Email is already in use." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Unable to update your profile right now." },
      { status: 500 },
    )
  }

  if (!updated) {
    return NextResponse.json(
      { message: "Account no longer exists." },
      { status: 404 },
    )
  }

  if (emailChanged) {
    // Зеркало метаданных — у каждого профиля своё: проекты подпрофиля лежат
    // под его id, и адрес в них должен совпасть с новым.
    const profiles = await listLoginProfiles(session.loginUserId).catch(() => [])
    for (const profile of profiles) {
      void syncUserMeta({
        userId: profile.id,
        email: updated.email,
        createdAt: updated.createdAt.toISOString(),
      })
    }
  }

  const response = NextResponse.json({
    message: "Profile updated.",
    profile: {
      // Профиль — тот, в котором человек сейчас; поля — общие, со входа.
      id: current.id,
      fullName: updated.fullName,
      contactName: updated.contactName,
      email: updated.email,
      role: current.role,
      isActive: current.isActive,
    },
  })

  // The session cookie carries the email claim, so we re-issue it whenever the
  // email changes; otherwise the header would keep rendering the old address
  // until the cookie expires (up to 7 days). Активный профиль не меняется.
  if (emailChanged) {
    const token = await createSessionToken({
      sub: current.id,
      lid: session.loginUserId,
      role: current.role,
      email: updated.email,
    })
    response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
  }

  return response
}
