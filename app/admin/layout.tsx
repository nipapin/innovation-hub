import { IBM_Plex_Sans } from "next/font/google"
import { DisabledToolsProvider } from "@/components/admin/shell/features-context"
import { disabledAdminHrefs } from "@/lib/features-state"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { AdminShell } from "@/components/admin/shell/admin-shell"
import { getCurrentUser } from "@/lib/admin-auth"
import { isElevated } from "@/lib/admin-roles"
import { getCompanyContext } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
})

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Пункт «Консоль компании» — по тому же ответу гейта, что и в кабинете
  // (app/account/layout.tsx). Суперадмин видит оба блока, и вход в компанию
  // должен быть у него из любой поверхности, а не только изнутри неё самой.
  const [user, companyContext] = await Promise.all([
    getCurrentUser(),
    getCompanyContext(),
  ])
  // Погашенные разделы — свойство установки, а не человека, поэтому
  // считаются один раз на layout и раздаются контекстом.
  const disabledTools = await disabledAdminHrefs()

  if (!user || !user.isActive || !isElevated(user.role)) {
    redirect("/login")
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
        companyNav={
          companyContext
            ? {
                role: companyContext.companyRole,
                capabilities: companyContext.capabilities,
                sections: companyContext.companySections,
              }
            : null
        }
      >
        <AdminShell
          email={user.email}
          fullName={user.fullName ?? ""}
          currentUserId={user.id}
          currentUserRole={user.role}
          currentUserCapabilities={user.capabilities}
        >
          {children}
        </AdminShell>
      </WorkspaceShell>
      </DisabledToolsProvider>
    </div>
  )
}
