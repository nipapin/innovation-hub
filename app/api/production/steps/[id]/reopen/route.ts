import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { reopenStep } from "@/lib/production/reopen"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Вернуть принятый этап в работу; следующие — «переделать». */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const result = await reopenStep(id, auth.userId)
  if (result.ok) return NextResponse.json(result)
  const status = result.reason === "not-found" ? 404 : result.reason === "forbidden" ? 403 : 409
  return NextResponse.json({ message: "Cannot reopen.", code: result.reason }, { status })
}
