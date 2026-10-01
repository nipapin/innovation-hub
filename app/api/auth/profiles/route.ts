import { NextResponse } from "next/server"

import { getSessionLogin } from "@/lib/admin-auth"
import { accentPair, monogramFrom, readBranding } from "@/lib/branding"
import { listLoginProfiles, readWorkspacePrefs } from "@/lib/repositories/users"
import { isPersonalVisible } from "@/lib/workspace-nav"

export const runtime = "nodejs"

/**
 * Профили входа для переключателя — docs/MULTI_COMPANY_PROFILES_PLAN.md §6.
 *
 * Только действующие: выведенный из компании профиль в переключателе был бы
 * обещанием рабочего места, которого у человека больше нет. «Личное» — всегда
 * вход: он без компании (§3.1). Название «Личного» переводит интерфейс, поэтому
 * здесь его нет.
 *
 * «Личное», скрытое человеком, в списке не отдаём — кроме случая, когда он
 * сейчас в нём (иначе текущий профиль пропал бы из переключателя) или когда
 * активных компаний нет.
 */
export async function GET() {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const [profiles, prefs] = await Promise.all([
    listLoginProfiles(session.loginUserId),
    readWorkspacePrefs(session.loginUserId),
  ])
  const active = profiles.filter((profile) => profile.isActive)
  const showPersonal =
    session.profileId === session.loginUserId ||
    isPersonalVisible(prefs.personalHidden, active.some((p) => p.companyId))
  return NextResponse.json({
    profiles: active
      .filter((profile) => profile.companyId || showPersonal)
      .map((profile) => {
        const current = profile.id === session.profileId
        if (!profile.companyId) {
          return {
            id: profile.id,
            kind: "personal" as const,
            title: null,
            monogram: null,
            accent: null,
            current,
          }
        }
        const title = profile.companyTitle ?? ""
        const branding = readBranding(profile.companyBranding)
        return {
          id: profile.id,
          kind: "company" as const,
          title,
          monogram: branding.monogram ?? monogramFrom(title),
          accent: accentPair(branding.accent),
          current,
        }
      }),
  })
}
