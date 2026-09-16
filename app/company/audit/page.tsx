import { CompanyAudit } from "@/components/company/audit-content"
import { requireCompanyMember } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

/** Журнал открыт всем админам компании — гвард без тега (план §6.4). */
export default async function CompanyAuditPage() {
  await requireCompanyMember()
  return <CompanyAudit />
}
