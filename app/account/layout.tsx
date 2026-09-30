import { IBM_Plex_Sans } from "next/font/google"
import { DisabledToolsProvider } from "@/components/admin/shell/features-context"
import { disabledAdminHrefs } from "@/lib/features-state"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { getCurrentUser, getLoginAdmin, getSessionLogin } from "@/lib/admin-auth"
import { getCompanyContext } from "@/lib/company-auth"
import { isProductionAvailable } from "@/lib/production/availability"
import { avatarUrlForKey } from "@/lib/avatar"
import { findAvatarKey } from "@/lib/repositories/users"

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
  const [user, companyContext, loginAdmin] = await Promise.all([
    getCurrentUser(),
    getCompanyContext(),
    getLoginAdmin(),
  ])
  // Погашенные разделы — свойство установки, а не человека, поэтому
  // считаются один раз на layout и раздаются контекстом.
  const disabledTools = await disabledAdminHrefs()

  if (!user) {
    redirect("/login")
  }
  const [production, avatarKey] = await Promise.all([
    isProductionAvailable(user.id),
    findAvatarKey(user.id),
  ])

  if (!user.isActive) {
    // Выведенного из компании — обратно в «Личное», а не на порог
    // (docs/MULTI_COMPANY_PROFILES_PLAN.md §4.4). Куку серверный компонент
    // поставить не может, поэтому через роут переключения.
    const login = user.loginUserId !== null ? await getSessionLogin() : null
    if (login && login.loginUserId !== user.id) {
      redirect(
        `/api/auth/switch-profile?${new URLSearchParams({
          to: login.loginUserId,
          next: "/account",
        }).toString()}`,
      )
    }
    redirect("/")
  }

  return (
    <div className={ibmPlex.variable}>
      <DisabledToolsProvider value={disabledTools}>
      <WorkspaceShell
        email={user.email}
        fullName={user.fullName ?? ""}
        avatarUrl={avatarUrlForKey(avatarKey)}
        role={user.role}
        capabilities={user.capabilities}
        balanceCents={user.balanceCents ?? 0}
        personalProfile={!user.companyId}
        production={production}
        loginAdmin={loginAdmin}
        companyNav={
          // Только консоль СВОЕЙ компании. Суперадмину гейт отдаёт любую —
          // последнюю выбранную или первую в списке, — и без этого сравнения
          // в «Личном» у него висела консоль чужой компании. В чужие он
          // заходит из админки («Компании»), там этот пункт и живёт.
          companyContext && companyContext.companyId === user.companyId
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
