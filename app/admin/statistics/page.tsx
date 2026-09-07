import { notFound } from "next/navigation"
import { isEnabled } from "@/lib/features-state"
import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminStatisticsContent } from "@/components/admin/statistics/statistics-content"

export const dynamic = "force-dynamic"

export default async function AdminStatisticsPage() {
  await requireCapabilityPage("statistics.view")

  // Раздел погашен на этой установке — его здесь просто нет. Проверка сверх
  // скрытого пункта меню: по прямой ссылке пришли бы на живую страницу.
  if (!(await isEnabled("admin.statistics"))) notFound()

  return <AdminStatisticsContent />
}
