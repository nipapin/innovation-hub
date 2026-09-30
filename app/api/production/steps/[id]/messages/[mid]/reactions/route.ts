import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { toggleReaction } from "@/lib/production/chat"
import { badRequest, requireChat } from "@/lib/production/chat-api"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; mid: string }> }

/** Поставить или снять реакцию (§7.1). Набор реакций фиксированный. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id, mid } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = z.object({ emoji: z.string().min(1).max(16) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success || !/^\d+$/.test(mid)) return badRequest()
  const ok = await toggleReaction({ stepId: id, userId: guard.auth.userId, messageId: Number(mid), emoji: parsed.data.emoji })
  return ok ? NextResponse.json({ ok: true }) : badRequest()
}
