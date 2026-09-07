import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { deleteAccount, renameAccount } from "@/lib/social/accounts"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const renameSchema = z.object({
  label: z.string().trim().min(1).max(64),
})

/**
 * Переименование аккаунта.
 *
 * Не косметика: имя — это то, что лежит в `options.json` у ноды Poster, и по
 * нему публикация ищет аккаунт. Переименовав здесь, человек обязан поправить и
 * граф, иначе публикация перестанет находить аккаунт. Экран об этом
 * предупреждает; запрещать переименование при этом неправильно — имя из VK
 * («Иван Петров») в списке из пяти аккаунтов не различает ничего.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = renameSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const account = await renameAccount({
    id,
    userId: auth.userId,
    label: parsed.data.label,
  })
  if (!account) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }
  return NextResponse.json({ account })
}

/** Убрать аккаунт вместе с токенами. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const removed = await deleteAccount({ id, userId: auth.userId })
  if (!removed) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
