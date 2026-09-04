import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { loadInStatus } from "@/lib/pipeline/in-status"
import { loadProjectStorageState } from "@/lib/project-storage"
import { findProjectById } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import { writeFolderCreate } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Колонка 3 «Папок пользователей»: дерево проекта целиком, вместе со служебной
 * папкой options — в кабинете пользователя она скрыта, админ работает именно с
 * ней.
 * Приезжает при этом из каталога наравне с остальными папками, отдельным
 * листингом бакета её больше никто не собирает.
 *
 * Скоупинга по владельцу нет намеренно: администратор смотрит любые проекты,
 * поэтому findProjectById, а не findProjectForUser.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  try {
    const [state, inStatus] = await Promise.all([
      loadProjectStorageState(project.storageOwnerId, project.id, {
        includeServiceFiles: true,
      }),
      loadInStatus({
        projectId: project.id,
        storageOwnerId: project.storageOwnerId,
      }),
    ])
    return NextResponse.json({
      ...state,
      inStatus,
      storageAvailable: state.available,
    })
  } catch (error) {
    console.error("[pipeline] admin listing failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load project files.",
      },
      { status: 503 },
    )
  }
}


/**
 * Создать папку в чужом проекте — ступень 1: это работа с файлами, а не
 * распоряжение проектом. Тот же путь записи, что в кабинете (writeFolderCreate),
 * и намеренно не свой: строка каталога, ключ в R2 и событие в журнале должны
 * появляться одинаково, кто бы папку ни завёл. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §4.2.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available for this project." },
      { status: 409 },
    )
  }

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : ""
  const folderPath =
    typeof body?.folderPath === "string" ? body.folderPath : ""

  if (!name || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
  }

  try {
    const folder = await writeFolderCreate({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      folderPath,
      name,
      actor: { userId: auth.userId },
    })
    return NextResponse.json(
      { id: folder.id, name: folder.name, folderPath: folder.folderPath },
      { status: 201 },
    )
  } catch (error) {
    console.error("[workspaces] create folder failed", error)
    const msg = error instanceof Error ? error.message : "Failed to create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 503 })
  }
}
