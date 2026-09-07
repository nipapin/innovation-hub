import { IBM_Plex_Sans } from "next/font/google"
import { DisabledToolsProvider } from "@/components/admin/shell/features-context"
import { disabledAdminHrefs } from "@/lib/features-state"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
})

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  // Погашенные разделы — свойство установки, а не человека, поэтому
  // считаются один раз на layout и раздаются контекстом.
  const disabledTools = await disabledAdminHrefs()

  if (!user) {
    redirect("/login")
  }

  if (!user.isActive) {
    redirect("/")
  }

  return (
    <div className={ibmPlex.variable}>
      <DisabledToolsProvider value={disabledTools}>
      <WorkspaceShell
        email={user.email}
        fullName={user.fullName ?? ""}
        role={user.role}
        capabilities={user.capabilities}
        balanceCents={user.balanceCents ?? 0}
      >
        {children}
      </WorkspaceShell>
      </DisabledToolsProvider>
    </div>
  )
}
