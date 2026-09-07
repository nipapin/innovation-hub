import { redirect } from "next/navigation"
import { KeysShell } from "@/components/account/keys/keys-shell"
import { SocialAccountsPage } from "@/components/account/social/accounts-page"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountSocialAccountsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return (
    <KeysShell>
      <SocialAccountsPage />
    </KeysShell>
  )
}
