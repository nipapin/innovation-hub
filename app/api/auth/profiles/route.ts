import { NextResponse } from "next/server"

import { getSessionLogin } from "@/lib/admin-auth"
import { accentPair, monogramFrom, readBranding } from "@/lib/branding"
import { listLoginProfiles } from "@/lib/repositories/users"

export const runtime = "nodejs"

/**
 * Профили входа для переключателя — docs/MULTI_COMPANY_PROFILES_PLAN.md §6.
 *
 * Только действующие: выведенный из компании профиль в переключателе был бы
 * обещанием рабочего места, которого у человека больше нет. «Личное» — всегда
 * вход: он без компании (§3.1). Название «Личного» переводит интерфейс, поэтому
 * здесь его нет.
 */
export async function GET() {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const profiles = await listLoginProfiles(session.loginUserId)
  return NextResponse.json({
    profiles: profiles
      .filter((profile) => profile.isActive)
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
