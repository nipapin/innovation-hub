import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  findRemoteComputerById,
  generateRemoteComputerToken,
  rotateRemoteComputerToken,
  updateRemoteComputer,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

/** Тело необязательное: заодно с токеном можно поправить описание. */
const bodySchema = z
  .object({ description: z.string().max(500).optional() })
  .default({})

type RouteContext = { params: Promise<{ id: string }> }

/** Rotate computer token (optionally updating the description). Raw token returned once. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  let body: unknown = undefined
  const text = await request.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
    }
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const raw = generateRemoteComputerToken()
  const ok = await rotateRemoteComputerToken(id, raw)
  if (!ok) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }
  if (parsed.data.description !== undefined) {
    await updateRemoteComputer(id, { description: parsed.data.description })
  }

  await auditFrom(request, auth)({
    action: "computer.token_rotated",
    targetType: "computer",
    targetId: id,
    targetLabel: existing.name,
  })

  return NextResponse.json({
    id,
    name: existing.name,
    token: raw,
  })
}
