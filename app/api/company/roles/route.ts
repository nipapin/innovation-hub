import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import { COMPANY_CAPABILITIES } from "@/lib/company-capabilities"
import {
  listCompanyCapabilitiesForMany,
  setCompanyCapabilities,
} from "@/lib/repositories/company-capabilities"
import {
  listPeople,
  readMemberRole,
} from "@/lib/repositories/company-console"

export const runtime = "nodejs"

/** Админы компании и их теги: экран выдачи строится из одного ответа. */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "roles.manage")
  if (auth instanceof NextResponse) return auth

  const people = await listPeople(auth.companyId)
  const admins = people.filter((person) => person.companyRole !== "member")
  const capabilities = await listCompanyCapabilitiesForMany(
    admins.map((person) => person.userId),
  )

  return NextResponse.json({
    people: admins.map((person) => ({
      ...person,
      capabilities: capabilities.get(person.userId) ?? [],
    })),
    // Потолок выдающего — им же ограничены галочки в интерфейсе. Отдаём
    // сервером, чтобы экран не пересчитывал правило по-своему.
    grantable: auth.capabilities,
  })
}

const schema = z.object({
  userId: z.string().min(1),
  capabilities: z.array(z.enum(COMPANY_CAPABILITIES)).max(COMPANY_CAPABILITIES.length),
})

/**
 * Выдать набор тегов внутри компании.
 *
 * Правило (план §4): **выдать можно только тег, который есть у тебя самого, и
 * только человеку своей компании.** Владелец выдаёт любые — у него есть все.
 * Без этого правила админ с тегом «права» выписал бы себе остальные.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireCompanyApi(request, "roles.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }
  const { userId, capabilities } = parsed.data

  // Себе теги не правят: это тот же обход, что смена собственной роли.
  if (userId === auth.userId) {
    return NextResponse.json(
      { message: "You cannot change your own rights.", code: "self" },
      { status: 400 },
    )
  }

  const role = await readMemberRole(auth.companyId, userId)
  if (!role) {
    return NextResponse.json({ message: "Person not found." }, { status: 404 })
  }
  // Владельцу теги не выдаются: у него они все неявно, а строки в таблице стали
  // бы вторым источником правды — тот же довод, что у суперадмина сайта.
  if (role === "owner") {
    return NextResponse.json(
      { message: "An owner already has everything.", code: "owner" },
      { status: 400 },
    )
  }
  if (role === "member") {
    return NextResponse.json(
      { message: "Make this person an admin first.", code: "member" },
      { status: 400 },
    )
  }

  const result = await setCompanyCapabilities({
    userId,
    capabilities,
    grantedBy: auth.userId,
    allowed: auth.capabilities,
  })
  if (!result.ok) {
    return NextResponse.json(
      { message: "You cannot grant a right you don't have.", code: result.reason },
      { status: 403 },
    )
  }

  const audit = auditFrom(request, { userId: auth.userId, email: auth.email })
  const target = { targetType: "user", targetId: userId, companyId: auth.companyId }
  if (result.added.length > 0) {
    await audit({
      ...target,
      action: "company.capability_granted",
      meta: { capabilities: result.added },
    })
  }
  if (result.removed.length > 0) {
    await audit({
      ...target,
      action: "company.capability_revoked",
      meta: { capabilities: result.removed },
    })
  }

  return NextResponse.json({ ok: true })
}
