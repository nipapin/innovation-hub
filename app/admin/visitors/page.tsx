import { notFound } from "next/navigation"
import { isEnabled } from "@/lib/features-state"
import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { VisitorsContent } from "@/components/admin/visitors/visitors-content"

export const dynamic = "force-dynamic"

export default async function AdminVisitorsPage() {
  await requireCapabilityPage("visitors.view")

  // Раздел погашен на этой установке — его здесь просто нет. Проверка сверх
  // скрытого пункта меню: по прямой ссылке пришли бы на живую страницу.
  if (!(await isEnabled("admin.visitors"))) notFound()

  return <VisitorsContent />
}
