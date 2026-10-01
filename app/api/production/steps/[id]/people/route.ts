import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { listPipelinePeople } from "@/lib/production/people"
import { addStepPerson, canEditStepPeople, removeStepPerson, type StepPersonResult } from "@/lib/production/step-people"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ userId: z.string().min(1), role: z.enum(["executor", "reviewer"]) })

function reply(result: StepPersonResult) {
  if (result.ok) return NextResponse.json({ ok: true })
  const status = result.reason === "forbidden" ? 403 : result.reason === "not-found" ? 404 : 409
  return NextResponse.json({ message: "Cannot change people.", code: result.reason }, { status })
}

/** Кого можно добавить в этап ролика — круг автора пайплайна (§6.1). */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  if (!(await canEditStepPeople(guard.access.step, guard.auth.userId))) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }
  return NextResponse.json({ people: await listPipelinePeople(guard.access.step.ownerUserId) })
}

/** Добавить исполнителя или проверяющего только в этот этап этого ролика. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  return reply(await addStepPerson(guard.access.step, guard.auth.userId, parsed.data.userId, parsed.data.role))
}

/** Убрать добавленного в ролике; людей пайплайна правят в пайплайне. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  return reply(await removeStepPerson(guard.access.step, guard.auth.userId, parsed.data.userId, parsed.data.role))
}
