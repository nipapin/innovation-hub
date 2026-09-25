import { IBM_Plex_Sans } from "next/font/google"
import { DisabledToolsProvider } from "@/components/admin/shell/features-context"
import { disabledAdminHrefs } from "@/lib/features-state"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { getCurrentUser } from "@/lib/admin-auth"
import { getCompanyContext } from "@/lib/company-auth"

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
  /**
   * Контекст компании — ради одного пункта меню, и только ради него.
   *
   * Без него владелец компании, сидя в своём кабинете, не имел ни одной ссылки
   * в собственную консоль: блок «Консоль компании» рисуется по
   * `hasCompanyConsole`, а флаг приходил только из app/company/layout.tsx — то
   * есть ключ от двери лежал за самой дверью.
   *
   * Спрашиваем гейт, а не роль с тегами: «есть ли у него консоль» — вопрос со
   * сложным ответом (участник, компания на паузе, суперадмин без своей
   * компании), и второй раз его здесь решать значило бы завести правило,
   * которое однажды разойдётся с настоящим. `getCompanyContext` обёрнут в
   * `React.cache`, так что страницам он достанется бесплатно.
   */
  const [user, companyContext] = await Promise.all([
    getCurrentUser(),
    getCompanyContext(),
  ])
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
        {children}
      </WorkspaceShell>
      </DisabledToolsProvider>
    </div>
  )
}
