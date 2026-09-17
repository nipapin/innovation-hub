import { IBM_Plex_Sans } from "next/font/google"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { CompanyShell } from "@/components/company/company-shell"
import { getCurrentUser } from "@/lib/admin-auth"
import { isSuperAdmin } from "@/lib/admin-roles"
import { accentCss, DEFAULT_ACCENT, readBranding } from "@/lib/branding"
import { getCompanyContext } from "@/lib/company-auth"
import { findCompanyById, listCompanies } from "@/lib/repositories/companies"

export const dynamic = "force-dynamic"

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
})

/**
 * Консоль компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.
 *
 * Отдельная поверхность со своим гейтом, а не раздел админки: у админов
 * компании своя ось прав, и в `/admin` их не пускает `proxy.ts`.
 *
 * Внешняя оболочка та же, что у кабинета и админки: сотрудник компании — это
 * прежде всего человек со своими проектами, и отбирать у него рабочее место
 * ради консоли незачем.
 */
export default async function CompanyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [user, context] = await Promise.all([getCurrentUser(), getCompanyContext()])

  if (!user || !user.isActive) redirect("/login")
  // Консоли для него нет: не в компании, участник, или компания выключена.
  if (!context) redirect("/account")

  // Переключатель — только суперадмину сайта: админ компании видит одну свою, и
  // список выбора из одного пункта был бы обещанием выбора, которого нет.
  const companies = isSuperAdmin(user.role)
    ? (await listCompanies()).map((company) => ({
        id: company.id,
        title: company.title,
      }))
    : []

  /**
   * Оформление ПРОСМАТРИВАЕМОЙ компании, локально (THEMING_PLAN §6).
   *
   * Сотруднику красить нечего — его компания уже задана глобально в корневом
   * layout. А суперадмин заходит гостем: ему нужно видеть цвет клиента, чтобы
   * его настраивать, но красить в эти цвета всю его админку вокруг значило бы
   * отнять признак, где он сейчас находится.
   */
  const viewed = await findCompanyById(context.companyId)
  const accent = viewed ? readBranding(viewed.branding).accent : DEFAULT_ACCENT

  /**
   * Он в ЧУЖОЙ компании, а не в своей.
   *
   * Одно сравнение отвечает сразу на два вопроса: красить ли оболочку в цвета
   * клиента и показывать ли собственное рабочее место в меню. Оба ответа — про
   * одно и то же: он здесь гость, и всё вокруг принадлежит не ему.
   */
  const isGuest = context.companyId !== user.companyId
  const scopedAccent =
    !isGuest || accent === DEFAULT_ACCENT
      ? null
      : accentCss(accent, ".company-brand")

  return (
    /**
     * Шрифт снаружи, цвет — внутри, и это не косметика.
     *
     * `--font-ibm-plex` читает сама оболочка (workspace-shell.tsx:624), поэтому
     * переменная обязана остаться здесь, над ней. А `.company-brand` уезжает на
     * корень консоли: пока класс висел тут же, правила акцента накрывали и
     * оболочку — рабочее место гостя красилось в цвета клиента, хотя
     * принадлежит не ему.
     */
    <div className={ibmPlex.variable}>
      {scopedAccent ? (
        <style dangerouslySetInnerHTML={{ __html: scopedAccent }} />
      ) : null}
      <WorkspaceShell
        email={user.email}
        fullName={user.fullName ?? ""}
        role={user.role}
        capabilities={user.capabilities}
        balanceCents={user.balanceCents ?? 0}
        hasCompanyConsole
        companyGuest={isGuest}
      >
        <CompanyShell
          className="company-brand"
          companyTitle={context.companyTitle}
          companyRole={context.companyRole}
          capabilities={context.capabilities}
          companies={companies}
          currentCompanyId={context.companyId}
          isSiteSuperAdmin={context.isSiteSuperAdmin}
          sections={context.companySections}
        >
          {children}
        </CompanyShell>
      </WorkspaceShell>
    </div>
  )
}
