import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { listPipelineUsers } from "@/lib/pipeline/repository"
import { listCompanies } from "@/lib/repositories/companies"
import { findUserById, setUserAutomationEnabled } from "@/lib/repositories/users"

export const runtime = "nodejs"

/**
 * Колонка 1 «Конвейера»: пользователи и их участие в обработке.
 *
 * Возвращает не только флаг, но и счётчики по проектам — админу нужно понимать,
 * почему у включённого пользователя ничего не обрабатывается: все проекты на
 * паузе, все в архиве или ни в одном нет options.json.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  // Компании отдаём списком, а не выводим из людей: заведённая, но пока
  // безлюдная компания обязана быть видна отдельной строкой. Выводись области
  // из пользователей — она бы просто не появилась, и «завели или не завели»
  // пришлось бы выяснять в другом разделе.
  const [users, companies] = await Promise.all([
    listPipelineUsers(),
    listCompanies(),
  ])
  return NextResponse.json({
    users,
    companies: companies.map((company) => ({
      id: company.id,
      title: company.title,
    })),
  })
}

const patchSchema = z.object({
  userId: z.string().min(1),
  automationEnabled: z.boolean(),
})

/**
 * Гейт уровня пользователя. Флаги его проектов не трогаем осознанно: выключил
 * и включил обратно — состояние проектов осталось тем, каким его оставил
 * пользователь.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  // Снимок до записи: журналу нужно «из чего во что», а нажатие на уже
  // включённый тумблер записью быть не должно — иначе лента заполнится
  // строками, за которыми ничего не произошло.
  const before = await findUserById(parsed.data.userId)
  if (!before) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  const user = await setUserAutomationEnabled(
    parsed.data.userId,
    parsed.data.automationEnabled,
  )
  if (!user) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  if (before.automationEnabled !== user.automationEnabled) {
    await auditFrom(request, auth)({
      action: user.automationEnabled
        ? "user.automation_enabled"
        : "user.automation_disabled",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
    })
  }

  return NextResponse.json({
    user: {
      id: user.id,
      automationEnabled: user.automationEnabled,
    },
  })
}
