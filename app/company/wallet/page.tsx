import { redirect } from "next/navigation"
import { CompanyWallet } from "@/components/company/wallet-content"
import { isCompanyBillingFreeById } from "@/lib/company-billing-gate"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

export default async function CompanyWalletPage() {
  const context = await requireCompanyPage("wallet.manage")
  // Работа за наш счёт — кошелька у компании нет (§3.5). Уводим туда же, куда
  // уводит непроданный раздел: для того, кто сюда попал, это одно и то же —
  // страницы нет. Объяснять причину незачем, она не их.
  if (await isCompanyBillingFreeById(context.companyId)) redirect("/company")
  return <CompanyWallet />
}
