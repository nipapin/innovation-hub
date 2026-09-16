import { CompanyToolCards } from "@/components/company/company-shell"
import { requireCompanyMember } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

/** Главная консоли: карточки разделов, доступных этому человеку. */
export default async function CompanyHomePage() {
  const context = await requireCompanyMember()

  return (
    <CompanyToolCards
      companyRole={context.companyRole}
      capabilities={context.capabilities}
    />
  )
}
