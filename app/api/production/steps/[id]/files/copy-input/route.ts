import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { copyInputToWork } from "@/lib/production/uploads"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ fileId: z.string().min(1) })

/**
 * «Редактировать копию»: входной файл этапа (FINAL предыдущего) копируется в
 * корень рабочей папки под исходным именем; у формы — сразу на место. Право —
 * как на правку рабочей: этап открыт, исполнитель или автор пайплайна.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await copyInputToWork(guard.access, guard.auth.userId, parsed.data.fileId)
  if (result.ok) return NextResponse.json(result)
  const status = result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409
  return NextResponse.json({ message: "Cannot copy.", code: result.reason }, { status })
}
