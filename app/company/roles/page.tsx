import { CompanyRoles } from "@/components/company/roles-content"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyRolesPage() {
  const context = await requireCompanyPage("roles.manage")
  return <CompanyRoles currentUserId={context.userId} />
}
