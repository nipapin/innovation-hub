import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listPipelineAreas } from "@/lib/pipeline/repository"

export const runtime = "nodejs"

/**
 * Пульт: все области конвейера одной таблицей — docs/COMPANY_PIPELINE_PLAN.md §6.
 *
 * Право то же, что у самого конвейера (`pipeline.operate`), а не отдельное:
 * страница показывает состояние обработки и им же управляет, то есть это тот же
 * инструмент, вид сверху. Своё право означало бы, что кто-то видит очередь
 * компании, но не видит очередь установки, — разделение без смысла.
 *
 * Тумблер строки пишет не сюда, а в PATCH /api/admin/companies/[id]: выключатель
 * — свойство компании, и место его записи одно.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({ areas: await listPipelineAreas() })
}
