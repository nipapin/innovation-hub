import { NextResponse, type NextRequest } from "next/server"
import { deleteOwnMessage } from "@/lib/production/chat"
import { requireChat } from "@/lib/production/chat-api"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; mid: string }> }

/** Удалить своё сообщение: текст и вложения скрываются, место в ленте остаётся. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, mid } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const ok = /^\d+$/.test(mid) && (await deleteOwnMessage(id, guard.auth.userId, Number(mid)))
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Not found." }, { status: 404 })
}
