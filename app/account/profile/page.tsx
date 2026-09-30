import { getCurrentUser } from "@/lib/admin-auth"
import { avatarUrlForKey } from "@/lib/avatar"
import { findAvatarKey } from "@/lib/repositories/users"
import { ProfilePageClient } from "@/components/account/profile-page"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return (
    <ProfilePageClient
      user={{
        id: user.id,
        fullName: user.fullName ?? "",
        email: user.email,
        avatarUrl: avatarUrlForKey(await findAvatarKey(user.id)),
        role: user.role,
        isActive: user.isActive,
        isPersonal: user.loginUserId === null,
        createdAt:
          user.createdAt instanceof Date
            ? user.createdAt.toISOString()
            : String(user.createdAt),
      }}
    />
  )
}
