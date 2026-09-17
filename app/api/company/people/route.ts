import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import { createAccountByEmail } from "@/lib/invite-account"
import { mailBrandForOwner, sendCompanyWelcomeEmail } from "@/lib/mail/send"
import {
  clearCompanyCapabilities,
  countCompanyOwners,
} from "@/lib/repositories/company-capabilities"
import { transferUserToCompany } from "@/lib/repositories/companies"
import { findUserByEmail, findUserById } from "@/lib/repositories/users"
import {
  listPeople,
  readMemberRole,
  setMemberRole,
} from "@/lib/repositories/company-console"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json(await listPeople(auth.companyId))
}

const roleSchema = z.object({
  userId: z.string().min(1),
  companyRole: z.enum(["member", "admin", "owner"]),
})

/**
 * Сменить роль сотрудника внутри компании.
 *
 * ПЕРЕВОДИТЬ людей отсюда нельзя — это делает наша админка (план §6.6).
 * Причина в том, что перевод меняет плательщика и снимает права, то есть
 * задевает деньги и принадлежность; отдать это компании — значит отдать ей
 * возможность посадить чужого человека на свой счёт.
 *
 * ЗАВОДИТЬ нового — можно, это `POST` ниже (план §7): у несуществующего
 * аккаунта нет ни плательщика, ни прав, ни другой компании, и посадить на счёт
 * чужого человека им нельзя.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = roleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }
  const { userId, companyRole } = parsed.data

  // Свою роль не меняет никто — то же правило, что у ролей сайта
  // (ADMIN_ROLES_PLAN.md §2): иначе владелец понижает себя и остаётся без
  // права вернуться.
  if (userId === auth.userId) {
    return NextResponse.json(
      { message: "You cannot change your own company role.", code: "self" },
      { status: 400 },
    )
  }

  // Человек ДОЛЖЕН быть сотрудником этой компании. Без этой проверки чужой
  // идентификатор менял бы роль в соседней компании — ровно та дыра, ради
  // которой консоль вынесена отдельной поверхностью.
  const current = await readMemberRole(auth.companyId, userId)
  if (!current) {
    return NextResponse.json({ message: "Person not found." }, { status: 404 })
  }
  if (current === companyRole) return NextResponse.json({ ok: true })

  // Только владелец назначает владельцев: право раздачи не раздаётся тегом
  // (план §4), иначе админ с тегом «люди» выписал бы себе всё остальное.
  if (companyRole === "owner" && auth.companyRole !== "owner") {
    return NextResponse.json(
      { message: "Only an owner can appoint owners.", code: "owner-only" },
      { status: 403 },
    )
  }
  if (current === "owner" && auth.companyRole !== "owner") {
    return NextResponse.json(
      { message: "Only an owner can demote an owner.", code: "owner-only" },
      { status: 403 },
    )
  }

  // Последнего владельца снять нельзя — иначе раздавать права в компании станет
  // некому и изнутри она не разблокируется.
  if (current === "owner" && companyRole !== "owner") {
    if ((await countCompanyOwners(auth.companyId, userId)) === 0) {
      return NextResponse.json(
        { message: "At least one owner must remain.", code: "last-owner" },
        { status: 400 },
      )
    }
  }

  const changed = await setMemberRole({
    companyId: auth.companyId,
    userId,
    companyRole,
  })
  if (!changed) {
    return NextResponse.json({ message: "Person not found." }, { status: 404 })
  }

  // Теги есть только у админов: у участника они ничего не открывают, но всплыли
  // бы обратно при повторном повышении, молча вернув выданное когда-то.
  if (companyRole === "member") await clearCompanyCapabilities(userId)

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "company.role_changed",
    targetType: "user",
    targetId: userId,
    companyId: auth.companyId,
    meta: { from: current, to: companyRole },
  })

  return NextResponse.json({ ok: true })
}

const addSchema = z.object({
  /** Адреса списком: по одному — это письмо за письмом и вкладка за вкладкой. */
  emails: z.array(z.string()).min(1).max(50),
})

/** Что вышло по каждому адресу. Разбирается на экране в человеческую строку. */
type AddOutcome =
  | "created"
  | "mail-failed"
  | "already"
  | "taken"
  | "invalid"
  | "failed"

/**
 * Завести сотрудника по почте (план §7).
 *
 * Заводится ТОЛЬКО новый аккаунт. Занятый адрес — отказ, а не перевод: даже
 * человек без компании вовсе платит сегодня за себя сам, и зачисление его сюда
 * переложило бы оплату на кошелёк компании. Это тот же перевод, просто менее
 * заметный, а перевод остаётся за нами.
 *
 * Отвечает построчно, а не первой ошибкой. Адреса вставляют пачкой, и «не
 * удалось» без указания, на ком именно, заставило бы заводить всех заново — при
 * том что часть уже заведена и письма ушли.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = addSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  // Имя зовущего — для подписи в письме. Компанию подставляет бренд, а вот «кто
  // меня позвал» человек должен прочитать явно.
  const actor = await findUserById(auth.userId)
  const inviterName = actor?.fullName?.trim() || auth.email
  const brand = await mailBrandForOwner(auth.userId)
  const audit = auditFrom(request, { userId: auth.userId, email: auth.email })

  const seen = new Set<string>()
  const results: { email: string; outcome: AddOutcome }[] = []

  for (const raw of parsed.data.emails) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)

    if (!z.string().email().safeParse(email).success) {
      results.push({ email, outcome: "invalid" })
      continue
    }

    const existing = await findUserByEmail(email)
    if (existing) {
      // Свой — не ошибка: адрес вставили второй раз или человека уже завёл
      // коллега. Чужой — отказ без подробностей о том, чей он: состав соседней
      // компании этой компании знать незачем.
      results.push({
        email,
        outcome: existing.companyId === auth.companyId ? "already" : "taken",
      })
      continue
    }

    const account = await createAccountByEmail({ email })
    if (!account) {
      results.push({ email, outcome: "failed" })
      continue
    }

    // Зачисляем тем же путём, что и перевод в админке, хотя переводить тут
    // нечего: у нового аккаунта все её проверки проходят тривиально, зато
    // плательщик и принадлежность остаются выставлены в одном месте на всю
    // систему. Второй INSERT со своими правилами разошёлся бы с первым молча.
    const moved = await transferUserToCompany({
      userId: account.user.id,
      companyId: auth.companyId,
      // Всегда рядовой: повышение — отдельным действием через роли, потому что
      // право раздачи прав тегом не раздаётся (план §4).
      companyRole: "member",
    })
    if (!moved.ok) {
      results.push({ email, outcome: "failed" })
      continue
    }

    const mail = await sendCompanyWelcomeEmail({
      to: email,
      inviteeName: account.user.fullName,
      inviterName,
      temporaryPassword: account.temporaryPassword,
      brand,
    })

    await audit({
      action: "company.member_added",
      targetType: "user",
      targetId: account.user.id,
      companyId: auth.companyId,
      meta: { email, mailOk: mail.ok },
    })

    // Письмо не ушло — человек всё равно заведён, и сказать об этом надо прямо:
    // временный пароль есть только в этом письме, и без него он не войдёт.
    results.push({ email, outcome: mail.ok ? "created" : "mail-failed" })
  }

  return NextResponse.json({ results })
}
