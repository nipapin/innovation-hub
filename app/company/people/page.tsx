import { CompanyPeople } from "@/components/company/people-content"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyPeoplePage() {
  const context = await requireCompanyPage("people.manage")
  return <CompanyPeople currentUserId={context.userId} />
}
