import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { countTeamUnreadTotal } from "@/lib/repositories/project-chat"

export const runtime = "nodejs"

/**
 * Число на значке раздела «Чаты» в боковом меню: сколько сообщений клиентов
 * ждут команду по всему сайту.
 *
 * Отдельный роут, а не поле в списке чатов: значок висит в шелле, то есть на
 * КАЖДОЙ странице админки, и тянуть ради него страницу списка со всеми
 * последними сообщениями значило бы гонять её постоянно и всюду.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const unread = await countTeamUnreadTotal()
  return NextResponse.json({ unread })
}
