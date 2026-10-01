import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { getRunOverview } from "@/lib/production/workspace"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Обзор ролика: вся схема и FINAL принятых этапов. Не видит ролик — 404. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const overview = await getRunOverview(id, auth.userId)
  if (!overview) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ overview })
}
