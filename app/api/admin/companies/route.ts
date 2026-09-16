import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { companyCreateSchema } from "@/lib/admin-schemas"
import { createCompany, listCompanies } from "@/lib/repositories/companies"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json(await listCompanies())
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = companyCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await createCompany({
    slug: parsed.data.slug,
    title: parsed.data.title,
    createdBy: auth.userId,
  })
  if (!result.ok) {
    return NextResponse.json(
      { message: "This slug is already taken.", code: result.reason },
      { status: 409 },
    )
  }

  await auditFrom(request, auth)({
    action: "company.created",
    targetType: "company",
    targetId: result.company.id,
    targetLabel: result.company.title,
    companyId: result.company.id,
  })

  return NextResponse.json(result.company, { status: 201 })
}
