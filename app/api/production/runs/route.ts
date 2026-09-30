import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireProductionApi } from "@/lib/production/access"
import { launchRun } from "@/lib/production/runs"

export const runtime = "nodejs"

const schema = z.object({
  pipelineId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  /** `Date.getTimezoneOffset()` в браузере запускающего. */
  tzOffsetMin: z.number().int().min(-840).max(840).default(0),
})

/**
 * «Новый ролик» — docs/PRODUCTION_PLAN.md §9.2, шаг 1.6. Запускать может автор
 * пайплайна и запускающие из ноды «Старт»; чужой пайплайн — 404.
 */
export async function POST(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const result = await launchRun({ ...parsed.data, userId: auth.userId })
  if (result.ok) return NextResponse.json({ runId: result.runId }, { status: 201 })
  if (result.reason === "bad-path") {
    return NextResponse.json(
      { message: "The video name makes an invalid path.", code: "bad-path", stage: result.stage },
      { status: 422 },
    )
  }
  if (result.reason === "name-taken") {
    return NextResponse.json(
      { message: "A video with this name already exists in the pipeline.", code: "name-taken" },
      { status: 409 },
    )
  }
  if (result.reason === "storage") {
    return NextResponse.json({ message: "Object storage is unavailable.", code: "storage" }, { status: 503 })
  }
  return NextResponse.json({ message: "Not found." }, { status: 404 })
}
