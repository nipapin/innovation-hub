import { StatisticsExplorer } from "@/components/statistics/statistics-explorer"
import { requireCompanyPage } from "@/lib/company-auth"

export const dynamic = "force-dynamic"

/**
 * Витрина та же, что в админке и кабинете, — меняется только адрес и набор
 * осей, а их выдаёт `variant`. Своя копия экрана расходилась бы с общей при
 * первой же правке метрик.
 */
export default async function CompanyStatisticsPage() {
  await requireCompanyPage("statistics.view")

  return (
    <StatisticsExplorer endpoint="/api/company/statistics" variant="company" />
  )
}
