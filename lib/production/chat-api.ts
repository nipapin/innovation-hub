import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi, type ProductionApiUser } from "./access"
import { getChatAccess, type ChatAccess } from "./chat"

/**
 * Гвард роутов чата этапа: сессия, доступность раздела, и человек видит этот
 * этап — участник его чата или автор пайплайна (§6.5). Нет — 404.
 */
export async function requireChat(
  request: NextRequest,
  stepId: string,
): Promise<{ auth: ProductionApiUser; access: ChatAccess } | NextResponse> {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth
  const access = await getChatAccess(stepId, auth.userId)
  if (!access) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return { auth, access }
}

export const badRequest = (message = "Invalid input.") =>
  NextResponse.json({ message }, { status: 400 })
