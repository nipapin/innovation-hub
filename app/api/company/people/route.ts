import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import {
  clearCompanyCapabilities,
  countCompanyOwners,
} from "@/lib/repositories/company-capabilities"
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
 * Заводить и переводить людей отсюда НЕЛЬЗЯ — это делает наша админка (план
 * §6.6). Причина в том, что перевод меняет плательщика и снимает права, то есть
 * задевает деньги и принадлежность; отдать это компании — значит отдать ей
 * возможность посадить чужого человека на свой счёт.
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
