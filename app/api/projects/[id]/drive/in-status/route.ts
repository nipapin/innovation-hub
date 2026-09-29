import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { loadInStatus } from "@/lib/pipeline/in-status"
import { requireProjectAccess } from "@/lib/project-access"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Только отметки обработки элементов IN — без дерева.
 *
 * Отметки едут и в GET ../drive, но дерево дальше живёт дельтой журнала
 * хранилища, а смена статуса задачи туда не пишется. Кабинет опрашивает этот
 * адрес, пока в IN что-то ждёт или идёт, — поднимать ради этого весь каталог
 * проекта незачем.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId)
  if (access instanceof NextResponse) return access

  const inStatus = await loadInStatus({
    projectId: access.project.id,
    storageOwnerId: access.project.storageOwnerId,
  })
  return NextResponse.json({ inStatus })
}
