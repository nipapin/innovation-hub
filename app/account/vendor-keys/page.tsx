import { redirect } from "next/navigation"
import { KeysShell } from "@/components/account/keys/keys-shell"
import { VendorKeysPage } from "@/components/account/vendor-keys-page"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountVendorKeysPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return (
    <KeysShell>
      <VendorKeysPage />
    </KeysShell>
  )
}
