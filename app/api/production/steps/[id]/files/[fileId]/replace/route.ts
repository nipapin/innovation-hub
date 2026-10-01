import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { completeFileReplace, presignFileReplace } from "@/lib/production/uploads"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; fileId: string }> }

const schema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("presign"), sizeBytes: z.number().int().min(0) }),
  z.object({ stage: z.literal("complete") }),
])

/**
 * Сохранить правку файла поверх него (редактор картинки или текста): `presign`
 * — подпись на PUT в ключ файла, `complete` — записать событие. Имя и место те же.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result =
    parsed.data.stage === "presign"
      ? await presignFileReplace(guard.access, guard.auth.userId, { fileId, sizeBytes: parsed.data.sizeBytes })
      : await completeFileReplace(guard.access, guard.auth.userId, fileId)
  if (result.ok) return NextResponse.json(result)
  const status =
    result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : result.reason === "storage" ? 503 : result.reason === "too-big" ? 413 : 409
  return NextResponse.json({ message: "Cannot save.", code: result.reason }, { status })
}
