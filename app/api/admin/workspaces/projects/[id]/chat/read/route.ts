import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { markProjectChatReadByTeam } from "@/lib/repositories/project-chat"
import { findProjectById } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * «Команда прочитала этот чат» — зеркало к /api/projects/[id]/chat/read.
 *
 * Отметка одна на проект, а не на каждого администратора: сайт отвечает
 * клиенту от лица команды, и прочитанное одним прочитано всеми. Так же
 * устроен общий чат в YouGile, где эта переписка лежит второй копией.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  await markProjectChatReadByTeam(project.id)
  return NextResponse.json({ ok: true })
}
