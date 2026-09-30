import { redirect } from "next/navigation"
import { PipelineEditor } from "@/components/account/production/editor/pipeline-editor"
import { getCurrentUser } from "@/lib/admin-auth"
import { isProductionAvailable } from "@/lib/production/availability"

export const dynamic = "force-dynamic"

/**
 * Редактор пайплайна — docs/PRODUCTION_PLAN.md §3, шаг 1.5. Чужой пайплайн
 * отдаст 404 роут, и редактор покажет ошибку загрузки.
 */
export default async function PipelineEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!(await isProductionAvailable(user.id))) redirect("/account/projects")
  const { id } = await params
  return <PipelineEditor pipelineId={id} />
}
