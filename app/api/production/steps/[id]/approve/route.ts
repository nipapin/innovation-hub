import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireProductionApi } from "@/lib/production/access"
import { approveStep } from "@/lib/production/approval"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Без `fileId` — последний вариант; с ним — выбранный (§4.1). */
const schema = z.object({ fileId: z.string().min(1).optional() }).default({})

/** «Принято» — шаг 1.7: вариант в FINAL, открыть следующие этапы. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  const { id } = await params
  const result = await approveStep({ stepId: id, userId: auth.userId, fileId: parsed.data.fileId })
  if (result.ok) return NextResponse.json(result)

  const status =
    result.reason === "not-found"
      ? 404
      : result.reason === "not-reviewer"
        ? 403
        : result.reason === "storage"
          ? 503
          : 409
  return NextResponse.json({ message: "Cannot approve.", code: result.reason }, { status })
}
