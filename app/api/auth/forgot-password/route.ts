import { NextResponse } from "next/server"

import { forgotPasswordSchema } from "@/lib/auth-schemas"
import { sendPasswordResetEmail } from "@/lib/mail/send"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { issuePasswordReset } from "@/lib/repositories/password-resets"
import { findUserByEmail } from "@/lib/repositories/users"

export const runtime = "nodejs"

/** Столько живёт ссылка — держится в синхроне с TTL в репозитории. */
const EXPIRES_IN_MINUTES = 60

/**
 * Ответ ВСЕГДА одинаковый, есть такой адрес или нет.
 *
 * Разные ответы превратили бы эту ручку в проверку «зарегистрирован ли человек
 * на сайте»: перебором адресов можно было бы собрать список клиентов, не имея
 * ни одного аккаунта. По той же причине одинаково отвечаем на OAuth-аккаунт и
 * на служебный кошелёк компании — письма им не уходят, но наружу это не видно.
 */
const SAME_ANSWER = {
  message: "If that email is registered, a reset link is on its way.",
}

export async function POST(request: Request) {
  const ip = getClientIp(request)

  // Лимит по IP: письмо отправляем мы, а адрес получателя выбирает отправитель
  // запроса — без ограничения этой ручкой можно заваливать чужие ящики нашими
  // письмами и сжигать квоту отправки.
  const limit = checkRateLimit(`forgot-password:${ip}`, 5, 15 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec ?? 900) } },
    )
  }

  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Enter a valid email address." },
      { status: 400 },
    )
  }

  const email = parsed.data.email.toLowerCase()

  try {
    const user = await findUserByEmail(email)

    // Кому ссылка не нужна и не поможет: у служебного кошелька пароля нет и не
    // должно быть, у OAuth-аккаунта вход идёт через провайдера, а заблокированный
    // всё равно не войдёт. Ответ при этом прежний.
    const eligible =
      user &&
      user.kind !== "company_wallet" &&
      user.isActive &&
      Boolean(user.passwordHash)

    if (eligible && user) {
      const { token } = await issuePasswordReset(user.id)
      const sent = await sendPasswordResetEmail({
        to: user.email,
        userName: user.fullName || user.email,
        token,
        expiresInMinutes: EXPIRES_IN_MINUTES,
      })
      if (!sent.ok) {
        // Наружу не показываем — это скажет отправителю, что адрес существует.
        // В лог пишем: это единственный способ узнать, что почта не настроена.
        console.error("[auth/forgot-password] mail failed", sent.error)
      }
    }

    return NextResponse.json(SAME_ANSWER, { status: 200 })
  } catch (error) {
    console.error("[auth/forgot-password] failed", error)
    return NextResponse.json(
      { message: "Could not start a password reset. Please try again." },
      { status: 500 },
    )
  }
}
