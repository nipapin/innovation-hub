import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { listSubfolders } from "@/lib/production/folders"
import { findPipeline } from "@/lib/repositories/production-pipelines"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Подпапки в папке владельца пайплайна: `projectId` и `path` (через `/`) —
 * подсказки пути копирования в ноде «Действие». Только тем, кто правит пайплайн.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const pipeline = await findPipeline(id, auth.userId)
  if (!pipeline) return NextResponse.json({ message: "Not found." }, { status: 404 })

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) return NextResponse.json({ message: "projectId required." }, { status: 400 })
  const path = (request.nextUrl.searchParams.get("path") ?? "").split("/").filter(Boolean)

  const folders = await listSubfolders(pipeline.ownerUserId, projectId, path)
  if (!folders) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ folders })
}
