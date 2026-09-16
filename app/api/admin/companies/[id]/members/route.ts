import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { companyTransferSchema } from "@/lib/admin-schemas"
import { findUserById } from "@/lib/repositories/users"
import {
  listCompanyMembers,
  transferUserToCompany,
} from "@/lib/repositories/companies"

export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  return NextResponse.json(await listCompanyMembers(id))
}

function transferErrorResponse(reason: string) {
  const messages: Record<string, string> = {
    "not-found": "User not found.",
    "is-wallet": "This account is a company wallet and cannot be moved.",
    "company-not-found": "Company not found.",
    "company-inactive": "This company is disabled.",
    "invalid-pair": "Invalid company/role combination.",
    "has-dependents": "This person pays for others. Reassign them first.",
    "has-open-grants": "This person has an open grant. Wait for it to end or revoke it.",
  }
  const status = reason === "not-found" || reason === "company-not-found" ? 404 : 409
  return NextResponse.json(
    { message: messages[reason] ?? "Could not move this person.", code: reason },
    { status },
  )
}

/** Перевести человека в эту компанию — или сменить его роль в ней. */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = companyTransferSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const target = await findUserById(parsed.data.userId)
  const result = await transferUserToCompany({
    userId: parsed.data.userId,
    companyId: id,
    companyRole: parsed.data.companyRole,
  })
  if (!result.ok) return transferErrorResponse(result.reason)

  if (result.changed) {
    await auditFrom(request, auth)({
      action: "company.member_transferred",
      targetType: "user",
      targetId: parsed.data.userId,
      targetLabel: target?.email ?? null,
      companyId: id,
      meta: {
        previousCompanyId: result.previousCompanyId,
        companyId: id,
        companyRole: parsed.data.companyRole,
        // Перевод меняет кошелёк, с которого идут списания за работу человека.
        payerUserId: result.payerUserId,
        previousPayerUserId: result.previousPayerUserId,
      },
    })
  }

  return NextResponse.json({ ok: true })
}

const removeSchema = z.object({ userId: z.string().min(1) })

/** Убрать человека из компании — переводит его в общий раздел. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const userId = request.nextUrl.searchParams.get("userId")
  const parsed = removeSchema.safeParse({ userId })
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const target = await findUserById(parsed.data.userId)
  const result = await transferUserToCompany({
    userId: parsed.data.userId,
    companyId: null,
    companyRole: null,
  })
  if (!result.ok) return transferErrorResponse(result.reason)

  if (result.changed) {
    await auditFrom(request, auth)({
      action: "company.member_transferred",
      targetType: "user",
      targetId: parsed.data.userId,
      targetLabel: target?.email ?? null,
      companyId: id,
      meta: {
        previousCompanyId: result.previousCompanyId,
        companyId: null,
        payerUserId: result.payerUserId,
        previousPayerUserId: result.previousPayerUserId,
      },
    })
  }

  return NextResponse.json({ ok: true })
}
