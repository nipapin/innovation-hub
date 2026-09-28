import { getCurrentUser } from "@/lib/admin-auth"
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
        contactName: user.contactName ?? "",
        email: user.email,
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
