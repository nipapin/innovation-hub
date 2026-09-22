import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  listTemplateProjects,
  updateProjectBilling,
} from "@/lib/billing/projects"
import { listTemplateCosts } from "@/lib/billing/reports"
import { trialWriteSchema } from "@/lib/billing/schemas"
import { readBillingSettings, writeBillingSettings } from "@/lib/billing/settings"

export const runtime = "nodejs"

/** Набор со стоимостью секунды — один ответ и на чтение, и на запись. */
async function readTemplateRows() {
  const templates = await listTemplateProjects()
  const costs = await listTemplateCosts(templates.map((t) => t.projectId))
  return templates.map((t) => ({ ...t, cost: costs.get(t.projectId) ?? null }))
}

/**
 * Привести состав набора к присланному списку.
 *
 * Признак шаблона живёт на проекте, а не в документе настроек, поэтому состав
 * не попадает под ревизию и записывается отдельными строками. Это осознанный
 * размен: набор правит один человек за раз, а альтернатива — держать список
 * проектов в настройках — развела бы его с `projects.is_template`, по которому
 * работает и выдача, и исключение шаблонов из слежения.
 *
 * Порядок присланного списка становится порядком копирования.
 */
async function applyTemplateSet(templateIds: string[]) {
  const current = await listTemplateProjects()
  const wanted = new Set(templateIds)

  // Сначала убираем: иначе снятый и тут же добавленный проект мог бы потерять
  // свой номер, а порядок — единственное, чем набор управляет при копировании.
  for (const row of current) {
    if (!wanted.has(row.projectId)) {
      await updateProjectBilling({
        projectId: row.projectId,
        isTemplate: false,
        templateOrder: null,
      })
    }
  }

  for (const [index, projectId] of templateIds.entries()) {
    await updateProjectBilling({ projectId, isTemplate: true, templateOrder: index })
  }
}

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

  // Активаций здесь нет намеренно: их список постранично живёт своим адресом
  // (`./trial/activations`). Отдавать его вместе с настройками значило бы
  // тянуть всю историю выдач каждый раз, когда открывают экран ради суммы
  // подарка.
  return NextResponse.json({
    trial: settings.trial,
    revision,
    templates: await readTemplateRows(),
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

  // Состав — после настроек, а не до: отметку «набор обновлён» несёт документ,
  // и если запись отбита чужой ревизией, проекты обязаны остаться как были.
  // Иначе набор бы сменился, а отметка о смене — нет, и никому не вернулась бы
  // кнопка.
  if (parsed.data.templateIds) await applyTemplateSet(parsed.data.templateIds)

  return NextResponse.json({
    trial: result.settings.trial,
    revision: result.revision,
    templates: await readTemplateRows(),
  })
}
