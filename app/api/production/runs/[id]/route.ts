import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireProductionApi } from "@/lib/production/access"
import { cancelRun, deleteRun, renameRun, type RunActionResult } from "@/lib/production/runs"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const patchSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(120) }),
  z.object({ status: z.literal("cancelled") }),
])

function reply(result: RunActionResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true })
  if (result.reason === "forbidden") {
    return NextResponse.json({ message: "Not allowed.", code: "forbidden" }, { status: 403 })
  }
  if (result.reason === "closed") {
    return NextResponse.json({ message: "The video is already finished.", code: "closed" }, { status: 409 })
  }
  return NextResponse.json({ message: "Not found." }, { status: 404 })
}

/** Переименовать (`{ name }`) или завершить (`{ status: "cancelled" }`) ролик — §4.7. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { id } = await context.params
  return reply(
    "name" in parsed.data
      ? await renameRun(id, auth.userId, parsed.data.name)
      : await cancelRun(id, auth.userId),
  )
}

/** Удалить ролик: автор пайплайна или запустивший. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await context.params
  return reply(await deleteRun(id, auth.userId))
}
