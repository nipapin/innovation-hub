import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { listMyRuns } from "@/lib/production/workspace"

export const runtime = "nodejs"

/** Мои ролики и мои этапы в каждом (§6.5). `?archived=1` — архив. */
export async function GET(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const archived = request.nextUrl.searchParams.get("archived") === "1"
  return NextResponse.json({ runs: await listMyRuns(auth.userId, archived) })
}
