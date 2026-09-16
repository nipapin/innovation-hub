import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { isSuperAdmin } from "@/lib/admin-roles"
import { AdminCompanies } from "@/components/admin/companies/companies-content"

export const dynamic = "force-dynamic"

export default async function AdminCompaniesPage() {
  const user = await requireCapabilityPage("companies.manage")

  // «Войти» в консоль компании — только суперадмину: гейт scope отказывает
  // остальным, и кнопка, которая заведомо обещает 403, хуже её отсутствия.
  return <AdminCompanies canEnterConsole={isSuperAdmin(user.role)} />
}
