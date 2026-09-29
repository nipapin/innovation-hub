import { redirect } from "next/navigation"
import { ProductionWorkspace } from "@/components/account/production/production-workspace"
import { getCurrentUser } from "@/lib/admin-auth"
import { isProductionAvailable } from "@/lib/production/availability"

export const dynamic = "force-dynamic"

/**
 * Раздел «Производство» — docs/PRODUCTION_PLAN.md §9.
 *
 * Гейт здесь, а не только в меню: выключенный раздел не должен открываться по
 * прямому адресу. Недоступен — в «Проекты», а не 404: для человека это его же
 * рабочее место, просто без этой закладки.
 */
export default async function ProductionPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!(await isProductionAvailable(user.id))) redirect("/account/projects")

  return <ProductionWorkspace />
}
