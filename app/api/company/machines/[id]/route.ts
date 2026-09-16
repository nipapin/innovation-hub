import { NextResponse, type NextRequest } from "next/server"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import { generateRemoteComputerToken } from "@/lib/repositories/remote-computers"
import {
  revokeCompanyMachine,
  rotateCompanyMachineToken,
} from "@/lib/repositories/company-console"

export const runtime = "nodejs"

/**
 * Отзыв машины компании.
 *
 * Рамка компании стоит в самом `UPDATE` (`revokeCompanyMachine`), а не в
 * отдельной проверке перед ним: чужой идентификатор просто не находит строки,
 * и между проверкой и записью нет промежутка.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCompanyApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const revoked = await revokeCompanyMachine(auth.companyId, id)
  if (!revoked) {
    return NextResponse.json({ message: "Machine not found." }, { status: 404 })
  }

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "company.machine_revoked",
    targetType: "computer",
    targetId: id,
    companyId: auth.companyId,
  })

  return NextResponse.json({ ok: true })
}

/** Смена токена — ответ на «ключ утёк». Прежний перестаёт работать сразу. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCompanyApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const token = generateRemoteComputerToken()
  const rotated = await rotateCompanyMachineToken(auth.companyId, id, token)
  if (!rotated) {
    return NextResponse.json({ message: "Machine not found." }, { status: 404 })
  }

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "company.machine_token_rotated",
    targetType: "computer",
    targetId: id,
    companyId: auth.companyId,
  })

  return NextResponse.json({ ok: true, token })
}
