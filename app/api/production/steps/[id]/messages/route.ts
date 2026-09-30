import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { listMembers, listMessages, postMessage, REACTIONS } from "@/lib/production/chat"
import { badRequest, requireChat } from "@/lib/production/chat-api"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Лента чата этапа (§7). `?before=` — старее, `?after=` — новее. Вместе с
 * лентой — участники с отметками прочтения: из них клиент рисует галочки.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const sp = request.nextUrl.searchParams
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined)
  const [messages, members] = await Promise.all([
    listMessages(id, { before: num(sp.get("before")), after: num(sp.get("after")) }),
    listMembers(id),
  ])
  return NextResponse.json({
    messages,
    members,
    me: {
      userId: guard.auth.userId,
      member: guard.access.member,
      isOwner: guard.access.isOwner,
    },
    reactions: REACTIONS,
  })
}

const postSchema = z.object({
  body: z.string().max(8000).default(""),
  attachmentIds: z.array(z.string().min(1)).max(20).default([]),
  replyTo: z.number().int().positive().optional(),
  mentions: z.array(z.string().min(1)).max(50).default([]),
})

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await postMessage({ access: guard.access, userId: guard.auth.userId, ...parsed.data })
  if (!result.ok) return NextResponse.json({ message: "Cannot post.", code: result.reason }, { status: 400 })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
