import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { listLaunchablePipelines } from "@/lib/production/runs"

export const runtime = "nodejs"

/** Пайплайны, по которым человек может запустить ролик, с описаниями (§6.5, §9.2). */
export async function GET(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ pipelines: await listLaunchablePipelines(auth.userId) })
}
