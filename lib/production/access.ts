import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { hasCompanyCapability } from "@/lib/company-capabilities"
import { listCompanyCapabilitiesFor } from "@/lib/repositories/company-capabilities"
import { findUserById } from "@/lib/repositories/users"
import { isProductionAvailable } from "./availability"

/**
 * Гварды роутов производства — docs/PRODUCTION_PLAN.md §6.4.
 *
 * Идиома та же, что у остальных: «либо данные, либо готовый ответ».
 */

export type ProductionApiUser = { userId: string; email: string }

/**
 * Сессия плюс доступность раздела. Раздел выключен — 404, а не 403: для
 * человека его нет, и роут не должен подтверждать обратное.
 */
export async function requireProductionApi(
  request: NextRequest,
): Promise<ProductionApiUser | NextResponse> {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (!(await isProductionAvailable(auth.userId))) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return { userId: auth.userId, email: auth.email }
}

/**
 * Может ли человек заводить пайплайны.
 *
 * В «Личном» — сам для себя: выдавать тег там некому. В компании — только с
 * рабочим тегом `production.manage` (lib/company-capabilities.ts): пайплайн
 * заводит продюсер, и в компании это право раздаётся явно.
 */
export async function canCreatePipelines(userId: string): Promise<boolean> {
  const user = await findUserById(userId)
  if (!user) return false
  if (!user.companyId) return true
  const granted = await listCompanyCapabilitiesFor(userId)
  return hasCompanyCapability(user.companyRole, granted, "production.manage")
}
