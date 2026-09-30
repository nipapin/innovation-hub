import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { inviteToChat, leaveChat, listMembers, setMemberPrefs } from "@/lib/production/chat"
import { badRequest, requireChat } from "@/lib/production/chat-api"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  return NextResponse.json({ members: await listMembers(id) })
}

/** Позвать в чат — из своей компании или своих контактов (§6.1). */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await inviteToChat(guard.access, guard.auth.userId, parsed.data.userId)
  if (result.ok) return NextResponse.json({ ok: true })
  return NextResponse.json({ message: "Cannot invite.", code: result.reason }, { status: 409 })
}

/** Свои настройки: уровень уведомлений и слежение (§7.3). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = z
    .object({ notify: z.enum(["all", "mentions", "none"]).optional(), following: z.boolean().optional() })
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const ok = await setMemberPrefs(id, guard.auth.userId, parsed.data)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Not a member." }, { status: 409 })
}

/** Выйти из чата (§7.1): не взявшему этап и не последнему проверяющему. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const result = await leaveChat(guard.access, guard.auth.userId)
  if (result.ok) return NextResponse.json({ ok: true })
  return NextResponse.json({ message: "Cannot leave.", code: result.reason }, { status: 409 })
}
