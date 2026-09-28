import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { companyTransferSchema } from "@/lib/admin-schemas"
import { addLoginToCompany } from "@/lib/invite-account"
import { mailBrandForCompany, sendCompanyAddedEmail } from "@/lib/mail/send"
import { clearCompanyCapabilities } from "@/lib/repositories/company-capabilities"
import { setMemberRole } from "@/lib/repositories/company-console"
import { findUserById } from "@/lib/repositories/users"
import {
  deactivateSubprofile,
  listCompanyMembers,
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
    "login-inactive": "This account is suspended. Reactivate it first.",
    "company-not-found": "Company not found.",
    "company-inactive": "This company is disabled.",
    "not-subprofile": "This person is not a company profile yet.",
  }
  const status = reason === "not-found" || reason === "company-not-found" ? 404 : 409
  return NextResponse.json(
    { message: messages[reason] ?? "Could not move this person.", code: reason },
    { status },
  )
}

/**
 * Добавить человека в эту компанию — или сменить его роль в ней.
 *
 * Добавление — подпрофиль под входом человека, тем же путём, что и в консоли
 * компании (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.4). Выбрать в поиске можно
 * любую его строку — вход или профиль в другой компании: добавляется всегда
 * его вход, и второй профиль в той же компании не заводится (`already`).
 *
 * Прежний перевод «записать компанию на человека» ушёл: вход всегда без
 * компании, и человек из общего раздела больше не уезжает в компанию целиком,
 * вместе со своими проектами и личным кошельком.
 */
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
  if (!target) return transferErrorResponse("not-found")
  const audit = auditFrom(request, auth)

  // Он уже здесь — это смена роли в компании.
  if (target.companyId === id && target.isActive) {
    if (target.companyRole === parsed.data.companyRole) {
      return NextResponse.json({ ok: true, outcome: "unchanged" })
    }
    await setMemberRole({
      companyId: id,
      userId: target.id,
      companyRole: parsed.data.companyRole,
    })
    // Теги — у админов компании; при смене роли снимаем, как снимал прежний
    // перевод: всплывшие обратно, они вернули бы то, чего никто не выдавал.
    await clearCompanyCapabilities(target.id)
    await audit({
      action: "company.role_changed",
      targetType: "user",
      targetId: target.id,
      targetLabel: target.email,
      companyId: id,
      meta: { from: target.companyRole, to: parsed.data.companyRole, bySite: true },
    })
    return NextResponse.json({ ok: true, outcome: "role-changed" })
  }

  const loginUserId = target.loginUserId ?? target.id
  const added = await addLoginToCompany({
    loginUserId,
    companyId: id,
    companyRole: parsed.data.companyRole,
  })
  if (!added.ok) {
    return transferErrorResponse(
      added.reason === "login-not-found" ? "not-found" : added.reason,
    )
  }
  if (added.outcome === "already") {
    return NextResponse.json({ ok: true, outcome: "already", profileId: added.profileId })
  }

  // Человеку надо узнать, что в переключателе появилась компания: иначе он
  // найдёт её случайно или не найдёт вовсе.
  const actor = await findUserById(auth.userId)
  const mail = await sendCompanyAddedEmail({
    to: target.email,
    inviteeName: target.fullName || target.email,
    inviterName: actor?.fullName?.trim() || auth.email,
    profileId: added.profileId,
    brand: await mailBrandForCompany(id),
  })

  await audit({
    action: "company.member_added",
    targetType: "user",
    targetId: added.profileId,
    targetLabel: target.email,
    companyId: id,
    meta: {
      email: target.email,
      companyRole: parsed.data.companyRole,
      subprofile: true,
      loginUserId,
      reactivated: added.outcome === "reactivated",
      mailOk: mail.ok,
      bySite: true,
    },
  })

  return NextResponse.json({ ok: true, outcome: added.outcome, profileId: added.profileId })
}

const removeSchema = z.object({ userId: z.string().min(1) })

/**
 * Вывести человека из компании — выключить его профиль в ней
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.3). Проекты остаются компании, вход и
 * другие компании человека не меняются.
 */
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

  const result = await deactivateSubprofile({
    companyId: id,
    profileId: parsed.data.userId,
  })
  if (!result.ok) return transferErrorResponse("not-subprofile")

  if (result.changed) {
    await auditFrom(request, auth)({
      action: "company.member_removed",
      targetType: "user",
      targetId: parsed.data.userId,
      targetLabel: result.email,
      companyId: id,
      meta: { email: result.email, bySite: true },
    })
  }

  return NextResponse.json({ ok: true })
}
