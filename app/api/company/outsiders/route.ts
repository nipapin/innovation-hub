import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import {
  listCompanyOutsiders,
  revokeCompanyOutsider,
} from "@/lib/repositories/company-console"

export const runtime = "nodejs"

/**
 * Внешние участники проектов компании — кто не её сотрудник, но видит её работу.
 *
 * Тег тот же, что у «Людей»: вопрос один — кто имеет доступ к работе компании, —
 * и разводить его по двум правам значило бы, что кто-то видит половину ответа.
 *
 * Компания берётся ИЗ ГЕЙТА, а не из запроса: иначе админ одной компании
 * посмотрел бы участников другой, подставив чужой идентификатор.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  const rows = await listCompanyOutsiders(auth.companyId)
  return NextResponse.json({
    outsiders: rows.map((row) => ({
      ...row,
      invitedAt: row.invitedAt.toISOString(),
    })),
  })
}

const revokeSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
})

/**
 * Снять доступ внешнего участника к проекту компании.
 *
 * Аккаунт при этом НЕ трогается: человек мог прийти на сайт своим путём и
 * работать в чужих проектах. Компания распоряжается доступом к своей работе, а
 * не чужими учётками — удаление людей с площадки остаётся у нас.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireCompanyApi(request, "people.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = revokeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const removed = await revokeCompanyOutsider(
    auth.companyId,
    parsed.data.projectId,
    parsed.data.userId,
  )
  if (!removed) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "project.unshared",
    targetType: "project",
    targetId: parsed.data.projectId,
    companyId: auth.companyId,
    meta: { revokedUserId: parsed.data.userId, via: "company-console" },
  })

  return NextResponse.json({ ok: true })
}
