import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { toggleExecutorMark } from "@/lib/production/workspace"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Отметить себя исполнителем этапа или снять отметку (§4.1). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const result = await toggleExecutorMark(id, auth.userId)
  if (result.ok) return NextResponse.json({ marked: result.marked })
  if (result.reason === "not-found") return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ message: "Not allowed.", code: result.reason }, { status: 409 })
}
