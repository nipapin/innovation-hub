import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { getStepView } from "@/lib/production/workspace"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Этап ролика целиком: люди, схема, файлы. Чужой — 404 (§6.5). */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const step = await getStepView(id, auth.userId)
  if (!step) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ step })
}
