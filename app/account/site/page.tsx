import { getCurrentUser } from "@/lib/admin-auth"
import { KotliarSitePage } from "@/components/account/kotliar-site-page"
import { isKotliarSiteOwner, kotliarPublicOrigin } from "@/lib/kotliar/owner"
import { notFound, redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function AccountSitePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!isKotliarSiteOwner(user.id)) notFound()

  return <KotliarSitePage publicOrigin={kotliarPublicOrigin()} />
}
