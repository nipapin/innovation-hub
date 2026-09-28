import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { VaultKeyError } from "@/lib/vault/crypto"
import { createAccountSchema } from "@/lib/vault/schemas"
import { findLoginByEmail } from "@/lib/repositories/users"
import { createAccount, findService } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Завести учётку под сервисом.
 *
 * Учёток несколько, потому что требование пришло с двух сторон сразу: «тест и
 * прод» на одном вендоре и «клиент принёс свой ключ». Обе решает `ownerUserId`
 * — а прайс остаётся у сервиса: цена вендора не зависит от того, чьим ключом
 * позвали.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = createAccountSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const service = await findService(id)
  if (!service) {
    return NextResponse.json({ message: "Service not found." }, { status: 404 })
  }

  // Почту переводим в id здесь: `createAccount` работает с id, а знать про
  // таблицу пользователей сейфу незачем.
  let ownerUserId: string | null = null
  if (parsed.data.ownerEmail) {
    const owner = await findLoginByEmail(parsed.data.ownerEmail)
    if (!owner) {
      return NextResponse.json({ code: "owner-not-found" }, { status: 404 })
    }
    ownerUserId = owner.id
  }

  try {
    const result = await createAccount({
      serviceId: id,
      label: parsed.data.label,
      ownerUserId,
      fields: parsed.data.fields,
      baseUrl: parsed.data.baseUrl,
      keyTtlSec: parsed.data.keyTtlSec,
      actorId: auth.userId,
    })
    if (!result) {
      return NextResponse.json({ message: "Service not found." }, { status: 404 })
    }
    if ("conflict" in result) {
      // 409, а не 400: метка занята — это состояние базы. По метке ссылается
      // поле проекта, и вторая такая же сделала бы ссылку двусмысленной.
      return NextResponse.json({ code: "label-taken" }, { status: 409 })
    }

    await auditFrom(request, auth)({
      action: "service.account_created",
      targetType: "service",
      targetId: id,
      targetLabel: service.name,
      // Значений полей здесь нет и быть не может — только их имена: журнал
      // читают шире, чем экран сервисов.
      meta: {
        account: parsed.data.label,
        owner: parsed.data.ownerEmail,
        fields: Object.keys(parsed.data.fields),
      },
    })

    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    if (error instanceof VaultKeyError) {
      return NextResponse.json({ code: "vault-not-configured" }, { status: 503 })
    }
    throw error
  }
}
