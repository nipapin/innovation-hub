import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireProductionApi } from "@/lib/production/access"
import { commitNewVersion } from "@/lib/production/activation"
import { commitResponse } from "@/lib/production/commit-response"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ revision: z.number().int().min(0) })

/**
 * Зафиксировать новую версию структуры (§3.5). Новые ролики пойдут по ней,
 * начатые доживают по своей. Без структурных изменений — 409 `unchanged`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "revision is required." }, { status: 400 })
  }

  const { id } = await params
  return commitResponse(
    await commitNewVersion({
      pipelineId: id,
      userId: auth.userId,
      baseRevision: parsed.data.revision,
    }),
  )
}
