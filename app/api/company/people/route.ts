import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import { addLoginToCompany, createAccountByEmail } from "@/lib/invite-account"
import {
  mailBrandForCompany,
  sendCompanyAddedEmail,
  sendCompanyWelcomeEmail,
} from "@/lib/mail/send"
import {
  clearConsoleCapabilities,
  countCompanyOwners,
} from "@/lib/repositories/company-capabilities"
import { deactivateSubprofile } from "@/lib/repositories/companies"
import {
  findLoginByEmail,
  findUserById,
  rememberLastProfile,
} from "@/lib/repositories/users"
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
 * Добавить человека — `POST` ниже, вывести — `DELETE`. Оба трогают только
 * рабочее место человека В ЭТОЙ компании — его подпрофиль
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §7). Прежний запрет «переводить людей
 * отсюда нельзя» держался на том, что перевод забирал человека целиком, вместе
 * с его личным кошельком и проектами; подпрофиль ничего из этого не задевает.
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

  // Консольные теги есть только у админов: у участника они ничего не открывают,
  // но всплыли бы обратно при повторном повышении, молча вернув выданное
  // когда-то. Рабочие теги остаются — участнику они и нужны.
  if (companyRole === "member") await clearConsoleCapabilities(userId)

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

/**
 * Что вышло по каждому адресу. Разбирается на экране в человеческую строку.
 *
 * `added` — аккаунт уже был, человек получил рабочее место в компании. Прежний
 * исход `taken` ушёл: состав чужой компании по-прежнему не раскрывается —
 * `added` одинаков для человека из общего раздела и из другой компании (§7.1).
 */
type AddOutcome =
  | "created"
  | "added"
  | "mail-failed"
  | "already"
  | "invalid"
  | "failed"

/**
 * Добавить людей в компанию по почте (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.1).
 *
 * | под этой почтой                  | исход                                        |
 * | -------------------------------- | -------------------------------------------- |
 * | никого                           | вход + подпрофиль, письмо с паролем — created |
 * | действующий профиль в компании   | already                                      |
 * | выведенный профиль в компании    | возвращается — added                         |
 * | вход без профиля в компании      | подпрофиль, письмо «вас добавили» — added     |
 *
 * Новый аккаунт — ВХОД без компании, а в компанию человек попадает подпрофилем:
 * вход всегда без компании (§3.1). Роль — всегда участник: повышение отдельным
 * действием через роли, потому что право раздачи прав тегом не раздаётся.
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
  const brand = await mailBrandForCompany(auth.companyId)
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

    const login = await findLoginByEmail(email)
    // Служебный кошелёк компании — не человек, добавлять его некуда.
    if (login && login.kind !== "person") {
      results.push({ email, outcome: "invalid" })
      continue
    }

    let loginUserId = login?.id ?? null
    let temporaryPassword: string | null = null
    let inviteeName = login?.fullName ?? ""
    if (!loginUserId) {
      const account = await createAccountByEmail({ email })
      if (!account) {
        results.push({ email, outcome: "failed" })
        continue
      }
      loginUserId = account.user.id
      temporaryPassword = account.temporaryPassword
      inviteeName = account.user.fullName
    }

    const added = await addLoginToCompany({
      loginUserId,
      companyId: auth.companyId,
      companyRole: "member",
    })
    if (!added.ok) {
      results.push({ email, outcome: "failed" })
      continue
    }
    if (added.outcome === "already") {
      results.push({ email, outcome: "already" })
      continue
    }

    // Аккаунт завела компания — и первый вход откроет её, а не пустое «Личное»
    // (docs/MULTI_COMPANY_PROFILES_PLAN.md §17.6). У того, кто уже был у нас,
    // не трогаем: он работает где-то ещё, компания появится в переключателе.
    if (temporaryPassword) {
      await rememberLastProfile(loginUserId, added.profileId).catch((error) => {
        console.error("[company/people] remember first profile failed", error)
      })
    }

    const mail = temporaryPassword
      ? await sendCompanyWelcomeEmail({
          to: email,
          inviteeName,
          inviterName,
          temporaryPassword,
          brand,
          profileId: added.profileId,
        })
      : await sendCompanyAddedEmail({
          to: email,
          inviteeName: inviteeName || email,
          inviterName,
          profileId: added.profileId,
          brand,
        })

    await audit({
      action: "company.member_added",
      targetType: "user",
      targetId: added.profileId,
      companyId: auth.companyId,
      meta: {
        email,
        mailOk: mail.ok,
        subprofile: true,
        loginUserId,
        newAccount: temporaryPassword !== null,
        reactivated: added.outcome === "reactivated",
      },
    })

    // Новому аккаунту письмо обязательно: временный пароль есть только в нём.
    // У существующего пароль прежний, и неушедшее письмо — не беда: компания
    // уже в его переключателе.
    results.push({
      email,
      outcome: temporaryPassword ? (mail.ok ? "created" : "mail-failed") : "added",
    })
  }

  return NextResponse.json({ results })
}

/**
 * Вывести человека из компании (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.3).
 *
 * Выключается его подпрофиль В ЭТОЙ компании: пункт пропадает из
 * переключателя, права компании снимаются, проекты остаются компании — как у
 * уволенного. Вход человека и другие его компании не меняются.
 *
 * Правила — те же, что у смены роли: себя не выводят, владельца выводит только
 * владелец, последнего владельца не выводит никто.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ message: "userId is required." }, { status: 400 })
  }
  if (userId === auth.userId) {
    return NextResponse.json(
      { message: "You cannot remove yourself from the company.", code: "self" },
      { status: 400 },
    )
  }

  const current = await readMemberRole(auth.companyId, userId)
  if (!current) {
    return NextResponse.json({ message: "Person not found." }, { status: 404 })
  }
  if (current === "owner") {
    if (auth.companyRole !== "owner") {
      return NextResponse.json(
        { message: "Only an owner can remove an owner.", code: "owner-only" },
        { status: 403 },
      )
    }
    if ((await countCompanyOwners(auth.companyId, userId)) === 0) {
      return NextResponse.json(
        { message: "At least one owner must remain.", code: "last-owner" },
        { status: 400 },
      )
    }
  }

  const result = await deactivateSubprofile({
    companyId: auth.companyId,
    profileId: userId,
  })
  if (!result.ok) {
    // Сотрудник есть, но не подпрофилем: он ещё не переведён миграцией
    // перевода. Выводить такого — значит выводить его целиком, и это не сюда.
    return NextResponse.json(
      { message: "This person cannot be removed here yet.", code: "not-subprofile" },
      { status: 409 },
    )
  }

  if (result.changed) {
    await auditFrom(request, { userId: auth.userId, email: auth.email })({
      action: "company.member_removed",
      targetType: "user",
      targetId: userId,
      companyId: auth.companyId,
      meta: { email: result.email, companyRole: current },
    })
  }

  return NextResponse.json({ ok: true })
}
