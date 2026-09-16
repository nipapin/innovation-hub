import { CompanyMachines } from "@/components/company/machines-content"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyMachinesPage() {
  await requireCompanyPage("machines.manage")
  return <CompanyMachines />
}
