import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getSessionLogin } from "@/lib/admin-auth"
import { setHiddenNav, setPersonalHidden } from "@/lib/repositories/users"
import { WORKSPACE_NAV_KEYS } from "@/lib/workspace-nav"

export const runtime = "nodejs"

/**
 * Настройки меню: скрыть «Личное» (на входе — одна настройка на все профили) и
 * пункты рабочего места (на активном профиле — у каждого свои).
 */
const schema = z
  .object({
    personalHidden: z.boolean().optional(),
    // Хоть один пункт рабочего места остаётся: пустое меню — тупик.
    hiddenNav: z
      .array(z.enum(WORKSPACE_NAV_KEYS))
      .max(WORKSPACE_NAV_KEYS.length - 1)
      .optional(),
  })
  .refine((v) => v.personalHidden !== undefined || v.hiddenNav !== undefined)

export async function PATCH(request: NextRequest) {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }
  const saved = await Promise.all([
    parsed.data.personalHidden === undefined
      ? true
      : setPersonalHidden(session.loginUserId, parsed.data.personalHidden),
    parsed.data.hiddenNav === undefined
      ? true
      : setHiddenNav(session.profileId, [...new Set(parsed.data.hiddenNav)]),
  ])
  if (saved.includes(false)) {
    // Миграция ещё не применена — сохранять некуда.
    return NextResponse.json({ message: "Not available yet.", code: "not-migrated" }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
