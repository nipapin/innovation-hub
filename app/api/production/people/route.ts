import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { listPipelinePeople } from "@/lib/production/people"

export const runtime = "nodejs"

/**
 * Кого можно назначать в этапы своих пайплайнов (§6.1). Список небольшой —
 * компания или свои контакты, — поэтому отдаётся целиком, а ищет по нему
 * редактор.
 */
export async function GET(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ people: await listPipelinePeople(auth.userId) })
}
