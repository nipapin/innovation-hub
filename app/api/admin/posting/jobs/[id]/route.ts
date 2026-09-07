import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireAdminApi } from "@/lib/admin-auth"
import { cancelPostJob, retryPostJob } from "@/lib/posting/jobs"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const actionSchema = z.object({ action: z.enum(["retry", "cancel"]) })

/**
 * Повтор упавшей задачи и отмена запланированной.
 *
 * Опубликованную (`done`) не трогает ни то, ни другое: пост уже на стене, и
 * «повторить» означало бы второй пост, а «отменить» — обещание, которого мы не
 * выполним. Отзыв публикации — отдельная работа, и делать её видом кнопки
 * «отмена» нельзя.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "posting.operate")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid action." }, { status: 400 })
  }

  const done =
    parsed.data.action === "retry"
      ? await retryPostJob(id)
      : await cancelPostJob(id)

  if (!done) {
    return NextResponse.json(
      { message: "Job is not in a state that allows this action." },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
