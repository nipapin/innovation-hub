import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { findFeature, isFeatureKey } from "@/lib/features"
import { listFeatureRows } from "@/lib/features-state"
import { writeFeatureOverride } from "@/lib/repositories/feature-flags"

export const runtime = "nodejs"

/**
 * Выключатели частей сайта. Контракт — docs/FEATURE_FLAGS.md.
 *
 * Тег один и тот же на чтение и на запись: смотреть, что на установке погашено,
 * — уже привилегия. Список разделов и инструментов, которых у вас нет, — это
 * карта того, чего вам не показали.
 */

const toggleSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
})

/** GET /api/admin/features */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "features.manage")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({ features: await listFeatureRows() })
}

/** PATCH /api/admin/features — `{ key, enabled }`. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "features.manage")
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { key, enabled } = parsed.data
  if (!isFeatureKey(key)) {
    return NextResponse.json({ message: "Unknown feature." }, { status: 404 })
  }

  // Страница такие переключатели рисует нажатыми намертво, но роут не должен
  // верить странице: значение env-флага живёт на сервере, и запись в базу
  // создала бы второй источник правды, который тихо разошёлся бы с первым.
  const feature = findFeature(key)
  if (feature?.source === "env") {
    return NextResponse.json(
      { message: "This switch is set in the environment." },
      { status: 409 },
    )
  }

  await writeFeatureOverride({ key, enabled, updatedBy: auth.userId })

  await auditFrom(request, auth)({
    action: "feature.toggled",
    targetType: "feature",
    targetId: key,
    targetLabel: key,
    meta: { enabled },
  })

  return NextResponse.json({ features: await listFeatureRows() })
}
