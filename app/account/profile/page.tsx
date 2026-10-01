import { getCurrentUser } from "@/lib/admin-auth"
import { avatarUrlForKey } from "@/lib/avatar"
import {
  findAvatarKey,
  listLoginProfiles,
  readWorkspacePrefs,
} from "@/lib/repositories/users"
import { isProductionAvailable } from "@/lib/production/availability"
import { ProfilePageClient } from "@/components/account/profile-page"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const loginId = user.loginUserId ?? user.id
  const [avatarKey, prefs, profiles, production] = await Promise.all([
    findAvatarKey(user.id),
    readWorkspacePrefs(user.id),
    listLoginProfiles(loginId),
    isProductionAvailable(user.id),
  ])
  // Первая действующая компания: куда уйти, если скрыть «Личное», сидя в нём.
  const firstCompany = profiles.find((p) => p.companyId && p.isActive)

  return (
    <ProfilePageClient
      user={{
        id: user.id,
        fullName: user.fullName ?? "",
        email: user.email,
        avatarUrl: avatarUrlForKey(avatarKey),
        role: user.role,
        isActive: user.isActive,
        isPersonal: user.loginUserId === null,
        personalHidden: prefs.personalHidden,
        firstCompanyProfileId: firstCompany?.id ?? null,
        hiddenNav: prefs.hiddenNav,
        production,
        createdAt:
          user.createdAt instanceof Date
            ? user.createdAt.toISOString()
            : String(user.createdAt),
      }}
    />
  )
}
