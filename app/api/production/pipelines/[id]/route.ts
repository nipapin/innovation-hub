import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { applyPeopleInPlace, structureChanged } from "@/lib/production/activation"
import { normalizeGraph, validateGraph } from "@/lib/production/graph"
import { readCompanyFeatures } from "@/lib/company-features"
import { enabledToolKeys } from "@/lib/features-state"
import { findCompanyFeaturesForUser } from "@/lib/repositories/companies"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import { listProjectsByOwner } from "@/lib/repositories/projects"
import { updatePipelineSchema } from "@/lib/production/schemas"
import {
  deletePipeline,
  findPipeline,
  savePipeline,
} from "@/lib/repositories/production-pipelines"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Пайплайн целиком — для редактора. Чужой — 404: он не подтверждает, что есть.
 * С ним — папки владельца для выбора папки этапа (только свои: чужую пайплайн
 * расшарить не может) и словарь типов файлов для формы.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const pipeline = await findPipeline(id, auth.userId)
  if (!pipeline) return NextResponse.json({ message: "Not found." }, { status: 404 })
  // Инструменты для выбора в ноде — тот же набор, что в каталоге
  // `/api/account/tools`: выключенные на установке и не проданные компании не
  // предлагаем.
  const features = readCompanyFeatures(await findCompanyFeaturesForUser(auth.userId))
  const [projects, fileTypes, toolKeys] = await Promise.all([
    listProjectsByOwner(pipeline.ownerUserId),
    readFileTypeDictionary().catch(() => ({})),
    enabledToolKeys(features.companyTools),
  ])
  return NextResponse.json({
    pipeline,
    issues: validateGraph(pipeline.graph),
    structureChanged: await structureChanged(pipeline),
    projects: projects.filter((p) => !p.isArchived).map((p) => ({ id: p.id, name: p.name })),
    fileTypes: Object.keys(fileTypes),
    toolKeys,
  })
}

/**
 * Сохранить черновик: имя, граф, настройки, архив (§3.5).
 *
 * Граф приводится (`normalizeGraph`: правила типов нод, повторные связи)
 * и сохраняется даже с ошибками — это черновик, в нём законно быть
 * недоделанным. Ошибки уходят в ответе, а блокируют только активацию.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const parsed = updatePipelineSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { id } = await params
  const graph = parsed.data.graph ? normalizeGraph(parsed.data.graph) : undefined
  const result = await savePipeline({
    id,
    userId: auth.userId,
    baseRevision: parsed.data.revision,
    name: parsed.data.name,
    graph,
    settings: parsed.data.settings,
    archived: parsed.data.archived,
    paused: parsed.data.paused,
  })

  if (!result.ok && result.reason === "not-found") {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  if (!result.ok) {
    return NextResponse.json(
      { message: "The pipeline was changed elsewhere.", code: "conflict", pipeline: result.current },
      { status: 409 },
    )
  }
  // У активного пайплайна люди — настройка на месте: действуют сразу, в том
  // числе на идущие ролики (§3.5). Структурные изменения ждут новой версии —
  // о них говорит `structureChanged`.
  if (graph) await applyPeopleInPlace(result.pipeline)
  return NextResponse.json({
    pipeline: result.pipeline,
    issues: validateGraph(result.pipeline.graph),
    structureChanged: await structureChanged(result.pipeline),
  })
}

/** Удалить — только без роликов в работе (§3.5); иначе сначала архив. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const result = await deletePipeline(id, auth.userId)
  if (result.ok) return NextResponse.json({ ok: true })
  if (result.reason === "not-found") {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return NextResponse.json(
    { message: "Videos are still in production.", code: "active-runs" },
    { status: 409 },
  )
}
