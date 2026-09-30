import { redirect } from "next/navigation"
import { PipelinesList } from "@/components/account/production/pipelines-list"
import { getCurrentUser } from "@/lib/admin-auth"
import { isProductionAvailable } from "@/lib/production/availability"

export const dynamic = "force-dynamic"

/** Свои пайплайны — docs/PRODUCTION_PLAN.md §9.2. Гейт — как у раздела. */
export default async function PipelinesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!(await isProductionAvailable(user.id))) redirect("/account/projects")
  return <PipelinesList />
}
