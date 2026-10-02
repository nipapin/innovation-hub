import { NextResponse, type NextRequest } from "next/server"
import { canCreatePipelines, requireProductionApi } from "@/lib/production/access"
import { createPipeline, findPipeline, listPipelines } from "@/lib/repositories/production-pipelines"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Копия пайплайна черновиком: граф и настройки — как есть, к имени — число,
 * первое свободное среди своих пайплайнов. Люди, версии и ролики не копируются:
 * они появятся при активации копии.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  if (!(await canCreatePipelines(auth.userId))) {
    return NextResponse.json({ message: "You cannot create pipelines.", code: "forbidden" }, { status: 403 })
  }

  const { id } = await params
  const source = await findPipeline(id, auth.userId)
  if (!source) return NextResponse.json({ message: "Pipeline not found." }, { status: 404 })

  const taken = new Set((await listPipelines(auth.userId)).map((p) => p.name.trim().toLowerCase()))
  // «Ролик 2» дублируется в «Ролик 3», а не в «Ролик 2 2».
  const base = source.name.trim().replace(/\s+\d+$/, "")
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n++

  const pipeline = await createPipeline({
    ownerUserId: auth.userId,
    name: `${base} ${n}`,
    graph: source.graph,
    settings: source.settings,
  })
  return NextResponse.json({ pipeline }, { status: 201 })
}
