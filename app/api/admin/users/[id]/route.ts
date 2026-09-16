import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { hasDependents } from "@/lib/billing/payer"
import { clearCapabilities } from "@/lib/repositories/admin-capabilities"
import { userUpdateSchema } from "@/lib/admin-schemas"
import { hashPassword } from "@/lib/auth"
import {
  countActiveAdmins,
  countActiveSuperAdmins,
  deleteUser,
  findUserByEmail,
  findUserById,
  updateUser,
} from "@/lib/repositories/users"
import { isElevated, isSuperAdmin } from "@/lib/admin-roles"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "users.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const payload = await request.json()
  const parsed = userUpdateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid user payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const isSelf = auth.userId === id

  if (isSelf && parsed.data.isActive === false) {
    return NextResponse.json(
      { message: "You cannot deactivate your own account." },
      { status: 400 },
    )
  }

  // Ролей стало три, поэтому условие «не понижай себя» больше не сводится к
  // USER: суперадмин мог бы уйти на ступень вниз и потерять право вернуться.
  // Свою роль не меняет никто — см. docs/ADMIN_ROLES_PLAN.md §2.
  if (isSelf && parsed.data.role !== undefined && parsed.data.role !== auth.role) {
    return NextResponse.json(
      { message: "You cannot change your own role." },
      { status: 400 },
    )
  }

  // Роли раздаёт только суперадмин. Проверяем до похода в базу: отказ здесь не
  // зависит от того, кто цель, и подтверждать её существование незачем.
  if (parsed.data.role !== undefined && !isSuperAdmin(auth.role)) {
    return NextResponse.json(
      { message: "Only a superadmin can change roles." },
      { status: 403 },
    )
  }

  const target = await findUserById(id)
  if (!target) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  // Админ управляет только теми, кто ниже него: равного и старшего не трогает.
  // Та же симметрия, что у canManageMember в проектах. Себя — можно: правка
  // собственного имени и пароля к управлению чужими аккаунтами не относится.
  if (!isSelf && !isSuperAdmin(auth.role) && isElevated(target.role)) {
    return NextResponse.json(
      { message: "Only a superadmin can manage another admin." },
      { status: 403 },
    )
  }

  const nextRole = parsed.data.role
  const deactivating = parsed.data.isActive === false
  // Снимок до записи: журналу нужно «из чего во что», а после updateUser
  // прежние значения уже не достать.
  const previousRole = target.role
  const wasActive = target.isActive
  const previousFullName = target.fullName
  // Почта в базе уже в нижнем регистре, но входящую мы приводим сами — сравнение
  // должно идти по одной и той же форме, иначе смена регистра в поле сойдёт за
  // правку профиля.
  const previousEmail = target.email.toLowerCase()

  // Два инварианта, и первый второго не заменяет: «админка достижима»
  // выполняется и одними админами, а «роли есть кому раздать» — только
  // суперадмином. Порядок важен ровно постольку, поскольку сообщения разные.
  if (isSuperAdmin(target.role) && target.isActive) {
    const losesSuper =
      deactivating || (nextRole !== undefined && !isSuperAdmin(nextRole))
    if (losesSuper && (await countActiveSuperAdmins(id)) === 0) {
      return NextResponse.json(
        { message: "At least one active superadmin must remain." },
        { status: 400 },
      )
    }
  }

  if (isElevated(target.role) && target.isActive) {
    const losesAccess =
      deactivating || (nextRole !== undefined && !isElevated(nextRole))
    if (losesAccess && (await countActiveAdmins(id)) === 0) {
      return NextResponse.json(
        { message: "At least one active admin must remain." },
        { status: 400 },
      )
    }
  }

  let nextEmail: string | undefined
  if (parsed.data.email !== undefined) {
    nextEmail = parsed.data.email.toLowerCase()
    const conflict = await findUserByEmail(nextEmail)
    if (conflict && conflict.id !== id) {
      return NextResponse.json(
        { message: "Another account already uses this email." },
        { status: 409 },
      )
    }
  }

  let nextPasswordHash: string | undefined
  if (parsed.data.password !== undefined && parsed.data.password.length > 0) {
    nextPasswordHash = await hashPassword(parsed.data.password)
  }

  try {
    const user = await updateUser(id, {
      fullName: parsed.data.fullName,
      email: nextEmail,
      passwordHash: nextPasswordHash,
      role: parsed.data.role,
      isActive: parsed.data.isActive,
    })

    if (!user) {
      return NextResponse.json({ message: "User not found." }, { status: 404 })
    }

    // Тег, оставшийся у понижённого аккаунта, ничего не открывает
    // (hasCapability отсекает по роли), но висел бы в базе и всплыл бы обратно
    // при повторном повышении — молча вернув доступ, которого никто не выдавал.
    if (nextRole !== undefined && nextRole !== "ADMIN") {
      await clearCapabilities(id)
    }

    // Одно обращение — несколько событий, если в нём смешано разное. Свалить
    // всё в один «user.updated» значило бы спрятать смену роли и сброс пароля
    // за общей формулировкой: искать их потом в журнале было бы нечем.
    const audit = auditFrom(request, auth)
    const target = { targetType: "user", targetId: id, targetLabel: user.email }

    if (nextRole !== undefined && nextRole !== previousRole) {
      await audit({
        ...target,
        action: "user.role_changed",
        meta: { from: previousRole, to: nextRole },
      })
    }
    if (nextPasswordHash !== undefined) {
      await audit({ ...target, action: "user.password_reset", meta: { isSelf } })
    }
    if (parsed.data.isActive !== undefined && parsed.data.isActive !== wasActive) {
      await audit({
        ...target,
        action: parsed.data.isActive ? "user.reactivated" : "user.suspended",
      })
    }
    // Что действительно изменилось, а не что прислали. Диалог правки шлёт
    // профиль целиком — имя, почту, роль и флаг блокировки — независимо от
    // того, что человек трогал. По факту присутствия поля журнал писал
    // «Изменён профиль fullName, email» после каждого сохранения, и рядом с
    // «Профиль заблокирован» это выглядело как одно действие, записанное
    // дважды. Роль и блокировка сравниваются со снимком до записи с самого
    // начала — здесь та же мерка.
    const profileFields: ("fullName" | "email")[] = []
    if (
      parsed.data.fullName !== undefined &&
      parsed.data.fullName !== previousFullName
    ) {
      profileFields.push("fullName")
    }
    if (nextEmail !== undefined && nextEmail !== previousEmail) {
      profileFields.push("email")
    }
    if (profileFields.length > 0) {
      await audit({ ...target, action: "user.updated", meta: { profileFields } })
    }

    return NextResponse.json(user)
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "Another account already uses this email." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Could not update user." },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "users.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  if (auth.userId === id) {
    return NextResponse.json(
      { message: "You cannot delete your own account." },
      { status: 400 },
    )
  }

  const target = await findUserById(id)
  if (!target) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  if (!isSuperAdmin(auth.role) && isElevated(target.role)) {
    return NextResponse.json(
      { message: "Only a superadmin can delete another admin." },
      { status: 403 },
    )
  }

  if (target.isActive) {
    if (isSuperAdmin(target.role) && (await countActiveSuperAdmins(id)) === 0) {
      return NextResponse.json(
        { message: "At least one active superadmin must remain." },
        { status: 400 },
      )
    }
    if (isElevated(target.role) && (await countActiveAdmins(id)) === 0) {
      return NextResponse.json(
        { message: "At least one active admin must remain." },
        { status: 400 },
      )
    }
  }

  // Тот, кто платит за других, уходит только после них: каскад унёс бы ленту
  // со списаниями их проектов (docs/COMPANY_ACCOUNTS_PLAN.md §7.8).
  if (await hasDependents(id)) {
    return NextResponse.json(
      {
        message: "This user pays for other people. Reassign them before deleting.",
        code: "has-dependents",
      },
      { status: 409 },
    )
  }

  await deleteUser(id)
  await auditFrom(request, auth)({
    action: "user.deleted",
    targetType: "user",
    targetId: id,
    targetLabel: target.email,
    meta: { role: target.role },
  })
  return NextResponse.json({ message: "User deleted." })
}
