import { CompanyWallet } from "@/components/company/wallet-content"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyWalletPage() {
  await requireCompanyPage("wallet.manage")
  return <CompanyWallet />
}
