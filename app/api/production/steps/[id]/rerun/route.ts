import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { rerunAuto } from "@/lib/production/approval"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** «Ещё раз» у автоматики (§3.2г): вход — в папку обработки заново. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const result = await rerunAuto(id, auth.userId)
  if (result.ok) return NextResponse.json(result)
  const status = result.reason === "not-found" ? 404 : result.reason === "not-reviewer" ? 403 : 409
  return NextResponse.json({ message: "Cannot rerun.", code: result.reason }, { status })
}
