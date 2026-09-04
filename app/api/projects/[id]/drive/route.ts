import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { loadInStatus } from "@/lib/pipeline/in-status"
import { loadProjectStorageState } from "@/lib/project-storage"
import { requireProjectAccess } from "@/lib/project-access"
import { isS3Configured } from "@/lib/s3-client"
import { writeFolderCreate } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Live listing of the project's file tree from Postgres + automation JSON
 * from R2. The service `options` folder is hidden.
 * @deprecated Prefer GET /api/storage/v1/tree — kept for cabinet UI compatibility.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  try {
    const access = await requireProjectAccess(id, auth.userId)
    if (access instanceof NextResponse) return access
    const project = access.project
    // Состояние обработки едет вместе с деревом, а не отдельным опросом:
    // отметка нужна ровно там, где нарисован файл, и живёт ровно столько же.
    const [state, inStatus] = await Promise.all([
      loadProjectStorageState(project.storageOwnerId, project.id),
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
    console.error("[project-storage] listing failed", error)
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

/** Create a subfolder inside the project file tree. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "editor")
  if (access instanceof NextResponse) return access
  const project = access.project
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available for this project." },
      { status: 409 },
    )
  }

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : ""
  const parentFolderPath =
    typeof body?.folderPath === "string"
      ? body.folderPath
      : typeof body?.parentFolderPath === "string"
        ? body.parentFolderPath
        : ""

  if (!name || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
  }
  try {
    const folder = await writeFolderCreate({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      folderPath: parentFolderPath,
      name,
      actor: { userId: auth.userId },
    })
    return NextResponse.json(
      { id: folder.id, name: folder.name, folderPath: folder.folderPath },
      { status: 201 },
    )
  } catch (error) {
    console.error("[project-storage] create folder failed", error)
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
