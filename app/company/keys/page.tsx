import { CompanyKeys } from "@/components/company/keys-content"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyKeysPage() {
  await requireCompanyPage("keys.manage")
  return <CompanyKeys />
}
