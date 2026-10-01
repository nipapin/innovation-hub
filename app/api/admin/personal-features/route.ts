import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { COMPANY_TOOLS_KEY, PRODUCTION_KEY } from "@/lib/company-features"
import {
  patchPersonalFeatures,
  readPersonalFeatures,
} from "@/lib/repositories/personal-features"
import { findTool } from "@/lib/tools/registry"

export const runtime = "nodejs"

/**
 * Набор «Личного» — то же, что набор команды (`/api/admin/companies/[id]`), но
 * для всех вне команд. Те же права: решает тот, кто распоряжается командами.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ features: await readPersonalFeatures() })
}

const patchSchema = z
  .object({
    production: z.boolean().optional(),
    // Как у команды: ключи по реестру, `null` — «всё, что есть на установке».
    companyTools: z
      .array(z.string())
      .refine((keys) => keys.every((key) => findTool(key) !== null), "Unknown tool key.")
      .nullable()
      .optional(),
  })
  .refine((v) => v.production !== undefined || v.companyTools !== undefined, "Nothing to change.")

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.production !== undefined) patch[PRODUCTION_KEY] = parsed.data.production
  if (parsed.data.companyTools !== undefined) patch[COMPANY_TOOLS_KEY] = parsed.data.companyTools

  const features = await patchPersonalFeatures({ patch, updatedBy: auth.userId })
  if (!features) {
    return NextResponse.json(
      { message: "Not available yet.", code: "not-migrated" },
      { status: 503 },
    )
  }

  const audit = auditFrom(request, auth)
  if (parsed.data.production !== undefined) {
    await audit({
      action: parsed.data.production ? "personal.production_enabled" : "personal.production_disabled",
      targetType: "personal",
    })
  }
  if (parsed.data.companyTools !== undefined) {
    await audit({
      action: "personal.sets_changed",
      targetType: "personal",
      meta: { [COMPANY_TOOLS_KEY]: parsed.data.companyTools },
    })
  }
  return NextResponse.json({ features })
}
