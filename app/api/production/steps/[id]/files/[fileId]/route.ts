import { NextResponse, type NextRequest } from "next/server"
import { requireChat } from "@/lib/production/chat-api"
import { removeFormFile } from "@/lib/production/uploads"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; fileId: string }> }

/** Убрать файл из слота формы этапа (§3.0). */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const result = await removeFormFile(guard.access, guard.auth.userId, fileId)
  if (result.ok) return NextResponse.json({ ok: true })
  const status = result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409
  return NextResponse.json({ message: "Cannot remove.", code: result.reason }, { status })
}
