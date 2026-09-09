import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listTemplateProjects } from "@/lib/billing/projects"
import { listTemplateCosts } from "@/lib/billing/reports"
import { trialWriteSchema } from "@/lib/billing/schemas"
import { readBillingSettings, writeBillingSettings } from "@/lib/billing/settings"

export const runtime = "nodejs"

/**
 * Тестовый период: включение, размер подарка, срок, состав пробного набора и
 * список активаций.
 *
 * Свой тег `billing.trial`, а не общий `billing.manage`: решение «дарим ли мы
 * новым пользователям и сколько» маркетинговое, а прайс — коммерческое, и
 * доверять их можно разным людям. Запись здесь трогает ТОЛЬКО поля периода:
 * документ настроек один, и без этого ограничения любой из двух тегов молча
 * переписывал бы чужую половину.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.trial")
  if (auth instanceof NextResponse) return auth

  const { settings, revision } = await readBillingSettings()
  const templates = await listTemplateProjects()
  const costs = await listTemplateCosts(templates.map((t) => t.projectId))

  // Активаций здесь нет намеренно: их список постранично живёт своим адресом
  // (`./trial/activations`). Отдавать его вместе с настройками значило бы
  // тянуть всю историю выдач каждый раз, когда открывают экран ради суммы
  // подарка.
  return NextResponse.json({
    trial: settings.trial,
    revision,
    templates: templates.map((t) => ({ ...t, cost: costs.get(t.projectId) ?? null })),
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.trial")
  if (auth instanceof NextResponse) return auth

  const parsed = trialWriteSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid settings.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const current = await readBillingSettings()
  const result = await writeBillingSettings({
    settings: { ...current.settings, trial: parsed.data.trial },
    baseRevision: parsed.data.baseRevision,
    actorUserId: auth.userId,
  })

  if (!result.ok) {
    return NextResponse.json(
      { message: "Settings changed elsewhere.", ...result },
      { status: 409 },
    )
  }
  return NextResponse.json({ trial: result.settings.trial, revision: result.revision })
}
