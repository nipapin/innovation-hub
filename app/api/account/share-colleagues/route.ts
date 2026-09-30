import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { listCompanyColleagues } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"

/**
 * GET /api/account/share-colleagues — коллеги по компании для «Поделиться».
 *
 * История приглашений (share-contacts) знает только тех, кого уже звали, и
 * нового коллегу по имени в ней не найти. Отсюда — действующие сотрудники той
 * же компании, в которой сейчас работает человек. Свой состав компании ему
 * видеть можно; в личном профиле ответ пустой.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const user = await findUserById(auth.userId)
  if (!user?.companyId) return NextResponse.json({ colleagues: [] })

  const colleagues = await listCompanyColleagues({
    companyId: user.companyId,
    excludeUserId: auth.userId,
  })
  return NextResponse.json({ colleagues })
}
