import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { isElevated, isSuperAdmin } from "@/lib/admin-roles"
import { hasCapability } from "@/lib/admin-capabilities"
import { listCapabilitiesForMany } from "@/lib/repositories/admin-capabilities"
import { transferUserToCompany } from "@/lib/repositories/companies"
import { userCreateSchema } from "@/lib/admin-schemas"
import { hashPassword } from "@/lib/auth"
import {
  createUser,
  findUserByEmail,
  listUsers,
  updateUser,
} from "@/lib/repositories/users"
import { syncUserMeta } from "@/lib/project-storage"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "users.read")
  if (auth instanceof NextResponse) return auth

  const users = await listUsers()

  // Теги отдаём вместе со списком: страница «Права доступа» строится из него же,
  // и отдельный запрос на каждую строку превратил бы её открытие в веер вызовов.
  const capabilities = await listCapabilitiesForMany(users.map((u) => u.id))

  return NextResponse.json(
    users.map((user) => ({
      ...user,
      capabilities: capabilities.get(user.id) ?? [],
    })),
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "users.manage")
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = userCreateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid user payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Завести админа — та же раздача доступа, что и повышение существующего.
  // Без этой проверки запрет на повышение обходился бы созданием нового.
  if (isElevated(parsed.data.role) && !isSuperAdmin(auth.role)) {
    return NextResponse.json(
      { message: "Only a superadmin can create an admin." },
      { status: 403 },
    )
  }

  // Зачисление в компанию — отдельное право, и проверяем его ДО создания:
  // иначе отказ оставлял бы за собой заведённого ничьего человека. Тот же тег,
  // что и у перевода существующего (app/api/admin/companies/[id]/members).
  const companyId = parsed.data.companyId ?? null
  if (
    companyId &&
    !hasCapability(auth.role, auth.capabilities, "companies.manage")
  ) {
    return NextResponse.json(
      { message: "You cannot assign people to companies." },
      { status: 403 },
    )
  }

  const email = parsed.data.email.toLowerCase()
  const existing = await findUserByEmail(email)
  if (existing) {
    return NextResponse.json(
      { message: "User with this email already exists." },
      { status: 409 },
    )
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password)
    const user = await createUser({
      fullName: parsed.data.fullName,
      email,
      passwordHash,
      role: parsed.data.role,
    })
    void syncUserMeta({
      userId: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    })

    // Зачисляем тем же вызовом, что и перевод существующего человека, а не
    // записью company_id напрямую: правила про кошелёк и плательщика живут
    // внутри него, и вторая точка записи разошлась бы с ними молча.
    if (companyId) {
      const transfer = await transferUserToCompany({
        userId: user.id,
        companyId,
        companyRole: parsed.data.companyRole,
      })
      if (!transfer.ok) {
        // Аккаунт уже создан, и удалять его здесь нельзя: он мог бы успеть стать
        // чьим-то плательщиком. Говорим прямо, что человек заведён, но остался
        // в общем разделе, — иначе админ решит, что не создалось ничего, и
        // повторит заведение, получив 409 на занятую почту.
        return NextResponse.json(
          {
            message:
              "Account created, but it could not be added to the company. It is in the common section.",
            code: transfer.reason,
            user,
          },
          { status: 409 },
        )
      }
    }

    await auditFrom(request, auth)({
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      meta: {
        role: user.role,
        isActive: parsed.data.isActive,
        companyId,
        companyRole: companyId ? parsed.data.companyRole : null,
      },
    })

    // createUser doesn't take isActive (DB default = TRUE) — branch into a
    // follow-up UPDATE only if the caller explicitly created an inactive user.
    if (parsed.data.isActive === false) {
      const updated = await updateUser(user.id, { isActive: false })
      return NextResponse.json(updated ?? user, { status: 201 })
    }

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "User with this email already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Could not create user." },
      { status: 500 },
    )
  }
}
