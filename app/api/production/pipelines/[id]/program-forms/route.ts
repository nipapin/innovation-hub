import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { automationLabels, listProgramForms, readProgramForm } from "@/lib/production/program-forms"
import { findPipeline } from "@/lib/repositories/production-pipelines"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Формы из программы для ноды «Форма»: без `projectId` — в каких своих
 * проектах они есть, с `projectId` — строки формы, с `labels=1` — имена строк
 * форм в проектах нод «Автоматика» (подсказки названий). Только тем, кто
 * правит пайплайн.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const pipeline = await findPipeline(id, auth.userId)
  if (!pipeline) return NextResponse.json({ message: "Not found." }, { status: 404 })

  if (request.nextUrl.searchParams.get("labels") === "1") {
    return NextResponse.json({ labels: await automationLabels(pipeline.ownerUserId, pipeline.graph.nodes) })
  }

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) return NextResponse.json({ forms: await listProgramForms(auth.userId) })

  const result = await readProgramForm(auth.userId, projectId)
  if (result.ok) return NextResponse.json({ rows: result.rows })
  if (result.reason === "not-found") return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ message: "Invalid form.", code: "invalid", error: result.error }, { status: 422 })
}
