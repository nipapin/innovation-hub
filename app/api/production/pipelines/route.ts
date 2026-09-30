import { NextResponse, type NextRequest } from "next/server"
import { canCreatePipelines, requireProductionApi } from "@/lib/production/access"
import { createEmptyGraph } from "@/lib/production/graph"
import { createPipelineSchema, DEFAULT_PIPELINE_SETTINGS } from "@/lib/production/schemas"
import { createPipeline, listPipelines } from "@/lib/repositories/production-pipelines"

export const runtime = "nodejs"

/**
 * Свои пайплайны и право заводить новые — docs/PRODUCTION_PLAN.md §9.2.
 * `canCreate` отдаётся здесь же: по нему интерфейс решает, показывать ли
 * «Новый пайплайн», и считать правило второй раз на клиенте не нужно.
 */
export async function GET(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const [pipelines, canCreate] = await Promise.all([
    listPipelines(auth.userId),
    canCreatePipelines(auth.userId),
  ])
  return NextResponse.json({ pipelines, canCreate })
}

/** Новый пайплайн: черновик с одной нодой «Старт». */
export async function POST(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  if (!(await canCreatePipelines(auth.userId))) {
    return NextResponse.json(
      { message: "You cannot create pipelines.", code: "forbidden" },
      { status: 403 },
    )
  }

  const parsed = createPipelineSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const pipeline = await createPipeline({
    ownerUserId: auth.userId,
    name: parsed.data.name,
    graph: createEmptyGraph({ start: parsed.data.startName }),
    settings: DEFAULT_PIPELINE_SETTINGS,
  })
  return NextResponse.json({ pipeline }, { status: 201 })
}
