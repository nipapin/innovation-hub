import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { markRead } from "@/lib/production/chat"
import { badRequest, requireChat } from "@/lib/production/chat-api"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Отметка прочтения — «прочитал до сообщения N» (§7.2). Только вперёд. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = z.object({ lastId: z.number().int().min(0) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  await markRead(id, guard.auth.userId, parsed.data.lastId)
  return NextResponse.json({ ok: true })
}
