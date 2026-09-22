import { NextResponse } from "next/server"

import { hashPassword } from "@/lib/auth"
import { resetPasswordSchema } from "@/lib/auth-schemas"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { consumePasswordReset } from "@/lib/repositories/password-resets"
import { updateUser } from "@/lib/repositories/users"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const ip = getClientIp(request)

  // Токен — 256 случайных бит, перебрать его нельзя; лимит стоит от потока
  // мусорных запросов, каждый из которых иначе стоил бы двух запросов в базу.
  const limit = checkRateLimit(`reset-password:${ip}`, 10, 15 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec ?? 900) } },
    )
  }

  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Check the form and try again.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const claimed = await consumePasswordReset(parsed.data.token)
    if (!claimed.ok) {
      // Просроченную и выдуманную ссылку человек чинит одинаково — запросив
      // новую, — поэтому текст один. Код причины отдаём отдельно: форма по нему
      // показывает кнопку «запросить заново», а не общий текст ошибки.
      return NextResponse.json(
        {
          message: "This reset link is no longer valid. Request a new one.",
          code: claimed.reason,
        },
        { status: 400 },
      )
    }

    const passwordHash = await hashPassword(parsed.data.password)

    // mustChangePassword гасим здесь же: человек, попавший сюда по ссылке из
    // приглашения, уже задал собственный пароль, и требование сменить его на
    // входе отправило бы его менять только что заданное.
    const updated = await updateUser(claimed.userId, {
      passwordHash,
      mustChangePassword: false,
    })
    if (!updated) {
      return NextResponse.json(
        { message: "Could not update the password. Please try again." },
        { status: 500 },
      )
    }

    // Сессию здесь не выдаём: пароль сменён, и человек входит им сам. Так смена
    // пароля с чужого устройства не оставляет на нём рабочего входа.
    return NextResponse.json(
      { message: "Your password has been updated. You can sign in now." },
      { status: 200 },
    )
  } catch (error) {
    console.error("[auth/reset-password] failed", error)
    const message =
      error instanceof Error && /relation .* does not exist/i.test(error.message)
        ? "Server database is out of date. Run npm run db:migrate on the host."
        : "Could not update the password. Please try again."
    return NextResponse.json({ message }, { status: 500 })
  }
}
