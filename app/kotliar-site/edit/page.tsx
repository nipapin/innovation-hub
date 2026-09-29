import type { Metadata } from "next"
import { KotliarEditor } from "@/components/kotliar/editor"
import { getCurrentUser, getSessionLogin } from "@/lib/admin-auth"
import { isKotliarSiteOwner, kotliarPublicOrigin } from "@/lib/kotliar/owner"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Редактор",
  robots: { index: false, follow: false },
}

export default async function KotliarEditPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const session = await getSessionLogin()
  if (
    !isKotliarSiteOwner({
      id: user.id,
      email: user.email,
      loginUserId: session?.loginUserId ?? user.loginUserId,
    })
  ) {
    redirect("/login")
  }

  return <KotliarEditor publicOrigin={kotliarPublicOrigin()} />
}
