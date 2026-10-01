import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { reorderFormFiles } from "@/lib/production/uploads"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(200) })

/** Новый порядок файлов строки формы (§3.0): номера в именах переписываются. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await reorderFormFiles(guard.access, guard.auth.userId, parsed.data.fileIds)
  if (result.ok) return NextResponse.json({ ok: true })
  const status = result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409
  return NextResponse.json({ message: "Cannot reorder.", code: result.reason }, { status })
}
