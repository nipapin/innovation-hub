import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { presignChatUpload } from "@/lib/production/uploads"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().max(200).optional(),
  sizeBytes: z.number().int().min(0),
  /** Слот формы: файл ляжет в папку слота под именем слота. */
  slot: z.object({ rowId: z.string().min(1).max(40), index: z.number().int().min(1).max(999), dir: z.string().max(500) }).optional(),
  /** Правка вложения: новым файлом в корень рабочей, не поверх и не в форму. */
  editCopy: z.boolean().optional(),
})

/** Подписанная ссылка на заливку вложения — в рабочую папку этапа (§2.3). */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await presignChatUpload(guard.access, guard.auth.userId, parsed.data)
  if (result.ok) return NextResponse.json(result)
  const status = result.reason === "storage" ? 503 : result.reason === "too-big" ? 413 : result.reason === "forbidden" ? 403 : 409
  return NextResponse.json({ message: "Cannot upload.", code: result.reason }, { status })
}
