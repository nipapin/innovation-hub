import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { isSuperAdmin } from "@/lib/admin-roles"
import {
  COMPANY_SCOPE_COOKIE,
  requireCompanyApiAnyAdmin,
} from "@/lib/company-auth"
import { findCompanyById } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"

const schema = z.object({ companyId: z.string().min(1) })

/**
 * Переключатель компаний суперадмина (план §6.2).
 *
 * Выбор живёт в куке, а не в адресе: ссылка на раздел консоли, отправленная
 * коллеге, должна открывать ЕГО компанию, а не ту, в которой был отправитель.
 *
 * Переключаться может только суперадмин сайта. Админу компании кука ничего не
 * даёт — гейт для человека с `company_id` берёт его компанию и на куку не
 * смотрит, — но роут всё равно отказывает явно: молчаливо принятая и
 * проигнорированная команда хуже отказа.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireCompanyApiAnyAdmin(request)
  if (auth instanceof NextResponse) return auth

  const user = await findUserById(auth.userId)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json(
      { message: "Only a site superadmin can switch companies." },
      { status: 403 },
    )
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const company = await findCompanyById(parsed.data.companyId)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const response = NextResponse.json({ ok: true, companyId: company.id })
  response.cookies.set(COMPANY_SCOPE_COOKIE, company.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Не сессионная: суперадмин, разбирающийся с одной компанией, возвращается
    // к ней и завтра. Год — просто «пока не переключит».
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

/**
 * Выход из просмотра — кнопка «Выйти из компании» в консоли.
 *
 * Именно сброс, а не уход ссылкой: пока кука стоит, любой заход в `/company`
 * снова открывает ту же компанию, и «выход», который ничего не сбрасывает,
 * обещал бы больше, чем делал.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireCompanyApiAnyAdmin(request)
  if (auth instanceof NextResponse) return auth

  const user = await findUserById(auth.userId)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json(
      { message: "Only a site superadmin can switch companies." },
      { status: 403 },
    )
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.delete(COMPANY_SCOPE_COOKIE)
  return response
}
