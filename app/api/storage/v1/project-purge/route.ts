import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  isMutationError,
  purgeOwnedProject,
} from "@/lib/storage/project-mutations"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().uuid(),
})

/**
 * POST /api/storage/v1/project-purge — стереть проект из корзины навсегда.
 *
 * Отдельным роутом, а не методом DELETE у `/api/projects/[id]`: там DELETE — это
 * мягкое удаление, и различать два несравнимых по последствиям действия одним
 * глаголом с флагом в теле означало бы, что опечатка в флаге стирает папку.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const result = await purgeOwnedProject(auth, parsed.data)
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
