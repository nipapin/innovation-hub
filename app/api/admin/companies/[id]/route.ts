import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  deleteCompany,
  findCompanyById,
  patchCompanyFeatures,
  setCompanyActive,
} from "@/lib/repositories/companies"
import { AUTOMATION_ENABLED_KEY } from "@/lib/company-features"

export const runtime = "nodejs"

/**
 * Два независимых выключателя, поэтому оба необязательные и приходят порознь.
 *
 * `isActive` — компания как сущность: закрывает консоль и оформление входа.
 * `automationEnabled` — слежение конвейера за её проектами
 * (docs/COMPANY_PIPELINE_PLAN.md §5).
 *
 * Слить их в один было бы соблазнительно и неверно: «перестать обрабатывать» на
 * время разбирательства с оплатой и «закрыть компанию» — разные решения, и
 * первое принимают куда чаще второго. Выключателем обработки распоряжаемся мы, а
 * не компания: это управление установкой, в отличие от флага «только свои
 * машины», который стоит в её собственной консоли (§6).
 */
const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    automationEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.isActive !== undefined || value.automationEnabled !== undefined,
    "Nothing to change.",
  )

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const audit = auditFrom(request, auth)
  let company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  if (parsed.data.automationEnabled !== undefined) {
    company =
      (await patchCompanyFeatures({
        companyId: id,
        patch: { [AUTOMATION_ENABLED_KEY]: parsed.data.automationEnabled },
      })) ?? company
    await audit({
      action: parsed.data.automationEnabled
        ? "company.automation_enabled"
        : "company.automation_disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  if (parsed.data.isActive !== undefined) {
    company = (await setCompanyActive(id, parsed.data.isActive)) ?? company
    await audit({
      action: parsed.data.isActive ? "company.enabled" : "company.disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  return NextResponse.json(company)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const result = await deleteCompany(id)
  if (!result.ok) {
    const messages: Record<string, string> = {
      "has-members": "Move all people out of this company before deleting it.",
      "wallet-has-ledger":
        "This company's wallet has money history. Deleting it would erase the ledger.",
      "wallet-has-dependents":
        "This company's wallet still pays for someone. Reassign them first.",
      "not-found": "Company not found.",
    }
    return NextResponse.json(
      { message: messages[result.reason], code: result.reason },
      { status: result.reason === "not-found" ? 404 : 409 },
    )
  }

  await auditFrom(request, auth)({
    action: "company.deleted",
    targetType: "company",
    targetId: id,
    targetLabel: company.title,
  })

  return NextResponse.json({ message: "Company deleted." })
}
